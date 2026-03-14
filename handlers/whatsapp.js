const express = require('express');
const router = express.Router();
const { processMessage } = require('./processor');
const db = require('../services/db');

const VERIFY_TOKEN   = 'gamaclaw123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// ── DEDUPLICATION CACHE ───────────────────────────────────────────────────────
const processedMessages = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessages.has(msgId)) return true;
  processedMessages.set(msgId, Date.now());
  for (const [id, ts] of processedMessages.entries()) {
    if (Date.now() - ts > CACHE_TTL) processedMessages.delete(id);
  }
  return false;
}

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
  res.sendStatus(200);

  try {
    const entry    = req.body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) return;

    const msg         = messages[0];
    const from        = msg.from;
    const msgId       = msg.id;
    const profileName = value?.contacts?.[0]?.profile?.name || '';

    if (msg.type === 'status') return;

    if (isDuplicate(msgId)) {
      console.log(`⚡ Duplicate message ignored: ${msgId}`);
      return;
    }

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
      return;
    }

    // ── OPT-IN LINK DETECTION ─────────────────────────────────────────────────
    // When a client clicks a freelancer's opt-in link, the message starts with
    // "Hi " or "Hello " followed by the freelancer's bot name
    // Format: "Hi GamaClaw:USERID" — we embed the freelancer's user ID in the link
    if (text) {
      const optInMatch = text.match(/^Hi GamaClaw:([a-zA-Z0-9_-]+)/i);
      if (optInMatch) {
        const freelancerId = optInMatch[1];
        await handleClientOptIn(from, profileName, freelancerId);
        return;
      }
    }

    const response  = await processMessage(from, 'whatsapp', text, profileName, audioBase64);
    const formatted = formatForWhatsApp(response);
    await sendWhatsAppMessage(from, formatted);

  } catch (err) {
    console.error('WhatsApp webhook error:', err.message);
  }
});

// ── HANDLE CLIENT OPT-IN ──────────────────────────────────────────────────────
async function handleClientOptIn(clientPhone, clientName, freelancerId) {
  try {
    // Save client as a lead under the freelancer's account
    await db.supabase.from('leads').insert({
      user_id: freelancerId,
      name: clientName || clientPhone,
      email: null,
      source: 'whatsapp_optin',
      notes: `WhatsApp: ${clientPhone}`,
      status: 'new',
      phone: clientPhone,
      created_at: new Date().toISOString(),
    });

    console.log(`✅ Client opted in: ${clientPhone} → freelancer ${freelancerId}`);

    // Welcome the client
    await sendWhatsAppMessage(clientPhone,
      `👋 Hi ${clientName || 'there'}! You're now connected.\n\nI'll pass your message along. How can I help you?`
    );

    // Notify the freelancer
    const { data: freelancer } = await db.supabase
      .from('users')
      .select('platform_id, platform, name')
      .eq('id', freelancerId)
      .single();

    if (freelancer) {
      const notification = `🔔 *New client opted in!*\n\n👤 ${clientName || 'Unknown'}\n📱 +${clientPhone}\n\nThey are now saved as a lead. You can schedule messages to them!`;
      if (freelancer.platform === 'whatsapp') {
        await sendWhatsAppMessage(freelancer.platform_id, formatForWhatsApp(notification));
      } else if (freelancer.platform === 'telegram') {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
        await bot.sendMessage(freelancer.platform_id, notification, { parse_mode: 'Markdown' });
      }
    }
  } catch (err) {
    console.error('Client opt-in error:', err.message);
  }
}

// ── FORMAT FOR WHATSAPP ───────────────────────────────────────────────────────
function formatForWhatsApp(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/^#{1,3} (.+)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`{3}[a-z]*\n?([\s\S]*?)`{3}/g, '```$1```')
    .trim();
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  const fetch = require('node-fetch');
  const url   = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const MAX_LENGTH = 4000;
  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_LENGTH) {
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