const db = require('./db');
const { sendText, downloadAttachment } = require('./messenger');
const { calculateQuote, formatProposal } = require('./pricing');

/**
 * Conversation state machine.
 * Stages: NEW → PHOTO_RECEIVED → DETAILS_RECEIVED → QUOTE_SENT → CONFIRMED
 */

async function handleIncoming(psid, message) {
  const state = db.getState(psid);
  const text = (message.text || '').trim();
  const attachments = message.attachments || [];
  const hasImage = attachments.some(a => a.type === 'image');

  console.log(`[CONV] PSID=${psid} stage=${state.stage} text="${text}" hasImage=${hasImage}`);

  switch (state.stage) {
    case 'NEW':
      return await handleNew(psid, text, hasImage, attachments);
    case 'PHOTO_RECEIVED':
      return await handlePhotoReceived(psid, text);
    case 'DETAILS_RECEIVED':
      return await handleDetailsReceived(psid, text);
    case 'QUOTE_SENT':
      return await handleQuoteSent(psid, text);
    case 'CONFIRMED':
      return await handleConfirmed(psid, text, hasImage, attachments);
    default:
      // Reset if in unknown state
      db.setState(psid, 'NEW', '');
      return await handleNew(psid, text, hasImage, attachments);
  }
}

// --- Stage handlers ---

async function handleNew(psid, text, hasImage, attachments) {
  if (hasImage) {
    // They sent a photo right away — process it
    return await processPhoto(psid, attachments);
  }

  // Welcome message
  const reply = "Hey! 👋 Welcome to FormFit Custom. I'm Mango, your order assistant. Send me a photo of your tools laid out flat on a piece of paper and we'll get you a custom quote!";
  await sendText(psid, reply);
  db.saveMessage(psid, 'out', reply);
  // Stay in NEW — waiting for photo
}

async function processPhoto(psid, attachments) {
  const imageAtt = attachments.find(a => a.type === 'image');
  let photoPath = '';
  if (imageAtt && imageAtt.payload && imageAtt.payload.url) {
    photoPath = await downloadAttachment(imageAtt.payload.url, psid);
  }

  // Create order
  const orderId = db.createOrder({ psid, photoPath });
  db.setState(psid, 'PHOTO_RECEIVED', orderId);

  const reply = "Got your photo! 🔧 A couple quick questions:\n1️⃣ What material do you want? (PLA / PETG / PLA+)\n2️⃣ What color?\n3️⃣ Rough size — Small (1-2 tools), Medium (5-10 tools), or Full Drawer?";
  await sendText(psid, reply);
  db.saveMessage(psid, 'out', reply);
}

async function handlePhotoReceived(psid, text) {
  if (!text) {
    await sendText(psid, "Please reply with your material, color, and size preferences.");
    return;
  }

  const state = db.getState(psid);
  const orderId = state.pending_order_id;

  // Parse the response — be flexible
  const parsed = parseDetails(text);

  db.updateOrder(orderId, {
    material: parsed.material,
    color: parsed.color,
    size: parsed.size
  });

  db.setState(psid, 'DETAILS_RECEIVED', orderId);

  const reply = "Perfect. Do you want us to print it, or would you like a cloud-printed option shipped directly to you?\n(Reply: SELF or CLOUD)";
  await sendText(psid, reply);
  db.saveMessage(psid, 'out', reply);
}

async function handleDetailsReceived(psid, text) {
  const upper = text.toUpperCase();
  const state = db.getState(psid);
  const orderId = state.pending_order_id;

  let fulfillment = 'SELF';
  if (upper.includes('CLOUD')) {
    fulfillment = 'CLOUD';
  }

  db.updateOrder(orderId, { fulfillment_type: fulfillment });

  // Generate quote
  const order = db.getOrder(orderId);
  const quote = calculateQuote({
    size: order.size,
    material: order.material,
    fulfillment,
    rush: !!order.rush,
    cadDesign: !!order.cad_design
  });

  db.updateOrder(orderId, {
    base_price: quote.basePrice,
    addons_price: quote.addonsPrice,
    shipping: quote.shipping,
    total: quote.total,
    craftcloud_cost: quote.craftcloudCost,
    margin: quote.margin
  });

  const proposal = formatProposal(order, quote);
  db.setState(psid, 'QUOTE_SENT', orderId);

  await sendText(psid, proposal);
  db.saveMessage(psid, 'out', proposal);
}

async function handleQuoteSent(psid, text) {
  const upper = text.toUpperCase();
  const state = db.getState(psid);
  const orderId = state.pending_order_id;

  if (upper.includes('YES') || upper.includes('CONFIRM') || upper.includes('APPROVE')) {
    db.updateOrder(orderId, { status: 'confirmed' });
    db.setState(psid, 'CONFIRMED', orderId);

    const reply = `You're confirmed! 🎉 We'll be in touch when your order ships. Order ID: ${orderId}`;
    await sendText(psid, reply);
    db.saveMessage(psid, 'out', reply);
  } else if (upper.includes('NO') || upper.includes('CANCEL')) {
    db.updateOrder(orderId, { status: 'cancelled' });
    db.setState(psid, 'NEW', '');

    const reply = "No worries — order cancelled. Send a new photo anytime to start a fresh quote!";
    await sendText(psid, reply);
    db.saveMessage(psid, 'out', reply);
  } else {
    await sendText(psid, "Reply YES to confirm your order or NO to cancel.");
  }
}

async function handleConfirmed(psid, text, hasImage, attachments) {
  // Returning customer — start new flow
  if (hasImage) {
    return await processPhoto(psid, attachments);
  }
  db.setState(psid, 'NEW', '');
  const reply = "Welcome back! 🙌 Send a new photo to start another order.";
  await sendText(psid, reply);
  db.saveMessage(psid, 'out', reply);
}

// --- Helpers ---

/**
 * Best-effort parse of free-text details reply.
 * Looks for material, color, and size keywords.
 */
function parseDetails(text) {
  const lower = text.toLowerCase();

  // Material
  let material = 'PLA';
  if (lower.includes('petg'))       material = 'PETG';
  else if (lower.includes('pla+'))  material = 'PLA+';
  else if (lower.includes('pla'))   material = 'PLA';

  // Size
  let size = 'medium';
  if (lower.includes('full') || lower.includes('drawer')) size = 'full drawer';
  else if (lower.includes('small'))  size = 'small';
  else if (lower.includes('medium')) size = 'medium';
  else if (lower.includes('large'))  size = 'full drawer';

  // Color — grab anything that isn't a known keyword
  const knownWords = [
    'pla', 'pla+', 'petg', 'small', 'medium', 'large', 'full', 'drawer',
    'tools', 'tool', 'and', 'the', 'i', 'want', 'would', 'like', 'please',
    '1', '2', '3', 'material', 'color', 'size', 'in', 'a'
  ];
  const words = text.split(/[\s,./]+/).filter(w => w.length > 1);
  const colorWords = words.filter(w => !knownWords.includes(w.toLowerCase()));
  const color = colorWords.length > 0 ? colorWords.join(' ') : 'black';

  return { material, color, size };
}

module.exports = { handleIncoming };
