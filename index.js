require('dotenv').config();

const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send(' GamaClaw Platform is running!'));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), bots: botManager.getCount() }));

// ── WhatsApp Webhook ──────────────────────────────────────────────────────────
const whatsappRouter = require('./handlers/whatsapp');
app.use('/webhook/whatsapp', whatsappRouter);

// ── Razorpay Webhook ──────────────────────────────────────────────────────────
const paymentsRouter = require('./handlers/payments');
app.use('/webhook', paymentsRouter);

// ── Bot Manager ───────────────────────────────────────────────────────────────
const botManager = require('./handlers/botManager');

// ── Platform API ──────────────────────────────────────────────────────────────

// Deploy a new bot (called when user signs up on platform)
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

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`✅ GamaClaw Platform running on port ${PORT}`);

  // Start the main GamaClaw bot
  require('./handlers/telegram');
  require('./handlers/discord').startDiscord();

  // Start reminder scheduler
  require('./services/scheduler');

  // Load and restart all previously deployed bots from Supabase
  await botManager.loadDeployedBots();
});