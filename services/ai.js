const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── MULTI-MODEL AI CALL ───────────────────────────────────────────────────────

async function askWithModel(prompt, model = 'groq', maxTokens = 1000) {
  switch (model) {
    case 'claude': return await askClaude(prompt, maxTokens);
    case 'gpt':    return await askGPT(prompt, maxTokens);
    case 'gemini': return await askGemini(prompt, maxTokens);
    default:       return await askGroq(prompt, maxTokens);
  }
}

async function askGroq(prompt, maxTokens = 1000) {
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    max_tokens: maxTokens,
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

async function askClaude(prompt, maxTokens = 1000) {
  const fetch = require('node-fetch');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Claude API error');
  return data.content?.[0]?.text?.trim() || '';
}

async function askGPT(prompt, maxTokens = 1000) {
  const fetch = require('node-fetch');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'GPT API error');
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function askGemini(prompt, maxTokens = 1000) {
  const fetch = require('node-fetch');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// Default ask (Groq) — used internally for intent detection, JSON extraction etc
async function ask(prompt, maxTokens = 1000) {
  return await askGroq(prompt, maxTokens);
}

// JSON helper — always uses Groq (fast + free for structured tasks)
async function askJSON(prompt) {
  const raw = await askGroq(prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no backticks, no explanation.');
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
  const eventList = events.length
    ? events.slice(0,3).map(e => `• ${e.summary} at ${new Date(e.start.dateTime||e.start.date).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`).join('\n')
    : '• No meetings today 🎉';
  const totalToday = expenses.filter(e=>e.date?.startsWith(new Date().toISOString().split('T')[0])).reduce((s,e)=>s+Number(e.amount),0);
  return `☀️ *${greeting}, ${userName||'Boss'}!*\n\n📅 *Today's Meetings:*\n${eventList}\n\n💰 *Spent Today:* ₹${totalToday.toLocaleString('en-IN')}\n\n_GamaClaw 🦀_`;
}

// ── VOICE ─────────────────────────────────────────────────────────────────────
async function transcribeAndDetect(audioBase64, mimeType = 'audio/ogg') {
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

// ── CHAT (multi-model) ────────────────────────────────────────────────────────
async function chat(message, history = [], memoryContext = '', aiModel = 'groq') {
  const historyText = history.slice(-10).map(h=>`${h.role}: ${h.content}`).join('\n');

  const modelNames = {
    groq: 'Groq Llama 3.3',
    claude: 'Claude Opus 4.5',
    gpt: 'GPT-4o',
    gemini: 'Gemini 2.0 Flash',
  };

  const systemPrompt = `You are GamaClaw 🦀 — a 24/7 ultra-smart AI personal assistant on Telegram/WhatsApp/Discord.
You are powered by ${modelNames[aiModel] || 'Groq Llama 3.3'}.

YOUR PERSONALITY:
- Warm, friendly, professional — like a brilliant friend who is also an expert
- Use emojis naturally but not excessively
- Format responses with Markdown (bold, bullets, etc.)
- Be concise — no unnecessary padding or repetition
- Speak naturally, not like a robot

YOUR CAPABILITIES — you can help with ANYTHING:
- Answer any question (facts, history, science, sports, entertainment, coding, math)
- Write anything (emails, messages, posts, essays, stories, code, contracts)
- Calculate anything (EMI, tax, percentages, conversions, splits)
- Research any topic and give structured summaries
- Give advice (career, business, relationships, health)
- Help with Indian context (GST, IRCTC, UPI, cricket, Bollywood, Indian laws)
- Speak multiple languages (Hindi, Hinglish, Marathi, Tamil, etc.)

RESPONSE FORMAT RULES:
- For factual answers: direct answer first, then context
- For calculations: show the result prominently, then breakdown
- For writing tasks: deliver the content directly
- Keep responses under 300 words unless task requires more

${memoryContext}

CONVERSATION HISTORY:
${historyText}`;

  try {
    return await askWithModel(`${systemPrompt}\n\nUser: ${message}\nGamaClaw:`, aiModel, 1200);
  } catch (err) {
    console.error(`${aiModel} chat error:`, err.message);
    // Fallback to Groq if selected model fails
    if (aiModel !== 'groq') {
      return await askGroq(`${systemPrompt}\n\nUser: ${message}\nGamaClaw:`, 1200);
    }
    throw err;
  }
}

// ── GST CALCULATOR ────────────────────────────────────────────────────────────
async function calculateGST(message) {
  const d = await askJSON(`Extract GST calculation from: "${message}"\nReturn JSON: {"amount":number,"gst_rate":number,"type":"inclusive or exclusive"}`);
  if (!d) return null;
  let base, gst, total;
  if (d.type === 'inclusive') {
    base = d.amount / (1 + d.gst_rate / 100);
    gst = d.amount - base;
    total = d.amount;
  } else {
    base = d.amount;
    gst = d.amount * d.gst_rate / 100;
    total = d.amount + gst;
  }
  const cgst = gst / 2;
  return `🧾 *GST Calculator*\n\n━━━━━━━━━━━━━━━━━\n💰 Base Amount: *₹${Math.round(base).toLocaleString('en-IN')}*\n📊 GST Rate: *${d.gst_rate}%*\n━━━━━━━━━━━━━━━━━\n🔹 CGST (${d.gst_rate/2}%): ₹${Math.round(cgst).toLocaleString('en-IN')}\n🔹 SGST (${d.gst_rate/2}%): ₹${Math.round(cgst).toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━\n💳 *Total: ₹${Math.round(total).toLocaleString('en-IN')}*\n💵 Total GST: ₹${Math.round(gst).toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━`;
}

// ── SIP CALCULATOR ────────────────────────────────────────────────────────────
async function calculateSIP(message) {
  const d = await askJSON(`Extract SIP details from: "${message}"\nReturn JSON: {"monthly_investment":number,"annual_return":number,"years":number}`);
  if (!d) return null;
  const r = d.annual_return / 12 / 100;
  const n = d.years * 12;
  const fv = d.monthly_investment * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
  const invested = d.monthly_investment * n;
  const returns = fv - invested;
  return `📈 *SIP Calculator*\n\n━━━━━━━━━━━━━━━━━\n💰 Monthly SIP: *₹${d.monthly_investment.toLocaleString('en-IN')}*\n📊 Expected Return: *${d.annual_return}% p.a.*\n📅 Duration: *${d.years} years*\n━━━━━━━━━━━━━━━━━\n💵 Total Invested: ₹${Math.round(invested).toLocaleString('en-IN')}\n📈 Estimated Returns: ₹${Math.round(returns).toLocaleString('en-IN')}\n🏆 *Future Value: ₹${Math.round(fv).toLocaleString('en-IN')}*\n━━━━━━━━━━━━━━━━━\n_Returns are estimated. Mutual funds subject to market risk._`;
}

// ── WEATHER ───────────────────────────────────────────────────────────────────
async function getWeather(message) {
  const city = await ask(`Extract only the city name from: "${message}". Reply with ONLY the city name, nothing else.`);
  const fetch = require('node-fetch');
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const geoData = await geoRes.json();
    if (geoData.results?.length) {
      const { latitude, longitude, name, country } = geoData.results[0];
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto`);
      const w = await wRes.json();
      const c = w.current;
      return `🌤️ *Weather in ${name}, ${country}*\n\n🌡️ *${c.temperature_2m}°C* (feels like ${c.apparent_temperature}°C)\n☁️ ${getWeatherDesc(c.weather_code)}\n💧 Humidity: ${c.relative_humidity_2m}%\n💨 Wind: ${c.wind_speed_10m} km/h`;
    }
  } catch(e) { console.log('Open-Meteo failed:', e.message); }
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (res.ok) {
      const data = await res.json();
      const c = data.current_condition[0];
      const area = data.nearest_area[0].areaName[0].value;
      const country = data.nearest_area[0].country[0].value;
      return `🌤️ *Weather in ${area}, ${country}*\n\n🌡️ *${c.temp_C}°C* (feels like ${c.FeelsLikeC}°C)\n☁️ ${c.weatherDesc[0].value}\n💧 Humidity: ${c.humidity}%\n💨 Wind: ${c.windspeedKmph} km/h`;
    }
  } catch(e) { console.log('wttr.in failed:', e.message); }
  const result = await ask(`What is the typical current weather in ${city} right now? Give realistic temperature, conditions, humidity.`);
  return `🌤️ *Weather in ${city}*\n\n${result}\n\n_⚠️ Live data unavailable — AI estimate_`;
}

function getWeatherDesc(code) {
  if (code === 0) return 'Clear sky ☀️';
  if (code <= 3) return 'Partly cloudy ⛅';
  if (code <= 49) return 'Foggy 🌫️';
  if (code <= 67) return 'Rainy 🌧️';
  if (code <= 77) return 'Snowy ❄️';
  if (code <= 82) return 'Showers 🌦️';
  if (code <= 99) return 'Thunderstorm ⛈️';
  return 'Unknown';
}

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

async function webSearch(message) {
  const result = await ask(`You are a research assistant. Research: "${message}"\n\nProvide:\n📋 *Summary* — 2-3 sentences\n🔍 *Key Facts* — 4-5 bullet points\n💡 *Key Takeaway*\n📌 *Sources to check* — 2-3 websites`, 1200);
  return `🔍 *Research Results*\n\n${result}`;
}

async function extractReminder(message) {
  return await askJSON(`Extract reminder from: "${message}"\nToday: ${new Date().toISOString()}\nReturn JSON: {"text":"what to remind","time":"HH:MM","date":"YYYY-MM-DD or null","recurring":"daily|weekly|monthly|once","day_of_week":"monday etc or null"}`);
}

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

async function searchFlights(message) {
  const d = await askJSON(`Extract flight search from: "${message}"\nReturn JSON: {"from":"city","to":"city","date":"YYYY-MM-DD or relative","passengers":1}`);
  if (!d) return '❌ Try: "Find flights from Delhi to Mumbai tomorrow"';
  const result = await ask(`List 3 realistic flight options from ${d.from} to ${d.to} on ${d.date}. Include airline, times, duration, approximate price in INR.`);
  return `✈️ *Flights: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${result}\n\n🔗 Book: MakeMyTrip · Cleartrip · IndiGo.in\n_Verify prices before booking_`;
}

async function searchTrains(message) {
  const d = await askJSON(`Extract train search from: "${message}"\nReturn JSON: {"from":"city","to":"city","date":"YYYY-MM-DD or relative","class":"sleeper/3AC/2AC or null"}`);
  if (!d) return '❌ Try: "Find trains from Mumbai to Delhi tomorrow"';
  const result = await ask(`List 3-4 popular trains from ${d.from} to ${d.to}. Include name, number, departure, arrival, duration, ${d.class||'3AC'} fare in INR.`);
  return `🚂 *Trains: ${d.from} → ${d.to}*\n📅 ${d.date}\n\n${result}\n\n🔗 Book at: *irctc.co.in*`;
}

async function translateText(message) {
  const d = await askJSON(`Extract translation request from: "${message}"\nReturn JSON: {"text":"text to translate","target_language":"language name"}`);
  if (!d) return '❌ Try: "Translate Hello to Hindi"';
  const translated = await ask(`Translate to ${d.target_language}. Return ONLY the translation:\n\n"${d.text}"`);
  return `🌍 *Translation*\n\n*Original:* ${d.text}\n*${d.target_language}:* ${translated}`;
}

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
  const result = await ask(`Latest score/result for ${query}. Be specific.`);
  return `🏆 *${query}*\n\n${result}\n\n🔗 *cricbuzz.com* · *espncricinfo.com*`;
}

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

async function reviewResume(text) {
  return await ask(`You are a professional HR consultant. Review this resume:\n\n${text}\n\nFormat:\n✅ *Strengths*\n• ...\n\n⚠️ *Weaknesses*\n• ...\n\n💡 *Improvements*\n• ...\n\n🎯 *ATS Score*: X/10\n\n📝 *Suggested Summary*:\n...`, 1500);
}

async function writeContract(message) {
  const result = await ask(`Write a professional freelance contract based on: "${message}"\nInclude: scope, payment terms, IP ownership, confidentiality, termination, governing law (India).`, 2000);
  return `🤝 *CONTRACT DRAFT*\n\n${result}\n\n_⚠️ Consult a lawyer before signing._`;
}

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
  const result = await ask(`What is the approximate current price of ${item} in India?`);
  return `📊 *${item.toUpperCase()} Price*\n\n${result}`;
}

async function checkTrainStatus(message) {
  const trainNum = await ask(`Extract train number from: "${message}". Reply with ONLY the number, or "none".`);
  if (trainNum === 'none' || !trainNum.match(/\d+/)) {
    return '🚂 Please provide a train number. Example: "Check train status 12951"';
  }
  const result = await ask(`Give info about Indian Railway train number ${trainNum}. Include route, major stations, schedule.`);
  return `🚂 *Train ${trainNum}*\n\n${result}\n\n🔗 Live status: *enquiry.indianrail.gov.in*\n📱 NTES app`;
}

async function trackOrder(message) {
  const orderId = await ask(`Extract order/tracking ID from: "${message}". Reply with ONLY the ID, or "none".`);
  if (orderId === 'none') {
    return `📦 *Order Tracker*\n\nPaste your full order ID to track.\n\n🔗 Track directly:\nAmazon: amazon.in/orders\nFlipkart: flipkart.com/account/orders`;
  }
  return `📦 *Order: ${orderId}*\n\nI can't access live order data directly.\n\n🔗 Track at:\n• Amazon: amazon.in/orders\n• Flipkart: flipkart.com/account/orders`;
}

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
  trackOrder, transcribeMeeting, calculateGST, calculateSIP,
};