require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./db');
const webhookRouter = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files: uploaded photos
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// --- Routes ---

// Facebook Messenger webhook
app.use('/webhook', webhookRouter);

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// --- API endpoints for dashboard ---

app.get('/api/orders', (req, res) => {
  try {
    const orders = db.getAllOrders();
    res.json(orders);
  } catch (err) {
    console.error('[API] /api/orders error:', err);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    console.error('[API] /api/stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/orders/:orderId/messages', (req, res) => {
  try {
    const order = db.getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const messages = db.getMessages(order.psid);
    res.json(messages);
  } catch (err) {
    console.error('[API] messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/api/orders/:orderId/status', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'confirmed', 'in-progress', 'shipped', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.updateOrder(req.params.orderId, { status });
    res.json({ ok: true });
  } catch (err) {
    console.error('[API] status update error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Craftcloud placeholder
app.post('/api/orders/:orderId/craftcloud', (req, res) => {
  const order = db.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // TODO: Replace with real Craftcloud API call
  // const craftcloudResponse = await axios.post('https://api.craftcloud3d.com/v1/orders', {
  //   api_key: process.env.CRAFTCLOUD_API_KEY,
  //   stl_url: order.stl_url,
  //   material: order.material,
  //   ...
  // });
  console.log(`[CRAFTCLOUD] Placeholder — would send order ${order.order_id} to Craftcloud`);
  res.json({ ok: true, message: 'Craftcloud integration pending' });
});

// --- Init & Start ---

db.init();

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   FormFit Custom Server                  ║
  ║   Running on http://localhost:${PORT}       ║
  ║   Dashboard: http://localhost:${PORT}/dashboard  ║
  ║   Webhook:   http://localhost:${PORT}/webhook    ║
  ╚══════════════════════════════════════════╝
  `);
});
