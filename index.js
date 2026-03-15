const express = require('express');
const cors = require('cors');
const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: 'https://gamaclaw.vercel.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Bot Manager ───────────────────────────────────────────────────────────────
const botManager = require('./handlers/botManager');

// ── DB ────────────────────────────────────────────────────────────────────────
const db = require('./services/db');

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('🦀 GamaClaw Platform is running!'));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), bots: botManager.getCount() }));

// ── WhatsApp Webhook ──────────────────────────────────────────────────────────
const whatsappRouter = require('./handlers/whatsapp');
app.use('/webhook/whatsapp', whatsappRouter);

// ── Razorpay Webhook ──────────────────────────────────────────────────────────
const paymentsRouter = require('./handlers/payments');
app.use('/webhook', paymentsRouter);

// ── Platform API ──────────────────────────────────────────────────────────────

// Deploy a new bot
app.post('/api/deploy', async (req, res) => {
  try {
    const { botToken, botName, ownerEmail, aiModel, plan } = req.body;
    if (!botToken || !ownerEmail) {
      return res.status(400).json({ error: 'botToken and ownerEmail are required' });
    }
    const result = await botManager.deployBot({
      botToken,
      botName: botName || 'My AI Bot',
      ownerEmail,
      aiModel: aiModel || 'groq',
      plan: plan || 'free',
    });
    res.json({ success: true, botId: result.botId, message: 'Bot deployed successfully!' });
  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stop a bot
app.post('/api/stop', async (req, res) => {
  try {
    const { botId } = req.body;
    await botManager.stopBot(botId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all running bots (admin only)
app.get('/api/bots', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ bots: botManager.listBots() });
});

// Get bot status
app.get('/api/bots/:botId', (req, res) => {
  const bot = botManager.getBot(req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json({ botId: bot.botId, botName: bot.botName, status: bot.status, aiModel: bot.aiModel });
});

// ── PAYMENT LINK API ──────────────────────────────────────────────────────────
app.post('/api/payment-link', async (req, res) => {
  const { plan, email, name, adminKey } = req.body;

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!plan || !email) {
    return res.status(400).json({ error: 'plan and email are required' });
  }

  try {
    const payment = require('./handlers/payments');
    const { data: user } = await db.supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .single();

    const userId = user?.id || email;
    const userName = name || user?.name || '';
    const planKey = plan === 'pro' ? 'pro_india' : 'business_india';

    const link = await payment.createPaymentLink(userId, planKey, email, userName);
    if (!link) throw new Error('Could not generate payment link');

    res.json({ link });
  } catch (err) {
    console.error('Payment link API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── KEEP ALIVE — prevents Render free tier spin-down ─────────────────────────
const https = require('https');
setInterval(() => {
  https.get('https://gamaclaw-bot.onrender.com/health', (res) => {
    console.log(`💓 Keep-alive ping: ${res.statusCode}`);
  }).on('error', (e) => {
    console.log(`💓 Keep-alive error: ${e.message}`);
  });
}, 14 * 60 * 1000);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ GamaClaw Platform running on port ${PORT}`);
  require('./handlers/telegram');
  require('./handlers/discord').startDiscord();
  require('./services/scheduler');
  await botManager.loadDeployedBots();
});