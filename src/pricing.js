// Pricing engine for FormFit Custom orders
// Two fulfillment modes: SELF (Ethan prints) and CLOUD (Craftcloud3D)

const SELF_BASE = {
  small:        35,
  medium:       75,
  'full drawer': 150
};

const MATERIAL_MULT = {
  pla:   1.0,
  'pla+': 1.1,
  petg:  1.2
};

const SELF_SHIPPING = {
  small:        8,
  medium:       8,
  'full drawer': 15
};

const RUSH_FEE = 25;
const CAD_FEE  = 15;

// Craftcloud estimated costs (what we pay)
const CLOUD_COST = {
  small:        20,
  medium:       45,
  'full drawer': 100
};

// Craftcloud sell prices (what the customer pays)
const CLOUD_SELL = {
  small:        55,
  medium:       110,
  'full drawer': 225
};

/**
 * Calculate a quote for an order.
 * @param {object} opts
 * @param {string} opts.size       - 'small', 'medium', or 'full drawer'
 * @param {string} opts.material   - 'pla', 'pla+', or 'petg'
 * @param {string} opts.fulfillment - 'SELF' or 'CLOUD'
 * @param {boolean} opts.rush
 * @param {boolean} opts.cadDesign
 * @returns {object} { basePrice, addonsPrice, shipping, total, craftcloudCost, margin }
 */
function calculateQuote({ size, material, fulfillment, rush = false, cadDesign = false }) {
  const sizeKey = size.toLowerCase();
  const matKey  = material.toLowerCase();
  const mode    = (fulfillment || 'SELF').toUpperCase();

  if (mode === 'CLOUD') {
    const cost  = CLOUD_COST[sizeKey] || CLOUD_COST.medium;
    const sell  = CLOUD_SELL[sizeKey] || CLOUD_SELL.medium;
    const addons = (rush ? RUSH_FEE : 0) + (cadDesign ? CAD_FEE : 0);
    const total  = sell + addons;
    return {
      basePrice: sell,
      addonsPrice: addons,
      shipping: 0,              // included in Craftcloud price
      total,
      craftcloudCost: cost,
      margin: total - cost
    };
  }

  // SELF fulfillment
  const base     = SELF_BASE[sizeKey] || SELF_BASE.medium;
  const mult     = MATERIAL_MULT[matKey] || 1.0;
  const basePrice = Math.round(base * mult * 100) / 100;
  const addons   = (rush ? RUSH_FEE : 0) + (cadDesign ? CAD_FEE : 0);
  const shipping = SELF_SHIPPING[sizeKey] || SELF_SHIPPING.medium;
  const total    = basePrice + addons + shipping;
  // Rough material cost estimate for margin calc (~30% of base)
  const materialCost = Math.round(base * 0.3 * 100) / 100;
  const margin       = total - materialCost - shipping;

  return {
    basePrice,
    addonsPrice: addons,
    shipping,
    total,
    craftcloudCost: 0,
    margin
  };
}

/**
 * Build a human-readable proposal string.
 */
function formatProposal(order, quote) {
  const lines = [
    `📋 *FormFit Custom Quote*`,
    ``,
    `Size: ${order.size}`,
    `Material: ${order.material}`,
    `Color: ${order.color}`,
    `Fulfillment: ${order.fulfillment_type}`,
    ``,
    `Base price: $${quote.basePrice.toFixed(2)}`,
  ];
  if (quote.addonsPrice > 0) {
    const parts = [];
    if (order.rush) parts.push('Rush');
    if (order.cad_design) parts.push('CAD design');
    lines.push(`Add-ons (${parts.join(', ')}): $${quote.addonsPrice.toFixed(2)}`);
  }
  if (order.fulfillment_type === 'CLOUD') {
    lines.push(`Shipping: included`);
    lines.push(`(Ships directly to you from our fulfillment partner)`);
  } else {
    lines.push(`Shipping: $${quote.shipping.toFixed(2)}`);
  }
  lines.push(``, `💰 Total: $${quote.total.toFixed(2)}`);
  lines.push(``, `Reply YES to confirm or NO to cancel.`);
  return lines.join('\n');
}

module.exports = { calculateQuote, formatProposal };
