const express = require('express');
const router = express.Router();
const { processMessage } = require('./processor');

const VERIFY_TOKEN = 'gamaclaw123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// ── WEBHOOK VERIFICATION ──────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
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
    const entry    = req.body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return res.sendStatus(200);

    const msg         = messages[0];
    const from        = msg.from;
    const profileName = value?.contacts?.[0]?.profile?.name || '';

    // Ignore status updates
    if (msg.type === 'status') return res.sendStatus(200);

    let text        = null;
    let audioBase64 = null;

    if (msg.type === 'text') {
      text = msg.text?.body || '';
    } else if (msg.type === 'audio' || msg.type === 'voice') {
      try {
        const mediaId  = msg.audio?.id || msg.voice?.id;
        const fetch    = require('node-fetch');
        const mediaRes = await fetch(
          `https://graph.facebook.com/v22.0/${mediaId}`,
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        if (!mediaRes.ok) throw new Error('Failed to get media URL');
        const mediaData = await mediaRes.json();
        const audioRes  = await fetch(mediaData.url, {
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        if (!audioRes.ok) throw new Error('Failed to download audio');
        const audioBuffer = await audioRes.buffer();
        audioBase64       = audioBuffer.toString('base64');
      } catch (e) {
        console.error('Audio download error:', e.message);
        text = '[Voice message - could not process]';
      }
    } else {
      // Unsupported type — acknowledge and ignore
      return res.sendStatus(200);
    }

    const response = await processMessage(from, 'whatsapp', text, profileName, audioBase64);
    const formatted = formatForWhatsApp(response);
    await sendWhatsAppMessage(from, formatted);

    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
    res.sendStatus(200); // Always return 200 to Meta
  }
});

// ── FORMAT FOR WHATSAPP ───────────────────────────────────────────────────────
// WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```code```
// Does NOT support: **bold**, # headers, [links](url), > quotes
function formatForWhatsApp(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '*$1*')          // **bold** → *bold*
    .replace(/^#{1,3} (.+)$/gm, '*$1*')         // # Header → *Header*
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')  // [text](url) → text
    .replace(/`{3}[a-z]*\n?([\s\S]*?)`{3}/g, '```$1```') // keep code blocks
    .trim();
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const fetch = require('node-fetch');
  const url   = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  // Split long messages (WhatsApp limit: 4096 chars)
  const MAX_LENGTH = 4000;
  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_LENGTH) {
    // Try to split at newline
    const splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
    const cutAt   = splitAt > 0 ? splitAt : MAX_LENGTH;
    chunks.push(remaining.substring(0, cutAt));
    remaining = remaining.substring(cutAt).trim();
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: chunk },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        // Token expired — log clearly
        if (err.error?.code === 190) {
          console.error('❌ WhatsApp token EXPIRED! Go to Meta → API Setup → Generate access token → Update WHATSAPP_TOKEN in Render');
        } else {
          console.error('WhatsApp send error:', JSON.stringify(err));
        }
      }
    } catch (e) {
      console.error('WhatsApp send exception:', e.message);
    }
  }
}

module.exports = router;