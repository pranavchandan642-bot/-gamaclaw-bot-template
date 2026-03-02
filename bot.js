require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku';
const AI_API_KEY = process.env.AI_API_KEY;

const conversations = {};

console.log(`🤖 GamaClaw bot started with model: ${AI_MODEL}`);

async function getAIResponse(messages) {
  if (AI_MODEL === 'claude-haiku') {
    const ai = new Anthropic({ apiKey: AI_API_KEY });
    const response = await ai.messages.create({
      model: 'claude-haiku-20240307',
      max_tokens: 1024,
      messages,
    });
    return response.content[0].text;
  }

  if (AI_MODEL === 'gpt-4o-mini') {
    const ai = new OpenAI({ apiKey: AI_API_KEY });
    const response = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });
    return response.choices[0].message.content;
  }

  if (AI_MODEL === 'gemini-flash') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        })
      }
    );
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  throw new Error('Unknown AI model');
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;
  if (!userMessage) return;

  if (userMessage === '/start') {
    bot.sendMessage(chatId, `👋 Hi! I'm your AI assistant.\n\nAsk me anything!`);
    return;
  }

  if (!conversations[chatId]) conversations[chatId] = [];
  conversations[chatId].push({ role: 'user', content: userMessage });
  if (conversations[chatId].length > 10) {
    conversations[chatId] = conversations[chatId].slice(-10);
  }

  try {
    bot.sendChatAction(chatId, 'typing');
    const reply = await getAIResponse(conversations[chatId]);
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
