const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
async function detectIntent(message) {
  const prompt = `Classify this message into ONE intent. Reply with ONLY the intent word.

Intents:
SEND_EMAIL, READ_CALENDAR, ADD_CALENDAR, SUMMARIZE, LOG_EXPENSE,
VIEW_EXPENSES, ADD_PRICE_ALERT, VIEW_PRICE_ALERTS, SAVE_MEMORY,
MORNING_BRIEFING, ADD_LEAD, VIEW_LEADS, DRAFT_FOLLOWUP,
VOICE_NOTE, UPGRADE_PLAN, VIEW_PLAN, HELP, CHAT

Message: "${message}"`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim().toUpperCase();
}

// ── EMAIL DRAFTING ────────────────────────────────────────────────────────────
async function draftEmail(topic, memoryContext = '') {
  const prompt = `Write a professional email about: "${topic}"
${memoryContext}
Return JSON only (no markdown):
{"subject": "...", "body": "...", "to": "email if mentioned or null"}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { subject: `Re: ${topic}`, body: result.response.text(), to: null };
  }
}

// ── CALENDAR EXTRACTION ───────────────────────────────────────────────────────
async function extractEventDetails(message) {
  const prompt = `Extract event details from: "${message}"
Today: ${new Date().toISOString()}
Return JSON only (no markdown):
{"title":"...","date":"YYYY-MM-DD","time":"HH:MM","duration":60,"description":"..."}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── EXPENSE EXTRACTION ────────────────────────────────────────────────────────
async function extractExpense(message) {
  const prompt = `Extract expense from: "${message}"
Return JSON only (no markdown):
{"amount": number, "category": "food|travel|shopping|bills|health|entertainment|other", "note": "brief description"}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── EXPENSE SUMMARY ───────────────────────────────────────────────────────────
async function summarizeExpenses(expenses) {
  if (!expenses.length) return 'No expenses recorded yet.';

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = {};
  expenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  });

  const breakdown = Object.entries(byCategory)
    .sort(([,a],[,b]) => b-a)
    .map(([cat, amt]) => `  • ${cat}: ₹${amt.toLocaleString('en-IN')}`)
    .join('\n');

  return `💰 *Expense Summary (Last 30 days)*\n\n*Total: ₹${total.toLocaleString('en-IN')}*\n\n*By Category:*\n${breakdown}`;
}

// ── MEETING SUMMARIZER ────────────────────────────────────────────────────────
async function summarizeMeeting(text) {
  const prompt = `Summarize this meeting/text clearly:

${text}

Format:
🎯 *Key Points*
• ...

✅ *Action Items*
• ...

📝 *Decisions*
• ...`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── PRICE ALERT EXTRACTION ────────────────────────────────────────────────────
async function extractPriceAlert(message) {
  const prompt = `Extract price alert from: "${message}"
Return JSON only:
{"item":"product name","target_price":number,"currency":"INR or USD"}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── MEMORY EXTRACTION ─────────────────────────────────────────────────────────
async function extractMemory(message) {
  const prompt = `Extract what the user wants to save/remember from: "${message}"
Return JSON only:
{"key":"short label","value":"what to remember"}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── LEAD EXTRACTION ───────────────────────────────────────────────────────────
async function extractLead(message) {
  const prompt = `Extract lead/contact info from: "${message}"
Return JSON only:
{"name":"...","email":"...or null","source":"...","notes":"..."}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── FOLLOW-UP EMAIL DRAFTER ───────────────────────────────────────────────────
async function draftFollowUp(leadInfo, context = '') {
  const prompt = `Draft a warm, professional follow-up email for this lead:
Name: ${leadInfo.name}
Source: ${leadInfo.source}
Notes: ${leadInfo.notes}
${context}

Return JSON only:
{"subject":"...","body":"..."}`;

  const result = await model.generateContent(prompt);
  try {
    const raw = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { subject: `Following up - ${leadInfo.name}`, body: result.response.text() };
  }
}

// ── MORNING BRIEFING GENERATOR ────────────────────────────────────────────────
async function generateBriefing(userName, events, expenses, memoryContext) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const eventList = events.length
    ? events.slice(0, 3).map(e => `• ${e.summary} at ${new Date(e.start.dateTime || e.start.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`).join('\n')
    : '• No meetings today 🎉';

  const totalSpentToday = expenses
    .filter(e => e.date?.startsWith(new Date().toISOString().split('T')[0]))
    .reduce((s, e) => s + Number(e.amount), 0);

  return `☀️ *${greeting}, ${userName || 'Boss'}!*\n\n` +
    `📅 *Today's Meetings:*\n${eventList}\n\n` +
    `💰 *Spent Today:* ₹${totalSpentToday.toLocaleString('en-IN')}\n\n` +
    `🧠 *Tip:* Type /help to see everything I can do for you!\n\n` +
    `_GamaClaw — Your 24/7 AI Assistant_ 🦀`;
}

// ── GENERAL CHAT ──────────────────────────────────────────────────────────────
async function chat(message, history = [], memoryContext = '') {
  const historyText = history.slice(-8).map(h => `${h.role}: ${h.content}`).join('\n');

  const prompt = `You are GamaClaw, a smart 24/7 personal AI assistant on Telegram/WhatsApp.
You help with tasks, writing, calculations, research, advice, and more.
Be concise, warm, and use emojis naturally. Format with Markdown when helpful.
${memoryContext}

Recent conversation:
${historyText}

User: ${message}
GamaClaw:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── VOICE TRANSCRIPTION (via Gemini) ─────────────────────────────────────────
async function transcribeAndDetect(audioBase64, mimeType = 'audio/ogg') {
  const result = await model.generateContent([
    { inlineData: { data: audioBase64, mimeType } },
    { text: 'Transcribe this audio exactly, then on a new line write "INTENT:" followed by what the user wants to do.' }
  ]);
  return result.response.text();
}

module.exports = {
  detectIntent,
  draftEmail,
  extractEventDetails,
  extractExpense,
  summarizeExpenses,
  summarizeMeeting,
  extractPriceAlert,
  extractMemory,
  extractLead,
  draftFollowUp,
  generateBriefing,
  chat,
  transcribeAndDetect,
};