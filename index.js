const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Health check (keeps Render alive) ────────────────────────────────────────
app.get('/', (req, res) => res.send('🦀 GamaClaw is running!'));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── WhatsApp Webhook (Twilio) ─────────────────────────────────────────────────
const whatsappRouter = require('./handlers/whatsapp');
app.use('/webhook/whatsapp', whatsappRouter);

// ── Razorpay Webhook ──────────────────────────────────────────────────────────
const paymentsRouter = require('./handlers/payments');
app.use('/webhook', paymentsRouter);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ GamaClaw server running on port ${PORT}`);
  require('./handlers/telegram');                // Telegram polling
  require('./handlers/discord').startDiscord();  // Discord bot
});