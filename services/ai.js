const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Core Groq call function
async function ask(prompt, maxTokens = 1000) {
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

// JSON helper
async function askJSON(prompt) {
  const raw = await ask(prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no backticks, no explanation.');
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
async function detectIntent(message) {
  const intent = await ask(`Classify this message into ONE intent. Reply with ONLY the intent word, nothing else.

Intents:
SEND_EMAIL, READ_CALENDAR, ADD_CALENDAR, SUMMARIZE, LOG_EXPENSE,
VIEW_EXPENSES, ADD_PRICE_ALERT, VIEW_PRICE_ALERTS, SAVE_MEMORY,
MORNING_BRIEFING, ADD_LEAD, VIEW_LEADS, DRAFT_FOLLOWUP,
VOICE_NOTE, UPGRADE_PLAN, VIEW_PLAN, HELP,
WEATHER, NEWS, WEB_SEARCH, SET_REMINDER, VIEW_REMINDERS,
INVOICE, FLIGHT_SEARCH, TRAIN_SEARCH, TRANSLATE,
UPI_PARSE, UPI_HISTORY, SPORTS_SCORE, SOCIAL_POST, EMI_CALC,
REVIEW_RESUME, WRITE_CONTRACT, COMMODITY_PRICE,
TRAIN_STATUS, TRACK_ORDER, TRANSCRIBE_MEETING, CHAT

Message: "${message}"`);
  return intent.toUpperCase().trim();
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────
async function draftEmail(topic, memoryContext = '') {
  return await askJSON(`Write a professional email about: "${topic}"\n${memoryContext}\nReturn JSON: {"subject":"...","body":"...","to":"email if mentioned or null"}`);
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
async function extractEventDetails(message) {
  return await askJSON(`Extract event details from: "${message}"\nToday: ${new Date().toISOString()}\nReturn JSON: {"title":"...","date":"YYYY-MM-DD","time":"HH:MM","duration":60,"description":"..."}`);
}

// ── EXPENSE ───────────────────────────────────────────────────────────────────
async function extractExpense(message) {
  return await askJSON(`Extract expense from: "${message}"\nReturn JSON: {"amount":number,"category":"food|travel|shopping|bills|health|entertainment|other","note":"brief description"}`);
}

async function summarizeExpenses(expenses) {
  if (!expenses.length) return 'No expenses recorded yet.';
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount); });
  const breakdown = Object.entries(byCategory).sort(([,a],[,b]) => b-a)
    .map(([cat, amt]) => `  • ${cat}: ₹${amt.toLocaleString('en-IN')}`).join('\n');
  return `💰 *Expense Summary*\n\n*Total: ₹${total.toLocaleString('en-IN')}*\n\n*By Category:*\n${breakdown}`;
}

// ── SUMMARIZE ─────────────────────────────────────────────────────────────────
async function summarizeMeeting(text) {
  return await ask(`Summarize this meeting/text:\n\n${text}\n\nFormat:\n🎯 *Key Points*\n• ...\n\n✅ *Action Items*\n• ...\n\n📝 *Decisions*\n• ...`);
}

// ── PRICE ALERT ───────────────────────────────────────────────────────────────
async function extractPriceAlert(message) {
  return await askJSON(`Extract price alert from: "${message}"\nReturn JSON: {"item":"...","target_price":number,"currency":"INR or USD"}`);
}

// ── MEMORY ────────────────────────────────────────────────────────────────────
async function extractMemory(message) {
  return await askJSON(`Extract what to remember from: "${message}"\nReturn JSON: {"key":"short label","value":"what to remember"}`);
}

// ── LEADS ─────────────────────────────────────────────────────────────────────
async function extractLead(message) {
  return await askJSON(`Extract lead info from: "${message}"\nReturn JSON: {"name":"...","email":"or null","source":"...","notes":"..."}`);
}

async function draftFollowUp(leadInfo, context = '') {
  return await askJSON(`Draft follow-up email for: Name: ${leadInfo.name}, Source: ${leadInfo.source}, Notes: ${leadInfo.notes}\n${context}\nReturn JSON: {"subject":"...","body":"..."}`);
}

// ── BRIEFING ──────────────────────────────────────────────────────────────────
async function generateBriefing(userName, events, expenses, memoryContext) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const eventList = events.length ? events.slice(0,3).map(e => `• ${e.summary} at ${new Date(e.start.dateTime||e.start.date).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`).join('\n') : '• No meetings today 🎉';
  const totalToday = expenses.filter(e=>e.date?.startsWith(new Date().toISOString().split('T')[0])).reduce((s,e)=>s+Number(e.amount),0);
  return `☀️ *${greeting}, ${userName||'Boss'}!*\n\n📅 *Today's Meetings:*\n${eventList}\n\n💰 *Spent Today:* ₹${totalToday.toLocaleString('en-IN')}\n\n_GamaClaw 🦀_`;
}

// ── VOICE ─────────────────────────────────────────────────────────────────────
async function transcribeAndDetect(audioBase64, mimeType = 'audio/ogg') {
  // Groq supports Whisper for transcription
  try {
    const { toFile } = require('groq-sdk');
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'audio.ogg', { type: mimeType }),
      model: 'whisper-large-v3',
    });
    const text = transcription.text;
    const intent = await detectIntent(text);
    return `${text}\nINTENT: ${intent}`;
  } catch {
    return 'Could not transcribe audio. Please type your message.';
  }
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
async function chat(message, history = [], memoryContext = '') {
  const historyText = history.slice(-8).map(h=>`${h.role}: ${h.content}`).join('\n');
  return await ask(`You are GamaClaw, a 24/7 AI personal assistant on Telegram/WhatsApp/Discord. Be concise, warm, helpful. Use emojis naturally. Format with Markdown.\n${memoryContext}\n\nRecent conversation:\n${historyText}\n\nUser: ${message}\nGamaClaw:`, 800);
}

// ── WEATHER ───────────────────────────────────────────────────────────────────
async function getWeather(message) {
  const city = await ask(`Extract city name from: "${message}". Reply with ONLY the city name.`);
  try {
    const fetch = require('node-fetch');
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const data = await res.json();
    const c = data.current_condition[0];
    const area = data.nearest_area[0].areaName[0].value;
    const country = data.nearest_area[0].country[0].value;
    return `🌤️ *Weather in ${area}, ${country}*\n\n🌡️ *${c.temp_C}°C* (feels like ${c.FeelsLikeC}°C)\n☁️ ${c.weatherDesc[0].value}\n💧 Humidity: ${c.humidity}%\n💨 Wind: ${c.windspeedKmph} km/h`;
  } catch {
    return `❌ Could not fetch weather for *${city}*. Try: "Weather in Mumbai"`;
  }
}

// ── NEWS ──────────────────────────────────────────────────────────────────────
async function getNews(message) {
  const topic = await ask(`Extract news topic from: "${message}". Reply with ONLY 2-4 words.`);
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    const result = await ask(`Give me 4 recent news headlines about "${topic}". Format as bullet points with brief descriptions.`);
    return `📰 *News: ${topic}*\n\n${result}\n\n_Powered by GamaClaw AI_`;
  }
  try {
    const fetch = require('node-fetch');
    const res = await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&pageSize=4&apiKey=${apiKey}`);
    const data = await res.json();
    if (!data.articles?.length) return `📰 No recent news found for *${topic}*.`;
    let reply = `📰 *Latest: ${topic}*\n\n`;
    data.articles.slice(0,4).forEach((a,i) => { reply += `${i+1}. *${a.title}*\n   ${a.source.name}\n\n`; });
    return reply;
  } catch { return `❌ Could not fetch news.`; }
}

// ── WEB SEARCH ────────────────────────────────────────────────────────────────
async function webSearch(message) {
  const result = await ask(`You are a research assistant. Research: "${message}"\n\nProvide:\n📋 *Summary* — 2-3 sentences\n🔍 *Key Facts* — 4-5 bullet points\n💡 *Key Takeaway*\n📌 *Sources to check* — 2-3 websites`, 1200);
  return `🔍 *Research Results*\n\n${result}`;
}

// ── REMINDER ──────────────────────────────────────────────────────────────────
async function extractReminder(message) {
  return await askJSON(`Extract reminder from: "${message}"\nToday: ${new Date().toISOString()}\nReturn JSON: {"text":"what to remind","time":"HH:MM","date":"YYYY-MM-DD or null for daily","recurring":"daily|weekly|monthly|once","day_of_week":"monday etc or null"}`);
}

// ── INVOICE ───────────────────────────────────────────────────────────────────
async function extractInvoiceDetails(message) {
  return await askJSON(`Extract invoice details from: "${message}"\nReturn JSON: {"client_name":"...","client_email":"or null","items":[{"description":"...","amount":number}],"currency":"INR or USD","invoice_number":"INV-001","due_date":"YYYY-MM-DD or null"}`);
}

async function generateInvoiceText(details) {
  const total = details.items.reduce((s,i)=>s+i.amount,0);
  const sym = details.currency==='USD'?'$':'₹';
  let inv = `🧾 *INVOICE ${details.invoice_number}*\n━━━━━━━━━━━━━━━━━\n`;
  inv += `📅 ${new Date().toLocaleDateString('en-IN')}\n`;
  if (details.due_date) inv += `⏰ Due: ${details.due_date}\n`;
  inv += `\n👤 *${details.client_name}*\n`;
  if (details.client_email) inv += `📧 ${details.client_email}\n`;
  inv += `\n━━━━━━━━━━━━━━━━━\n`;
  details.items.forEach(item=>{inv+=`• ${item.description}: ${sym}${Number(item.amount).toLocaleString('en-IN')}\n`;});
  inv += `━━━━━━━━━━━━━━━━━\n💰 *TOTAL: ${sym}${total.toLocaleString('en-IN')}*\n\n_Generated by GamaClaw 🦀_`;
  return inv;
}

// ── FLIGHTS ───────────────────────────────────────────────────────────────────
async function searchFlights(message) {
  const d = await askJSON(`Extract flight search from: "${message}"\nReturn JSON: {"from":"city","to":"city","date":"YYYY-MM-DD or relative","passengers":1}`);
  if (!d) return '❌ Try: "Find flights from Delhi to Mumbai tomorrow"';
  const result = await ask(`List 3 realistic flight options from ${d.from} to ${d.to} on ${d.date}. Include airline, times, duration, approximate price in INR. Note these are sample prices.`);
  return `✈️ *Flights: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${result}\n\n🔗 Book: MakeMyTrip · Cleartrip · IndiGo.in\n_Verify prices before booking_`;
}

// ── TRAINS ────────────────────────────────────────────────────────────────────
async function searchTrains(message) {
  const d = await askJSON(`Extract train search from: "${message}"\nReturn JSON: {"from":"city","to":"city","date":"YYYY-MM-DD or relative","class":"sleeper/3AC/2AC or null"}`);
  if (!d) return '❌ Try: "Find trains from Mumbai to Delhi tomorrow"';
  const result = await ask(`List 3-4 popular trains from ${d.from} to ${d.to}. Include name, number, departure, arrival, duration, ${d.class||'3AC'} fare in INR.`);
  return `🚂 *Trains: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${result}\n\n🔗 Book at: *irctc.co.in*`;
}

// ── TRANSLATE ─────────────────────────────────────────────────────────────────
async function translateText(message) {
  const d = await askJSON(`Extract translation request from: "${message}"\nReturn JSON: {"text":"text to translate","target_language":"language name"}`);
  if (!d) return '❌ Try: "Translate Hello to Hindi"';
  const translated = await ask(`Translate to ${d.target_language}. Return ONLY the translation, nothing else:\n\n"${d.text}"`);
  return `🌍 *Translation*\n\n*Original:* ${d.text}\n*${d.target_language}:* ${translated}`;
}

// ── UPI PARSER ────────────────────────────────────────────────────────────────
async function parseUPIMessage(message) {
  const txn = await askJSON(`Parse this UPI/bank SMS: "${message}"\nReturn JSON: {"type":"credit or debit","amount":number,"party":"who","upi_id":"or null","balance":null,"reference":"or null"}`);
  if (!txn) return '❌ Paste the full UPI SMS text to parse it.';
  const sym = txn.type==='credit'?'📈':'📉';
  return `${sym} *UPI Transaction*\n\n💰 *₹${Number(txn.amount).toLocaleString('en-IN')}* ${txn.type==='credit'?'received from':'sent to'} ${txn.party}\n`+
    (txn.upi_id?`🔗 ${txn.upi_id}\n`:'')+
    (txn.balance?`🏦 Balance: ₹${Number(txn.balance).toLocaleString('en-IN')}\n`:'')+
    `\n_Say "log this expense" to track it_`;
}

async function parseUPIHistory(text) {
  return await ask(`Parse these UPI transactions and summarize:\n\n${text}\n\nList each transaction, then show:\n📈 Total Received: ₹X\n📉 Total Sent: ₹X\n💰 Net: ₹X\nTop merchants`, 1500);
}

// ── SPORTS ────────────────────────────────────────────────────────────────────
async function getSportsScore(message) {
  const d = await askJSON(`Extract sport query from: "${message}"\nReturn JSON: {"sport":"cricket|football|etc","query":"match or team"}`);
  const query = d ? `${d.sport}: ${d.query}` : message;
  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.CRICAPI_KEY;
    if (apiKey && query.toLowerCase().includes('cricket')) {
      const res = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`);
      const data = await res.json();
      if (data.data?.length) {
        let reply = `🏏 *Live Cricket*\n\n`;
        data.data.slice(0,3).forEach(m => {
          reply += `*${m.name}*\n`;
          m.score?.forEach(s=>{reply+=`  ${s.inning}: ${s.r}/${s.w} (${s.o} ov)\n`;});
          reply += `${m.status}\n\n`;
        });
        return reply;
      }
    }
  } catch {}
  const result = await ask(`Latest score/result for ${query}. Be specific. Suggest official sources if unknown.`);
  return `🏆 *${query}*\n\n${result}\n\n🔗 *cricbuzz.com* · *espncricinfo.com*`;
}

// ── SOCIAL POST ───────────────────────────────────────────────────────────────
async function writeSocialPost(message) {
  const d = await askJSON(`Extract social post request from: "${message}"\nReturn JSON: {"platform":"twitter|linkedin|instagram|facebook","topic":"what to post","tone":"professional|casual|funny|inspirational"}`);
  const platform = d?.platform || 'twitter';
  const topic = d?.topic || message;
  const tone = d?.tone || 'casual';
  const limits = {twitter:280,linkedin:3000,instagram:2200,facebook:500};
  const post = await ask(`Write a ${tone} ${platform} post about: "${topic}". Max ${limits[platform]||280} chars. Include 2-4 hashtags. Write ONLY the post text.`);
  const emojis = {twitter:'🐦',linkedin:'💼',instagram:'📸',facebook:'👥'};
  return `${emojis[platform]||'📱'} *${platform.charAt(0).toUpperCase()+platform.slice(1)} Post*\n\n${post}\n\n_${post.length} characters · Ready to post!_`;
}

// ── EMI CALCULATOR ────────────────────────────────────────────────────────────
async function calculateEMI(message) {
  const d = await askJSON(`Extract loan details from: "${message}"\nReturn JSON: {"principal":number,"rate":annual_percent,"tenure_months":number,"currency":"INR or USD"}`);
  if (!d) return '❌ Try: "EMI for ₹50 lakh at 8.5% for 20 years"';
  const r = d.rate/12/100;
  const emi = d.principal*r*Math.pow(1+r,d.tenure_months)/(Math.pow(1+r,d.tenure_months)-1);
  const total = emi*d.tenure_months;
  const interest = total-d.principal;
  const sym = d.currency==='USD'?'$':'₹';
  return `🧮 *EMI Calculator*\n\n━━━━━━━━━━━━━━━━━\n💰 Loan: *${sym}${d.principal.toLocaleString('en-IN')}*\n📊 Rate: *${d.rate}% p.a.*\n📅 Tenure: *${d.tenure_months} months*\n━━━━━━━━━━━━━━━━━\n💳 *Monthly EMI: ${sym}${Math.round(emi).toLocaleString('en-IN')}*\n💵 Total Payment: ${sym}${Math.round(total).toLocaleString('en-IN')}\n📈 Total Interest: ${sym}${Math.round(interest).toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━`;
}

// ── RESUME REVIEW ─────────────────────────────────────────────────────────────
async function reviewResume(text) {
  return await ask(`You are a professional HR consultant. Review this resume:\n\n${text}\n\nFormat:\n✅ *Strengths*\n• ...\n\n⚠️ *Weaknesses*\n• ...\n\n💡 *Improvements*\n• ...\n\n🎯 *ATS Score*: X/10\n\n📝 *Suggested Summary*:\n...`, 1500);
}

// ── CONTRACT WRITER ───────────────────────────────────────────────────────────
async function writeContract(message) {
  const result = await ask(`Write a professional freelance contract based on: "${message}"\nInclude: scope, payment terms, IP ownership, confidentiality, termination, governing law (India).\nUse clear sections.`, 2000);
  return `🤝 *CONTRACT DRAFT*\n\n${result}\n\n_⚠️ Consult a lawyer before signing._`;
}

// ── COMMODITY PRICE ───────────────────────────────────────────────────────────
async function getCommodityPrice(message) {
  const item = await ask(`What commodity is asked about in: "${message}"? Reply with ONE word: gold/silver/petrol/diesel/crypto`);
  try {
    const fetch = require('node-fetch');
    if (item.toLowerCase().includes('gold')) {
      const res = await fetch('https://api.gold-api.com/price/XAU');
      const data = await res.json();
      const priceINR = data.price * 83.5;
      const per10g = (priceINR/31.1035)*10;
      return `🏦 *Gold Price (Live)*\n\n💰 *₹${Math.round(per10g).toLocaleString('en-IN')} per 10g* (24K)\n🌍 $${data.price.toFixed(2)} per troy oz\n\n_Check jeweller for exact local price_`;
    }
  } catch {}
  const result = await ask(`What is the approximate current price of ${item} in India? Give a helpful answer with context.`);
  return `📊 *${item.toUpperCase()} Price*\n\n${result}`;
}

// ── TRAIN STATUS ──────────────────────────────────────────────────────────────
async function checkTrainStatus(message) {
  const trainNum = await ask(`Extract train number from: "${message}". Reply with ONLY the number, or "none".`);
  if (trainNum === 'none' || !trainNum.match(/\d+/)) {
    return '🚂 Please provide a train number. Example: "Check train status 12951"';
  }
  const result = await ask(`Give info about Indian Railway train number ${trainNum}. Include route, major stations, schedule. Suggest checking NTES app for live status.`);
  return `🚂 *Train ${trainNum}*\n\n${result}\n\n🔗 Live status: *enquiry.indianrail.gov.in*\n📱 NTES app`;
}

// ── ORDER TRACKING ────────────────────────────────────────────────────────────
async function trackOrder(message) {
  const orderId = await ask(`Extract order/tracking ID from: "${message}". Reply with ONLY the ID, or "none".`);
  if (orderId === 'none') {
    return `📦 *Order Tracker*\n\nPaste your full order ID to track.\nExample: "Track order 403-1234567-8901234"\n\n🔗 Track directly:\nAmazon: amazon.in/orders\nFlipkart: flipkart.com/account/orders`;
  }
  return `📦 *Order: ${orderId}*\n\nI can't access live order data directly.\n\n🔗 Track at:\n• Amazon: amazon.in/orders\n• Flipkart: flipkart.com/account/orders\n\n📧 _Forward your shipping SMS here and I'll parse the tracking info!_`;
}

// ── MEETING TRANSCRIPTION ─────────────────────────────────────────────────────
async function transcribeMeeting(audioBase64, mimeType = 'audio/ogg') {
  try {
    const { toFile } = require('groq-sdk');
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'audio.ogg', { type: mimeType }),
      model: 'whisper-large-v3',
    });
    const text = transcription.text;
    const summary = await summarizeMeeting(text);
    return `📝 *Transcript:*\n${text}\n\n${summary}`;
  } catch {
    return '❌ Could not transcribe. Make sure it\'s a clear recording under 10MB.';
  }
}

module.exports = {
  detectIntent, draftEmail, extractEventDetails, extractExpense, summarizeExpenses,
  summarizeMeeting, extractPriceAlert, extractMemory, extractLead, draftFollowUp,
  generateBriefing, transcribeAndDetect, chat,
  getWeather, getNews, webSearch, extractReminder, extractInvoiceDetails,
  generateInvoiceText, searchFlights, searchTrains, translateText,
  parseUPIMessage, parseUPIHistory, getSportsScore, writeSocialPost, calculateEMI,
  reviewResume, writeContract, getCommodityPrice, checkTrainStatus,
  trackOrder, transcribeMeeting,
};