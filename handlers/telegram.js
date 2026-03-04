const TelegramBot = require('node-telegram-bot-api');
const { processMessage } = require('./processor');
const axios = require('axios');

// Use webhook mode to avoid 409 conflicts
const express = require('express');
const app = require('../index').app;

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

// Delay initial start to let old instance fully shut down
setTimeout(startBot, 5000);

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

    // Try sending with Markdown first, fallback to plain text if it fails
    try {
      await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (markdownErr) {
      // Markdown failed — send as plain text
      console.error('Markdown error, retrying as plain text:', markdownErr.message);
      await bot.sendMessage(chatId, response.replace(/[*_`]/g, ''), {
        disable_web_page_preview: true,
      });
    }

  } catch (err) {
    console.error('Telegram error FULL:', err.message, err.stack);
    // Send the actual error in dev mode so we can debug
    const isDev = process.env.NODE_ENV !== 'production';
    await bot.sendMessage(chatId, isDev
      ? '⚠️ Error: ' + err.message
      : '⚠️ Something went wrong. Please try again!'
    );
  }
});

bot.on('polling_error', (err) => {
  if (err.message.includes('409')) return; // harmless conflict during deploy
  console.error('Polling error:', err.message);
});

module.exports = bot;