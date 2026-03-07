const express = require('express');
const router = express.Router();
const { processMessage } = require('./processor');

const VERIFY_TOKEN = 'gamaclaw123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// ── WEBHOOK VERIFICATION (Meta calls this to verify your endpoint) ─────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ── INCOMING MESSAGES ─────────────────────────────────────────────────────────
router.post('/', express.json(), async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from; // WhatsApp number e.g. "919876543210"
    const profileName = value?.contacts?.[0]?.profile?.name || '';

    let text = null;
    let audioBase64 = null;

    if (msg.type === 'text') {
      text = msg.text?.body || '';
    } else if (msg.type === 'audio') {
      // Download audio from Meta
      try {
        const mediaId = msg.audio?.id;
        const fetch = require('node-fetch');
        const mediaRes = await fetch(
          `https://graph.facebook.com/v22.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        const mediaData = await mediaRes.json();
        const audioRes = await fetch(mediaData.url, {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        const audioBuffer = await audioRes.buffer();
        audioBase64 = audioBuffer.toString('base64');
      } catch (e) {
        console.error('Audio download error:', e.message);
        text = '[Voice message - could not process]';
      }
    } else {
      return res.sendStatus(200); // Ignore other message types
    }

    const response = await processMessage(from, 'whatsapp', text, profileName, audioBase64);
    await sendWhatsAppMessage(from, response);

    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.sendStatus(200);
  }
});

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const fetch = require('node-fetch');
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  // Clean markdown for WhatsApp
  const cleaned = String(text)
    .replace(/\*\*(.*?)\*\*/g, '*$1*') // bold
    .replace(/#{1,3} /g, '')           // headers
    .replace(/`/g, '');                // code ticks

  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: cleaned },
    }),
  });
}

module.exports = router;