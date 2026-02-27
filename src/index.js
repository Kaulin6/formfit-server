require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./db');
const webhookRouter = require('./webhook');
const pipeline = require('./pipeline');

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
    const validStatuses = ['new', 'confirmed', 'in-progress', 'shipped', 'cancelled', 'error'];
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

// Run pipeline for an order
app.post('/api/orders/:orderId/run-pipeline', async (req, res) => {
  try {
    const order = db.getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const result = await pipeline.runOrderPipeline(req.params.orderId);
    res.json(result);
  } catch (err) {
    console.error('[API] run-pipeline error:', err);
    res.status(500).json({ error: err.message || 'Pipeline failed' });
  }
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
