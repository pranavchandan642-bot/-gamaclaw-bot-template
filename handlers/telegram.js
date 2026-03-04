const TelegramBot = require('node-telegram-bot-api');
const { processMessage } = require('./processor');
const axios = require('axios');

// Clear any existing webhook first, then start polling
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
  polling: {
    autoStart: false,
    params: { timeout: 10, allowed_updates: ['message'] }
  }
});

// Delete webhook and drop pending updates before polling
bot.deleteWebHook({ drop_pending_updates: true })
  .then(() => bot.startPolling())
  .catch(err => console.error('Webhook clear error:', err.message));

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const platformId = String(chatId);
  const userName = msg.from?.first_name || msg.from?.username || '';

  try {
    await bot.sendChatAction(chatId, 'typing');

    let response;

    // Voice message
    if (msg.voice) {
      const fileId = msg.voice.file_id;
      const fileInfo = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${fileInfo.file_path}`;
      const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const audioBase64 = Buffer.from(audioRes.data).toString('base64');
      response = await processMessage(platformId, 'telegram', null, userName, audioBase64);
    } else {
      const text = msg.text?.trim();
      if (!text) return;
      response = await processMessage(platformId, 'telegram', text, userName);
    }

    await bot.sendMessage(chatId, response, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

  } catch (err) {
    console.error('Telegram error:', err);
    await bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again!');
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));
console.log('🤖 Telegram bot started');

module.exports = bot;