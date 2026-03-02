require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ai = new Anthropic({ apiKey: process.env.AI_API_KEY });

const conversations = {};

console.log('🤖 GamaClaw bot started!');

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;

  if (!userMessage) return;

  if (userMessage === '/start') {
    bot.sendMessage(chatId, `👋 Hi! I'm your AI assistant powered by Claude.\n\nAsk me anything!`);
    return;
  }

  // Keep conversation history
  if (!conversations[chatId]) conversations[chatId] = [];
  conversations[chatId].push({ role: 'user', content: userMessage });

  // Keep only last 10 messages
  if (conversations[chatId].length > 10) {
    conversations[chatId] = conversations[chatId].slice(-10);
  }

  try {
    bot.sendChatAction(chatId, 'typing');

    const response = await ai.messages.create({
      model: 'claude-haiku-20240307',
      max_tokens: 1024,
      messages: conversations[chatId],
    });

    const reply = response.content[0].text;
    conversations[chatId].push({ role: 'assistant', content: reply });

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error('AI error:', error);
    bot.sendMessage(chatId, '❌ Sorry, something went wrong. Please try again.');
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});
