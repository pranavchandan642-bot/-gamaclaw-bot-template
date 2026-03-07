const TelegramBot = require('node-telegram-bot-api');
const { processMessage } = require('./processor');
const db = require('../services/db');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: false });

// Clear any old webhook and start fresh polling with conflict prevention
let pollRetries = 0;
async function startBot() {
  try {
    await bot.stopPolling().catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await bot.deleteWebHook({ drop_pending_updates: true });
    await new Promise(r => setTimeout(r, 3000));
    await bot.startPolling({ restart: false, polling: { interval: 2000, timeout: 10 } });
    pollRetries = 0;
    console.log('🤖 Telegram bot started');
  } catch (err) {
    pollRetries++;
    const delay = Math.min(pollRetries * 5000, 30000);
    console.error(`Bot start error (retry ${pollRetries} in ${delay/1000}s):`, err.message);
    setTimeout(startBot, delay);
  }
}

setTimeout(startBot, 5000);

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const platformId = String(chatId);
  const userName = msg.from?.first_name || msg.from?.username || '';

  try {
    await bot.sendChatAction(chatId, 'typing');

    // ── PHONE NUMBER SHARED ─────────────────────────────────────────────────
    if (msg.contact && msg.contact.phone_number) {
      const phone = msg.contact.phone_number.startsWith('+')
        ? msg.contact.phone_number
        : '+' + msg.contact.phone_number;

      const user = await db.getOrCreateUser(platformId, 'telegram', userName);
      const result = await db.linkPhone(user.id, phone);

      const replyText = result.linked && result.plan
        ? `✅ *Phone linked & plan synced!*\n\n📱 ${phone}\n🚀 Plan: *${result.plan.toUpperCase()}*\n\nYour account is now connected across all platforms!`
        : `✅ *Phone number linked!*\n\n📱 ${phone}\n\nYour GamaClaw account is now connected across Telegram, WhatsApp & Discord! 🎉`;

      await bot.sendMessage(chatId, replyText, {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    let response;

    // ── VOICE MESSAGE ───────────────────────────────────────────────────────
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

    // ── SEND RESPONSE ───────────────────────────────────────────────────────
    try {
      await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (markdownErr) {
      console.error('Markdown error, retrying as plain text:', markdownErr.message);
      await bot.sendMessage(chatId, response.replace(/[*_`]/g, ''), {
        disable_web_page_preview: true,
      });
    }

    // ── ASK FOR PHONE ON /start ─────────────────────────────────────────────
    if (msg.text?.trim() === '/start') {
      // Check if phone already linked
      const user = await db.getOrCreateUser(platformId, 'telegram', userName);
      if (!user.phone) {
        setTimeout(async () => {
          await bot.sendMessage(chatId,
            `📱 *One more thing!*\n\nShare your phone number to link your account across WhatsApp & Discord — so your plan works everywhere!`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [[{
                  text: '📱 Share My Phone Number',
                  request_contact: true,
                }]],
                resize_keyboard: true,
                one_time_keyboard: true,
              },
            }
          );
        }, 1500);
      }
    }

  } catch (err) {
    console.error('Telegram error:', err.message, err.stack);
    const isDev = process.env.NODE_ENV !== 'production';
    await bot.sendMessage(chatId, isDev
      ? '⚠️ Error: ' + err.message
      : '⚠️ Something went wrong. Please try again!'
    );
  }
});

bot.on('polling_error', (err) => {
  if (err.message.includes('409')) return;
  console.error('Polling error:', err.message);
});

module.exports = bot;