const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const processor = require('./processor');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Store all running bot instances
const runningBots = {};

// ── DEPLOY A NEW BOT ──────────────────────────────────────────────────────────
async function deployBot({ botToken, botName, ownerEmail, aiModel, plan }) {
  // Check if token already deployed
  const existing = Object.values(runningBots).find(b => b.botToken === botToken);
  if (existing) {
    return { botId: existing.botId };
  }

  // Validate token by calling Telegram API
  const fetch = require('node-fetch');
  const validateRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const validateData = await validateRes.json();
  if (!validateData.ok) {
    throw new Error('Invalid Telegram bot token. Get one from @BotFather.');
  }

  const telegramBotName = validateData.result.username;

  // Save to Supabase
  const { data: deployedBot, error } = await supabase
    .from('deployed_bots')
    .insert({
      bot_token: botToken,
      bot_name: botName,
      telegram_username: telegramBotName,
      owner_email: ownerEmail,
      ai_model: aiModel,
      plan,
      status: 'running',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Start the bot instance
  await startBotInstance(deployedBot);

  console.log(`🚀 Deployed bot: @${telegramBotName} for ${ownerEmail}`);
  return { botId: deployedBot.id, telegramUsername: telegramBotName };
}

// ── START A BOT INSTANCE ──────────────────────────────────────────────────────
async function startBotInstance(botConfig) {
  try {
    const bot = new TelegramBot(botConfig.bot_token, { polling: true });

    // Store instance
    runningBots[botConfig.id] = {
      botId: botConfig.id,
      botToken: botConfig.bot_token,
      botName: botConfig.bot_name,
      aiModel: botConfig.ai_model,
      status: 'running',
      instance: bot,
    };

    // Handle messages
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text || '';
      const userName = msg.from?.first_name || 'User';
      const platformId = String(msg.from?.id);

      try {
        // Use botConfig.id as namespace so each bot has its own users
        const namespacedId = `${botConfig.id}:${platformId}`;
        const reply = await processor.processMessage(
          namespacedId,
          'telegram',
          text,
          userName,
          null,
          botConfig.ai_model // pass selected AI model
        );
        await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`Bot ${botConfig.id} error:`, err.message);
        await bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
      }
    });

    bot.on('polling_error', (err) => {
      console.error(`Polling error for bot ${botConfig.id}:`, err.message);
    });

    console.log(`✅ Bot instance started: ${botConfig.bot_name}`);
  } catch (err) {
    console.error(`Failed to start bot ${botConfig.id}:`, err.message);
    runningBots[botConfig.id] = { ...runningBots[botConfig.id], status: 'error' };
  }
}

// ── STOP A BOT ────────────────────────────────────────────────────────────────
async function stopBot(botId) {
  const bot = runningBots[botId];
  if (!bot) throw new Error('Bot not found');

  try {
    await bot.instance.stopPolling();
    delete runningBots[botId];

    await supabase
      .from('deployed_bots')
      .update({ status: 'stopped' })
      .eq('id', botId);

    console.log(`🛑 Stopped bot: ${botId}`);
  } catch (err) {
    console.error(`Stop error:`, err.message);
  }
}

// ── LOAD ALL DEPLOYED BOTS ON STARTUP ─────────────────────────────────────────
async function loadDeployedBots() {
  try {
    const { data: bots } = await supabase
      .from('deployed_bots')
      .select('*')
      .eq('status', 'running');

    if (!bots?.length) {
      console.log('No deployed bots to load.');
      return;
    }

    console.log(`Loading ${bots.length} deployed bots...`);
    for (const bot of bots) {
      await startBotInstance(bot);
    }
    console.log(`✅ All deployed bots loaded!`);
  } catch (err) {
    console.error('loadDeployedBots error:', err.message);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getBot(botId) { return runningBots[botId]; }
function listBots() {
  return Object.values(runningBots).map(b => ({
    botId: b.botId, botName: b.botName, status: b.status, aiModel: b.aiModel,
  }));
}
function getCount() { return Object.keys(runningBots).length; }

module.exports = { deployBot, stopBot, loadDeployedBots, getBot, listBots, getCount };