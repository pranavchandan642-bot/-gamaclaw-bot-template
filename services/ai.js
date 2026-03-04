const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function detectIntent(message) {
  const prompt = `Classify this message into ONE intent. Reply with ONLY the intent word.

Intents:
SEND_EMAIL, READ_CALENDAR, ADD_CALENDAR, SUMMARIZE, LOG_EXPENSE,
VIEW_EXPENSES, ADD_PRICE_ALERT, VIEW_PRICE_ALERTS, SAVE_MEMORY,
MORNING_BRIEFING, ADD_LEAD, VIEW_LEADS, DRAFT_FOLLOWUP,
VOICE_NOTE, UPGRADE_PLAN, VIEW_PLAN, HELP,
WEATHER, NEWS, WEB_SEARCH, SET_REMINDER, VIEW_REMINDERS,
INVOICE, FLIGHT_SEARCH, TRAIN_SEARCH, TRANSLATE,
UPI_PARSE, SPORTS_SCORE, SOCIAL_POST, EMI_CALC,
CHAT

Message: "${message}"`;
  const result = await model.generateContent(prompt);
  return result.response.text().trim().toUpperCase();
}

async function draftEmail(topic, memoryContext = '') {
  const prompt = `Write a professional email about: "${topic}"\n${memoryContext}\nReturn JSON only (no markdown):\n{"subject": "...", "body": "...", "to": "email if mentioned or null"}`;
  const result = await model.generateContent(prompt);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return { subject: `Re: ${topic}`, body: result.response.text(), to: null }; }
}

async function extractEventDetails(message) {
  const prompt = `Extract event details from: "${message}"\nToday: ${new Date().toISOString()}\nReturn JSON only:\n{"title":"...","date":"YYYY-MM-DD","time":"HH:MM","duration":60,"description":"..."}`;
  const result = await model.generateContent(prompt);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function extractExpense(message) {
  const prompt = `Extract expense from: "${message}"\nReturn JSON only:\n{"amount": number, "category": "food|travel|shopping|bills|health|entertainment|other", "note": "brief description"}`;
  const result = await model.generateContent(prompt);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function summarizeExpenses(expenses) {
  if (!expenses.length) return 'No expenses recorded yet.';
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = {};
  expenses.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount); });
  const breakdown = Object.entries(byCategory).sort(([,a],[,b]) => b-a)
    .map(([cat, amt]) => `  • ${cat}: ₹${amt.toLocaleString('en-IN')}`).join('\n');
  return `💰 *Expense Summary (Last 30 days)*\n\n*Total: ₹${total.toLocaleString('en-IN')}*\n\n*By Category:*\n${breakdown}`;
}

async function summarizeMeeting(text) {
  const result = await model.generateContent(`Summarize clearly:\n\n${text}\n\nFormat:\n🎯 *Key Points*\n• ...\n\n✅ *Action Items*\n• ...\n\n📝 *Decisions*\n• ...`);
  return result.response.text();
}

async function extractPriceAlert(message) {
  const result = await model.generateContent(`Extract price alert from: "${message}"\nReturn JSON only:\n{"item":"...","target_price":number,"currency":"INR or USD"}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function extractMemory(message) {
  const result = await model.generateContent(`Extract what to remember from: "${message}"\nReturn JSON only:\n{"key":"short label","value":"what to remember"}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function extractLead(message) {
  const result = await model.generateContent(`Extract lead info from: "${message}"\nReturn JSON only:\n{"name":"...","email":"...or null","source":"...","notes":"..."}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function draftFollowUp(leadInfo, context = '') {
  const result = await model.generateContent(`Draft follow-up email for:\nName: ${leadInfo.name}, Source: ${leadInfo.source}, Notes: ${leadInfo.notes}\n${context}\nReturn JSON only: {"subject":"...","body":"..."}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return { subject: `Following up - ${leadInfo.name}`, body: result.response.text() }; }
}

async function generateBriefing(userName, events, expenses, memoryContext) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const eventList = events.length ? events.slice(0,3).map(e => `• ${e.summary} at ${new Date(e.start.dateTime||e.start.date).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`).join('\n') : '• No meetings today 🎉';
  const totalSpentToday = expenses.filter(e=>e.date?.startsWith(new Date().toISOString().split('T')[0])).reduce((s,e)=>s+Number(e.amount),0);
  return `☀️ *${greeting}, ${userName||'Boss'}!*\n\n📅 *Today's Meetings:*\n${eventList}\n\n💰 *Spent Today:* ₹${totalSpentToday.toLocaleString('en-IN')}\n\n🧠 Type /help to see everything I can do!\n\n_GamaClaw 🦀_`;
}

async function transcribeAndDetect(audioBase64, mimeType = 'audio/ogg') {
  const result = await model.generateContent([{ inlineData: { data: audioBase64, mimeType } }, { text: 'Transcribe this audio, then write "INTENT:" followed by what the user wants.' }]);
  return result.response.text();
}

async function chat(message, history = [], memoryContext = '') {
  const historyText = history.slice(-8).map(h=>`${h.role}: ${h.content}`).join('\n');
  const result = await model.generateContent(`You are GamaClaw, a 24/7 AI personal assistant on Telegram/WhatsApp/Discord. Be concise, warm, use emojis.\n${memoryContext}\n\nRecent:\n${historyText}\n\nUser: ${message}\nGamaClaw:`);
  return result.response.text();
}

// ══════════════════════════════════════════
// NEW FEATURES
// ══════════════════════════════════════════

async function getWeather(message) {
  const cityResult = await model.generateContent(`Extract city name from: "${message}". Reply with ONLY the city name.`);
  const city = cityResult.response.text().trim();
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

async function getNews(message) {
  const topicResult = await model.generateContent(`Extract news topic from: "${message}". Reply with ONLY 2-4 words.`);
  const topic = topicResult.response.text().trim();
  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) {
      const result = await model.generateContent(`Give latest news summary about "${topic}". 4 bullet points, factual, concise.`);
      return `📰 *News: ${topic}*\n\n${result.response.text()}\n\n_Powered by GamaClaw AI_`;
    }
    const res = await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&pageSize=4&apiKey=${apiKey}`);
    const data = await res.json();
    if (!data.articles?.length) return `📰 No recent news found for *${topic}*.`;
    let reply = `📰 *Latest: ${topic}*\n\n`;
    data.articles.slice(0,4).forEach((a,i) => { reply += `${i+1}. *${a.title}*\n   ${a.source.name}\n\n`; });
    return reply;
  } catch { return `❌ Could not fetch news. Try again later.`; }
}

async function webSearch(message) {
  const result = await model.generateContent(`You are a research assistant. Research: "${message}"\n\nProvide:\n📋 *Summary* — 2-3 sentences\n🔍 *Key Facts* — 4-5 points\n💡 *Key Takeaway*\n📌 *Sources to check* — 2-3 websites\n\nUse markdown.`);
  return `🔍 *Research Results*\n\n${result.response.text()}`;
}

async function extractReminder(message) {
  const result = await model.generateContent(`Extract reminder from: "${message}"\nToday: ${new Date().toISOString()}\nReturn JSON only:\n{"text":"what to remind","time":"HH:MM","date":"YYYY-MM-DD or null for daily","recurring":"daily|weekly|monthly|once","day_of_week":"monday etc or null"}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function extractInvoiceDetails(message) {
  const result = await model.generateContent(`Extract invoice details from: "${message}"\nReturn JSON only:\n{"client_name":"...","client_email":"...or null","items":[{"description":"...","amount":number}],"currency":"INR or USD","invoice_number":"INV-001","due_date":"YYYY-MM-DD or null"}`);
  try { return JSON.parse(result.response.text().replace(/```json|```/g, '').trim()); }
  catch { return null; }
}

async function generateInvoiceText(details) {
  const total = details.items.reduce((s,i) => s+i.amount, 0);
  const sym = details.currency === 'USD' ? '$' : '₹';
  let inv = `🧾 *INVOICE ${details.invoice_number}*\n━━━━━━━━━━━━━━━━━\n`;
  inv += `📅 ${new Date().toLocaleDateString('en-IN')}\n`;
  if (details.due_date) inv += `⏰ Due: ${details.due_date}\n`;
  inv += `\n👤 *${details.client_name}*\n`;
  if (details.client_email) inv += `📧 ${details.client_email}\n`;
  inv += `\n━━━━━━━━━━━━━━━━━\n`;
  details.items.forEach(item => { inv += `• ${item.description}: ${sym}${Number(item.amount).toLocaleString('en-IN')}\n`; });
  inv += `━━━━━━━━━━━━━━━━━\n💰 *TOTAL: ${sym}${total.toLocaleString('en-IN')}*\n\n_Generated by GamaClaw 🦀_`;
  return inv;
}

async function searchFlights(message) {
  const result = await model.generateContent(`Extract flight search from: "${message}"\nReturn JSON only:\n{"from":"city","to":"city","date":"YYYY-MM-DD or relative","passengers":1}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { return '❌ Try: "Find flights from Delhi to Mumbai tomorrow"'; }
  const flightResult = await model.generateContent(`Give 3 realistic flight options ${d.from} to ${d.to} on ${d.date}. Include airline, times, duration, price in INR. Note these are sample prices.`);
  return `✈️ *Flights: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${flightResult.response.text()}\n\n🔗 Book: MakeMyTrip · Cleartrip · IndiGo.in\n_Verify prices before booking_`;
}

async function searchTrains(message) {
  const result = await model.generateContent(`Extract train search from: "${message}"\nReturn JSON only:\n{"from":"city","to":"city","date":"YYYY-MM-DD or relative","class":"sleeper/3AC/2AC or null"}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { return '❌ Try: "Find trains from Mumbai to Delhi tomorrow in 3AC"'; }
  const trainResult = await model.generateContent(`List 3-4 popular trains from ${d.from} to ${d.to}. Include name, number, departure, arrival, duration, ${d.class||'3AC'} fare in INR.`);
  return `🚂 *Trains: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${trainResult.response.text()}\n\n🔗 Book at: *irctc.co.in*\n_Check IRCTC for live availability_`;
}

async function translateText(message) {
  const result = await model.generateContent(`Extract translation request from: "${message}"\nReturn JSON only:\n{"text":"text to translate","target_language":"language name"}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { return '❌ Try: "Translate Hello to Hindi" or "Translate this to Tamil: Good morning"'; }
  const translated = await model.generateContent(`Translate to ${d.target_language}. Return ONLY the translation:\n\n"${d.text}"`);
  return `🌍 *Translation*\n\n*Original:* ${d.text}\n*${d.target_language}:* ${translated.response.text().trim()}`;
}

async function parseUPIMessage(message) {
  const result = await model.generateContent(`Parse this UPI/bank SMS: "${message}"\nReturn JSON only:\n{"type":"credit or debit","amount":number,"party":"who","upi_id":"or null","balance":number_or_null,"reference":"or null"}`);
  try {
    const txn = JSON.parse(result.response.text().replace(/```json|```/g,'').trim());
    const sym = txn.type === 'credit' ? '📈' : '📉';
    return `${sym} *UPI Transaction*\n\n💰 *₹${Number(txn.amount).toLocaleString('en-IN')}* ${txn.type === 'credit' ? 'received from' : 'sent to'} ${txn.party}\n`+
      (txn.upi_id ? `🔗 ${txn.upi_id}\n` : '')+
      (txn.balance ? `🏦 Balance: ₹${Number(txn.balance).toLocaleString('en-IN')}\n` : '')+
      (txn.reference ? `📋 Ref: ${txn.reference}\n` : '')+
      `\n_Say "log this expense" to track it_`;
  } catch { return '❌ Paste the full UPI SMS text to parse it.'; }
}

async function getSportsScore(message) {
  const result = await model.generateContent(`Extract sport query from: "${message}"\nReturn JSON only:\n{"sport":"cricket|football|tennis|etc","query":"match or team"}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { d = { sport: 'cricket', query: message }; }
  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.CRICAPI_KEY;
    if (d.sport === 'cricket' && apiKey) {
      const res = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`);
      const data = await res.json();
      if (data.data?.length) {
        let reply = `🏏 *Live Cricket*\n\n`;
        data.data.slice(0,3).forEach(m => {
          reply += `*${m.name}*\n`;
          m.score?.forEach(s => { reply += `  ${s.inning}: ${s.r}/${s.w} (${s.o} ov)\n`; });
          reply += `${m.status}\n\n`;
        });
        return reply;
      }
    }
    const scoreResult = await model.generateContent(`Latest ${d.sport} score/result for: ${d.query}. Be specific. If unknown, suggest official sources.`);
    return `🏆 *${d.sport.toUpperCase()}*\n\n${scoreResult.response.text()}\n\n🔗 *cricbuzz.com* · *espncricinfo.com*`;
  } catch { return `❌ Check cricbuzz.com for live scores.`; }
}

async function writeSocialPost(message) {
  const result = await model.generateContent(`Extract social post request from: "${message}"\nReturn JSON only:\n{"platform":"twitter|linkedin|instagram|facebook","topic":"what to post","tone":"professional|casual|funny|inspirational"}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { d = { platform: 'twitter', topic: message, tone: 'casual' }; }
  const limits = { twitter: 280, linkedin: 3000, instagram: 2200, facebook: 500 };
  const postResult = await model.generateContent(`Write a ${d.tone} ${d.platform} post about: "${d.topic}". Max ${limits[d.platform]||280} chars. Include 2-4 hashtags. Write ONLY the post.`);
  const post = postResult.response.text().trim();
  const emojis = { twitter: '🐦', linkedin: '💼', instagram: '📸', facebook: '👥' };
  return `${emojis[d.platform]||'📱'} *${d.platform.charAt(0).toUpperCase()+d.platform.slice(1)} Post*\n\n${post}\n\n_${post.length} characters · Ready to post!_`;
}

async function calculateEMI(message) {
  const result = await model.generateContent(`Extract loan details from: "${message}"\nReturn JSON only:\n{"principal":number,"rate":annual_percent,"tenure_months":number,"currency":"INR or USD"}`);
  let d;
  try { d = JSON.parse(result.response.text().replace(/```json|```/g,'').trim()); }
  catch { return '❌ Try: "EMI for ₹50 lakh at 8.5% for 20 years"'; }
  const r = d.rate / 12 / 100;
  const emi = d.principal * r * Math.pow(1+r, d.tenure_months) / (Math.pow(1+r, d.tenure_months) - 1);
  const total = emi * d.tenure_months;
  const interest = total - d.principal;
  const sym = d.currency === 'USD' ? '$' : '₹';
  return `🧮 *EMI Calculator*\n\n━━━━━━━━━━━━━━━━━\n`+
    `💰 Loan: *${sym}${d.principal.toLocaleString('en-IN')}*\n`+
    `📊 Rate: *${d.rate}% p.a.*\n`+
    `📅 Tenure: *${d.tenure_months} months*\n`+
    `━━━━━━━━━━━━━━━━━\n`+
    `💳 *Monthly EMI: ${sym}${Math.round(emi).toLocaleString('en-IN')}*\n`+
    `💵 Total Payment: ${sym}${Math.round(total).toLocaleString('en-IN')}\n`+
    `📈 Total Interest: ${sym}${Math.round(interest).toLocaleString('en-IN')}\n`+
    `📊 Interest: ${Math.round(interest/d.principal*100)}% of principal\n`+
    `━━━━━━━━━━━━━━━━━`;
}


// ══════════════════════════════════════════════════════════════
// NEW FEATURES BATCH 2
// ══════════════════════════════════════════════════════════════

// ── RESUME REVIEWER ───────────────────────────────────────────
async function reviewResume(text) {
  const result = await model.generateContent(
    `You are a professional HR consultant and career coach. Review this resume/CV and provide detailed feedback:\n\n${text}\n\n` +
    `Format your response as:\n` +
    `✅ *Strengths*\n• ...\n\n` +
    `⚠️ *Weaknesses*\n• ...\n\n` +
    `💡 *Improvements*\n• ...\n\n` +
    `🎯 *ATS Score Estimate*: X/10\n\n` +
    `📝 *Suggested Summary Line*:\n...`
  );
  return result.response.text();
}

// ── CONTRACT WRITER ───────────────────────────────────────────
async function writeContract(message) {
  const detailsResult = await model.generateContent(
    `Extract contract details from: "${message}"\nReturn JSON only:\n` +
    `{"type":"freelance|employment|nda|service","party1":"your name or Company A","party2":"client name or Company B","scope":"work description","amount":"payment amount or null","duration":"project duration or null","currency":"INR or USD"}`
  );
  let d;
  try { d = JSON.parse(detailsResult.response.text().replace(/```json|```/g,'').trim()); }
  catch { d = { type: 'freelance', party1: 'Service Provider', party2: 'Client', scope: message, amount: null, duration: null, currency: 'INR' }; }

  const result = await model.generateContent(
    `Write a professional ${d.type} contract between ${d.party1} and ${d.party2}.\n` +
    `Scope: ${d.scope}\n` +
    (d.amount ? `Payment: ${d.currency === 'USD' ? '$' : '₹'}${d.amount}\n` : '') +
    (d.duration ? `Duration: ${d.duration}\n` : '') +
    `\nInclude: scope of work, payment terms, IP ownership, confidentiality, termination clause, governing law (India).\n` +
    `Use plain language. Format with clear sections.`
  );
  return `🤝 *${d.type.toUpperCase()} CONTRACT DRAFT*\n\n${result.response.text()}\n\n_⚠️ This is a draft. Consult a lawyer before signing._`;
}

// ── GOLD & COMMODITY PRICES ───────────────────────────────────
async function getCommodityPrice(message) {
  const itemResult = await model.generateContent(
    `What commodity is being asked about in: "${message}"? Reply with ONE word: gold/silver/petrol/diesel/crypto`
  );
  const item = itemResult.response.text().trim().toLowerCase();

  try {
    const fetch = require('node-fetch');
    if (item === 'gold' || item === 'silver') {
      // Free gold price API
      const res = await fetch('https://api.gold-api.com/price/XAU');
      const data = await res.json();
      const priceUSD = data.price;
      const priceINR = priceUSD * 83.5; // approx rate
      const per10g = (priceINR / 31.1035) * 10;
      return `🏦 *Gold Price (Live)*\n\n` +
        `💰 *₹${Math.round(per10g).toLocaleString('en-IN')} per 10g* (24K)\n` +
        `🌍 $${priceUSD.toFixed(2)} per troy oz\n` +
        `💱 Rate: ₹83.5/USD (approx)\n\n` +
        `_Check jeweller for exact local price_`;
    }

    if (item === 'petrol' || item === 'diesel') {
      const result = await model.generateContent(
        `What is the current ${item} price in major Indian cities (Mumbai, Delhi, Bangalore, Chennai) as of 2025? Give approximate prices in ₹/litre. Format nicely.`
      );
      return `⛽ *${item.charAt(0).toUpperCase()+item.slice(1)} Prices India*\n\n${result.response.text()}\n\n_Prices vary by city & date. Check fuel apps for exact price._`;
    }

    // Fallback for crypto etc
    const result = await model.generateContent(`What is the approximate current price of ${item}? Give a concise answer with context.`);
    return `📊 *${item.toUpperCase()} Price*\n\n${result.response.text()}`;
  } catch {
    const result = await model.generateContent(`Give the approximate current ${item} price with context. Be helpful.`);
    return `📊 *${item.toUpperCase()} Price*\n\n${result.response.text()}`;
  }
}

// ── TRAIN STATUS CHECKER ──────────────────────────────────────
async function checkTrainStatus(message) {
  const numResult = await model.generateContent(
    `Extract train number from: "${message}". Reply with ONLY the number (e.g. 12951). If not found reply null.`
  );
  const trainNum = numResult.response.text().trim().replace(/[^0-9]/g, '');

  try {
    const fetch = require('node-fetch');
    const apiKey = process.env.RAILWAYAPI_KEY;

    if (apiKey && trainNum) {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const res = await fetch(`https://indianrailapi.com/api/v2/livetrainstatus/apikey/${apiKey}/trainnumber/${trainNum}/date/${today}/`);
      const data = await res.json();
      if (data.ResponseCode === '200') {
        const t = data;
        let reply = `🚂 *Train ${trainNum} Live Status*\n\n`;
        reply += `*${t.TrainName}*\n`;
        reply += `📍 Current: ${t.CurrentStation?.StationName || 'N/A'}\n`;
        reply += `⏰ Status: ${t.TrainStatus}\n`;
        reply += `🔄 Delay: ${t.DelayTime || 0} mins\n`;
        return reply;
      }
    }

    // Fallback with helpful info
    const infoResult = await model.generateContent(
      `Give info about Indian Railway train number ${trainNum || 'unknown'}. Include route, schedule, and suggest checking NTES app for live status.`
    );
    return `🚂 *Train Status: ${trainNum || 'N/A'}*\n\n${infoResult.response.text()}\n\n` +
      `🔗 *Live status:* NTES app · enquiry.indianrail.gov.in\n` +
      `📱 *Set RAILWAYAPI_KEY in env for real-time tracking*`;
  } catch {
    return `🚂 Check live status at:\n🔗 *enquiry.indianrail.gov.in*\n📱 NTES app (Indian Railways official)`;
  }
}

// ── AMAZON ORDER TRACKER ──────────────────────────────────────
async function trackOrder(message) {
  const extractResult = await model.generateContent(
    `Extract order ID or tracking number from: "${message}". Reply with ONLY the ID/number, or "none" if not found.`
  );
  const orderId = extractResult.response.text().trim();

  if (orderId === 'none' || !orderId) {
    return `📦 *Order Tracker*\n\n` +
      `To track your order, paste the full order ID.\n` +
      `Example: "Track order 403-1234567-8901234"\n\n` +
      `Or track directly:\n` +
      `🔗 Amazon: amazon.in/orders\n` +
      `🔗 Flipkart: flipkart.com/account/orders\n` +
      `🔗 Meesho: meesho.com/my-orders\n` +
      `📧 _Tip: Forward your order confirmation email to me and I'll extract the tracking info!_`;
  }

  const result = await model.generateContent(
    `The user wants to track order: ${orderId}. ` +
    `I cannot access live order data. Tell them how to track it with helpful steps, mention tracking directly on Amazon/Flipkart, and offer to help parse their shipping SMS if they paste it.`
  );
  return `📦 *Order: ${orderId}*\n\n${result.response.text()}`;
}

// ── UPI GMAIL HISTORY PARSER ──────────────────────────────────
async function parseUPIHistory(text) {
  // If user pastes multiple UPI SMS messages
  const result = await model.generateContent(
    `Parse these UPI transaction messages and create a summary:\n\n${text}\n\n` +
    `Extract all transactions and format as:\n` +
    `💳 *UPI Transaction Summary*\n\n` +
    `List each transaction with amount, type (sent/received), party name\n` +
    `Then show:\n` +
    `📈 Total Received: ₹X\n` +
    `📉 Total Sent: ₹X\n` +
    `💰 Net: ₹X\n\n` +
    `Top merchants spent at\n\n` +
    `Use emojis and Indian number format (lakhs/crores).`
  );
  return result.response.text();
}

// ── AUDIO TRANSCRIPTION + SUMMARY ────────────────────────────
async function transcribeMeeting(audioBase64, mimeType = 'audio/ogg') {
  try {
    const result = await model.generateContent([
      { inlineData: { data: audioBase64, mimeType } },
      { text: 'Transcribe this meeting recording completely. Then provide:\n\n📝 TRANSCRIPT:\n[full transcription]\n\n🎯 KEY POINTS:\n• ...\n\n✅ ACTION ITEMS:\n• ...\n\n📋 DECISIONS:\n• ...' }
    ]);
    return result.response.text();
  } catch {
    return '❌ Could not transcribe audio. Make sure it\'s a clear recording under 10MB.\nSupported: .ogg, .mp3, .wav, .m4a';
  }
}



module.exports = {
  detectIntent, draftEmail, extractEventDetails, extractExpense, summarizeExpenses,
  summarizeMeeting, extractPriceAlert, extractMemory, extractLead, draftFollowUp,
  generateBriefing, transcribeAndDetect, chat,
  getWeather, getNews, webSearch, extractReminder, extractInvoiceDetails,
  generateInvoiceText, searchFlights, searchTrains, translateText,
  parseUPIMessage, getSportsScore, writeSocialPost, calculateEMI,
  reviewResume, writeContract, getCommodityPrice, checkTrainStatus,
  trackOrder, parseUPIHistory, transcribeMeeting,
};