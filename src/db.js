const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'formfit.db');

let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      psid TEXT NOT NULL,
      name TEXT DEFAULT '',
      status TEXT DEFAULT 'new',
      photo_path TEXT DEFAULT '',
      material TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      fulfillment_type TEXT DEFAULT '',
      rush INTEGER DEFAULT 0,
      cad_design INTEGER DEFAULT 0,
      base_price REAL DEFAULT 0,
      addons_price REAL DEFAULT 0,
      shipping REAL DEFAULT 0,
      total REAL DEFAULT 0,
      craftcloud_cost REAL DEFAULT 0,
      margin REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      psid TEXT NOT NULL,
      direction TEXT NOT NULL,
      text TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_state (
      psid TEXT PRIMARY KEY,
      stage TEXT DEFAULT 'NEW',
      pending_order_id TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add columns for pipeline (idempotent — ignores if already exist)
  const pipelineCols = [
    ['stl_path', "TEXT DEFAULT ''"],
    ['craftcloud_quote_id', "TEXT DEFAULT ''"],
  ];
  for (const [col, def] of pipelineCols) {
    try { db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`); }
    catch (_) { /* column already exists */ }
  }

  console.log('[DB] Initialized at', DB_PATH);
  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

// --- Orders ---

function generateOrderId() {
  const num = Math.floor(10000 + Math.random() * 90000);
  return `FFC-${num}`;
}

function createOrder(data) {
  const orderId = generateOrderId();
  const stmt = getDb().prepare(`
    INSERT INTO orders (order_id, psid, photo_path, status)
    VALUES (?, ?, ?, 'new')
  `);
  stmt.run(orderId, data.psid, data.photoPath || '');
  return orderId;
}

function getOrder(orderId) {
  return getDb().prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
}

function getOrderByPsid(psid) {
  // Get most recent non-cancelled order for this PSID
  return getDb().prepare(
    `SELECT * FROM orders WHERE psid = ? AND status != 'cancelled'
     ORDER BY created_at DESC LIMIT 1`
  ).get(psid);
}

function updateOrder(orderId, fields) {
  const allowed = [
    'name', 'status', 'photo_path', 'material', 'color', 'size',
    'fulfillment_type', 'rush', 'cad_design', 'base_price', 'addons_price',
    'shipping', 'total', 'craftcloud_cost', 'margin', 'stl_path', 'craftcloud_quote_id'
  ];
  const updates = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  values.push(orderId);
  getDb().prepare(
    `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`
  ).run(...values);
}

function getAllOrders() {
  return getDb().prepare(
    'SELECT * FROM orders ORDER BY created_at DESC'
  ).all();
}

// --- Messages ---

function saveMessage(psid, direction, text) {
  getDb().prepare(
    'INSERT INTO messages (psid, direction, text) VALUES (?, ?, ?)'
  ).run(psid, direction, text);
}

function getMessages(psid) {
  return getDb().prepare(
    'SELECT * FROM messages WHERE psid = ? ORDER BY timestamp ASC'
  ).all(psid);
}

// --- Conversation state ---

function getState(psid) {
  let row = getDb().prepare('SELECT * FROM conversation_state WHERE psid = ?').get(psid);
  if (!row) {
    getDb().prepare(
      'INSERT INTO conversation_state (psid, stage) VALUES (?, ?)'
    ).run(psid, 'NEW');
    row = { psid, stage: 'NEW', pending_order_id: '' };
  }
  return row;
}

function setState(psid, stage, pendingOrderId) {
  getDb().prepare(`
    INSERT INTO conversation_state (psid, stage, pending_order_id, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(psid) DO UPDATE SET
      stage = excluded.stage,
      pending_order_id = excluded.pending_order_id,
      updated_at = excluded.updated_at
  `).run(psid, stage, pendingOrderId || '');
}

// --- Stats ---

function getStats() {
  const d = getDb();
  const total = d.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pending = d.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('new','in-progress')").get().c;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStr = monthStart.toISOString().slice(0, 10);
  const revenue = d.prepare(
    "SELECT COALESCE(SUM(total), 0) as r FROM orders WHERE status = 'shipped' AND created_at >= ?"
  ).get(monthStr).r;
  const totalMargin = d.prepare(
    "SELECT COALESCE(SUM(margin), 0) as m FROM orders WHERE status = 'shipped'"
  ).get().m;
  return { total, pending, revenue, totalMargin };
}

module.exports = {
  init, getDb, generateOrderId,
  createOrder, getOrder, getOrderByPsid, updateOrder, getAllOrders,
  saveMessage, getMessages,
  getState, setState,
  getStats
};
