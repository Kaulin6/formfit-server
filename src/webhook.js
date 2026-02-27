const express = require('express');
const db = require('./db');
const { handleIncoming } = require('./conversation');

const router = express.Router();

// Facebook verification challenge
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[WEBHOOK] Verification successful');
    return res.status(200).send(challenge);
  }
  console.warn('[WEBHOOK] Verification failed — token mismatch');
  return res.sendStatus(403);
});

// Receive messages from Facebook Messenger
router.post('/', async (req, res) => {
  // Facebook expects a 200 quickly — respond before processing
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const psid = event.sender?.id;
        if (!psid) continue;

        // Skip echoes of our own messages
        if (event.message?.is_echo) continue;

        const message = event.message || {};
        const text = message.text || '';
        const attachments = message.attachments || [];

        console.log(`[WEBHOOK IN] PSID=${psid} text="${text}" attachments=${attachments.length}`);

        // Save incoming message to DB
        db.saveMessage(psid, 'in', text || (attachments.length ? '[image]' : '[empty]'));

        // Hand off to conversation state machine
        await handleIncoming(psid, { text, attachments });
      }
    }
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
  }
});

module.exports = router;
