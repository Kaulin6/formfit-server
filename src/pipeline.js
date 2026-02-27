/**
 * Pipeline Orchestrator
 * Runs the full order automation: ToolTrace → Craftcloud → fulfillment
 */

const path = require('path');
const db = require('./db');
const tooltrace = require('./tooltrace');
const craftcloud = require('./craftcloud');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

/**
 * Run the full order pipeline for an approved order.
 * @param {string} orderId - The FormFit order ID (e.g., 'FFC-12345')
 * @returns {{ success, orderId, stlPath, craftcloudQuote, error }}
 */
async function runOrderPipeline(orderId) {
  console.log(`[PIPELINE] Starting pipeline for ${orderId}`);
  let order;

  try {
    order = db.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);

    let stlPath = order.stl_path || '';

    // --- Step 1: Generate STL via ToolTrace if needed ---
    if (!stlPath) {
      const photoPath = order.photo_path;
      if (!photoPath) throw new Error('Order has no photo — cannot generate STL');

      console.log(`[PIPELINE] No STL yet. Running ToolTrace on ${photoPath}...`);
      const traceResult = await tooltrace.processImage(photoPath, UPLOADS_DIR);

      if (!traceResult.success) {
        throw new Error(`ToolTrace failed: ${traceResult.error}`);
      }

      stlPath = traceResult.stlPath;
      db.updateOrder(orderId, { stl_path: stlPath });
      console.log(`[PIPELINE] STL generated: ${stlPath}`);
    } else {
      console.log(`[PIPELINE] STL already exists: ${stlPath}`);
    }

    // --- Step 2: Route by fulfillment type ---
    const fulfillment = (order.fulfillment_type || '').toUpperCase();

    if (fulfillment === 'CLOUD') {
      return await handleCloudFulfillment(orderId, order, stlPath);
    } else if (fulfillment === 'SELF') {
      return handleSelfFulfillment(orderId, stlPath);
    } else {
      // Default to self-print if no fulfillment type set
      console.log(`[PIPELINE] No fulfillment type set — defaulting to SELF`);
      return handleSelfFulfillment(orderId, stlPath);
    }
  } catch (err) {
    console.error(`[PIPELINE] Error for ${orderId}:`, err.message);
    // Mark order as error in DB
    try { db.updateOrder(orderId, { status: 'error' }); } catch (_) {}
    return {
      success: false,
      orderId,
      stlPath: null,
      craftcloudQuote: null,
      error: err.message,
    };
  }
}

async function handleCloudFulfillment(orderId, order, stlPath) {
  const material = order.material || 'PLA';
  console.log(`[PIPELINE] Cloud fulfillment — getting Craftcloud quote for ${material}...`);

  const quoteResult = await craftcloud.uploadAndQuote(stlPath, material);
  const best = quoteResult.bestQuote;

  if (!best) throw new Error('No Craftcloud quotes returned');

  // Save quote info to DB
  db.updateOrder(orderId, {
    craftcloud_cost: best.totalPrice,
    craftcloud_quote_id: best.quoteId,
  });
  console.log(`[PIPELINE] Cloud quote ready: $${best.totalPrice.toFixed(2)}`);

  // Auto-place order if API key is set
  if (process.env.CRAFTCLOUD_API_KEY) {
    console.log(`[PIPELINE] Auto-placing Craftcloud order...`);
    try {
      const orderResult = await craftcloud.placeOrder(
        best.quoteId,
        {
          name: order.name || 'FormFit Customer',
          line1: '123 Main St',
          city: 'Anytown',
          state: 'TX',
          zip: '78701',
          country: 'US',
        },
        orderId,
        best.shippingId
      );
      db.updateOrder(orderId, { status: 'in-progress' });
      console.log(`[PIPELINE] Craftcloud order placed: ${orderResult.orderId}`);
    } catch (placeErr) {
      console.error(`[PIPELINE] Auto-order failed: ${placeErr.message}. Quote is saved — can order manually.`);
    }
  } else {
    console.log('[PIPELINE] Set CRAFTCLOUD_API_KEY to enable auto-ordering');
  }

  return {
    success: true,
    orderId,
    stlPath,
    craftcloudQuote: {
      quoteId: best.quoteId,
      totalPrice: best.totalPrice,
      vendorId: best.vendorId,
      leadDays: best.leadDays,
    },
    error: null,
  };
}

function handleSelfFulfillment(orderId, stlPath) {
  console.log(`[PIPELINE] STL ready for self-printing at: ${stlPath}`);
  db.updateOrder(orderId, { status: 'in-progress' });

  return {
    success: true,
    orderId,
    stlPath,
    craftcloudQuote: null,
    error: null,
  };
}

module.exports = { runOrderPipeline };
