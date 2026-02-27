/**
 * Craftcloud3D API Integration
 * API docs: https://api.craftcloud3d.com/api-docs.json
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const BASE_URL = 'https://api.craftcloud3d.com/v5';

function getHeaders() {
  const key = process.env.CRAFTCLOUD_API_KEY;
  if (!key) throw new Error('CRAFTCLOUD_API_KEY not set');
  return { Authorization: `Bearer ${key}` };
}

/**
 * Upload an STL file, request quotes, and pick the cheapest US-based option.
 * @param {string} stlFilePath - Absolute or relative path to the STL file
 * @param {string} material - 'PLA' or 'PETG'
 * @param {number} quantity - Number of copies (default 1)
 * @returns {{ bestQuote, allQuotes, modelId }}
 */
async function uploadAndQuote(stlFilePath, material, quantity = 1) {
  const headers = getHeaders();
  const absPath = path.resolve(stlFilePath);

  // Step 1: Upload STL file
  console.log(`[CRAFTCLOUD] Uploading ${absPath}...`);
  const form = new FormData();
  form.append('file', fs.createReadStream(absPath));
  form.append('unit', 'mm');

  const uploadRes = await axios.post(`${BASE_URL}/model`, form, {
    headers: { ...headers, ...form.getHeaders() },
    timeout: 60000,
  });

  const models = uploadRes.data;
  const modelId = models[0]?.modelId;
  if (!modelId) throw new Error('Upload returned no modelId');
  console.log(`[CRAFTCLOUD] Model uploaded: ${modelId}`);

  // Step 2: Poll until model geometry is fully parsed
  let parsed = false;
  for (let i = 0; i < 30; i++) {
    const check = await axios.get(`${BASE_URL}/model/${modelId}`, {
      headers,
      validateStatus: (s) => s === 200 || s === 206,
    });
    if (check.status === 200) { parsed = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!parsed) throw new Error('Model parsing timed out');

  // Step 3: Request quotes
  console.log(`[CRAFTCLOUD] Requesting quotes for ${material} x${quantity}...`);
  const priceReq = await axios.post(`${BASE_URL}/price`, {
    currency: 'USD',
    countryCode: 'US',
    models: [{ modelId, quantity, scale: 1.0 }],
  }, { headers });

  const priceId = priceReq.data?.priceId || priceReq.data?.id;
  if (!priceId) throw new Error('Price request returned no priceId');

  // Step 4: Poll until all quotes are in
  let quoteData;
  for (let i = 0; i < 30; i++) {
    const res = await axios.get(`${BASE_URL}/price/${priceId}`, { headers });
    quoteData = res.data;
    if (quoteData.allComplete) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!quoteData?.allComplete) throw new Error('Quote polling timed out');

  // Step 5: Build combined quotes (quote + shipping per vendor)
  const quotes = (quoteData.quotes || []).map((q) => {
    const vendorShipping = (quoteData.shippings || []).find(
      (s) => s.vendorId === q.vendorId
    );
    return {
      quoteId: q.quoteId,
      vendorId: q.vendorId,
      price: q.price,
      currency: 'USD',
      leadDays: q.productionTimeSlow || q.productionTimeFast || null,
      shipping: vendorShipping ? vendorShipping.price : 0,
      shippingId: vendorShipping ? vendorShipping.shippingId : null,
      totalPrice: q.price + (vendorShipping ? vendorShipping.price : 0),
    };
  });

  // Sort by total price ascending, pick cheapest
  quotes.sort((a, b) => a.totalPrice - b.totalPrice);
  const bestQuote = quotes[0] || null;

  console.log(`[CRAFTCLOUD] Got ${quotes.length} quotes. Best: $${bestQuote?.totalPrice?.toFixed(2) || 'N/A'}`);

  return { bestQuote, allQuotes: quotes, modelId };
}

/**
 * Place an order with a selected quote.
 * @param {string} quoteId - The quoteId from uploadAndQuote results
 * @param {object} shippingAddress - { name, line1, city, state, zip, country }
 * @param {string} customerRef - Customer reference string
 * @param {string} shippingId - The shippingId for delivery
 * @returns {{ orderId, trackingInfo, estimatedDelivery }}
 */
async function placeOrder(quoteId, shippingAddress, customerRef, shippingId) {
  const headers = getHeaders();

  // Step 1: Create cart
  console.log(`[CRAFTCLOUD] Creating cart for quote ${quoteId}...`);
  const cartRes = await axios.post(`${BASE_URL}/cart`, {
    currency: 'USD',
    quotes: [{ id: quoteId, types: [], note: '' }],
    shippingIds: shippingId ? [shippingId] : [],
    customerReference: customerRef || '',
  }, { headers });

  const cartId = cartRes.data?.cartId;
  if (!cartId) throw new Error('Cart creation returned no cartId');

  // Step 2: Place order
  const nameParts = (shippingAddress.name || 'FormFit Customer').split(' ');
  const firstName = nameParts[0] || 'FormFit';
  const lastName = nameParts.slice(1).join(' ') || 'Customer';

  console.log(`[CRAFTCLOUD] Placing order...`);
  const orderRes = await axios.post(`${BASE_URL}/order`, {
    cartId,
    user: {
      emailAddress: process.env.CRAFTCLOUD_EMAIL || 'orders@formfitcustom.com',
      shipping: {
        firstName,
        lastName,
        address: shippingAddress.line1,
        city: shippingAddress.city,
        stateCode: shippingAddress.state,
        zipCode: shippingAddress.zip,
        countryCode: shippingAddress.country || 'US',
      },
      billing: {
        firstName,
        lastName,
        address: shippingAddress.line1,
        city: shippingAddress.city,
        stateCode: shippingAddress.state,
        zipCode: shippingAddress.zip,
        countryCode: shippingAddress.country || 'US',
      },
    },
    appId: 'craftcloud',
  }, { headers });

  const orderId = orderRes.data?.orderId || orderRes.data?.orderNumber;
  console.log(`[CRAFTCLOUD] Order placed: ${orderId}`);

  return {
    orderId,
    trackingInfo: null,
    estimatedDelivery: null,
  };
}

/**
 * Check status of a placed order.
 * @param {string} orderId - Craftcloud order ID
 * @returns {{ status, tracking, estimatedDelivery }}
 */
async function getOrderStatus(orderId) {
  const headers = getHeaders();
  const res = await axios.get(`${BASE_URL}/order/${orderId}/status`, { headers });
  const data = res.data;

  const firstVendor = (data.status || [])[0] || {};
  return {
    status: firstVendor.status || 'unknown',
    tracking: firstVendor.trackingUrl || firstVendor.trackingNumber || null,
    estimatedDelivery: data.estDeliveryTime || null,
  };
}

module.exports = { uploadAndQuote, placeOrder, getOrderStatus };
