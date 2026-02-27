const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GRAPH_URL = 'https://graph.facebook.com/v19.0/me/messages';

/**
 * Send a text message to a PSID via Facebook Messenger.
 */
async function sendText(psid, text) {
  try {
    await axios.post(GRAPH_URL, {
      recipient: { id: psid },
      message: { text }
    }, {
      params: { access_token: PAGE_ACCESS_TOKEN }
    });
    console.log(`[MSG OUT] → ${psid}: ${text.slice(0, 80)}...`);
  } catch (err) {
    console.error('[MSG OUT ERROR]', err.response?.data || err.message);
  }
}

/**
 * Download an image attachment and save to uploads/.
 * Returns the local file path.
 */
async function downloadAttachment(url, psid) {
  try {
    const resp = await axios.get(url, { responseType: 'stream' });
    const ext = '.jpg';
    const filename = `${psid}_${Date.now()}${ext}`;
    const filePath = path.join(__dirname, '..', 'uploads', filename);

    const writer = fs.createWriteStream(filePath);
    resp.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`[DOWNLOAD] Saved attachment to ${filePath}`);
    return `uploads/${filename}`;
  } catch (err) {
    console.error('[DOWNLOAD ERROR]', err.message);
    return '';
  }
}

module.exports = { sendText, downloadAttachment };
