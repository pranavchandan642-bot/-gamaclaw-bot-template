const ai = require('../services/ai');
const db = require('../services/db');
const emailSvc = require('../services/email');
const calendarSvc = require('../services/calendar');

async function runAutoMemory(userId, userMessage) {
  try {
    const result = await ai.extractAutoMemory(userMessage);
    if (result?.found && result?.key && result?.value) {
      await db.saveMemory(userId, result.key, result.value);
      console.log(`🧠 Auto-saved: ${result.key} = ${result.value}`);
    }
  } catch {
    // Silent fail
  }
}

// Pending actions per user
const pendingCache = {};

function getPending(userId) {
  if (!pendingCache[userId]) pendingCache[userId] = {};
  return pendingCache[userId];
}

async function savePendingEmail(userId, emailData) {
  pendingCache[userId] = pendingCache[userId] || {};
  pendingCache[userId].pendingEmail = emailData;
  pendingCache[userId].awaitingEmailConfirm = true;
  await db.saveMemory(userId, 'pending_email', JSON.stringify(emailData)).catch(()=>{});
}

async function loadPendingEmail(userId) {
  if (pendingCache[userId]?.pendingEmail) return pendingCache[userId].pendingEmail;
  try {
    const mem = await db.getMemory(userId, 'pending_email');
    if (mem) {
      const email = JSON.parse(mem);
      pendingCache[userId] = pendingCache[userId] || {};
      pendingCache[userId].pendingEmail = email;
      pendingCache[userId].awaitingEmailConfirm = true;
      return email;
    }
  } catch {}
  return null;
}

async function clearPendingEmail(userId) {
  if (pendingCache[userId]) {
    pendingCache[userId].pendingEmail = null;
    pendingCache[userId].awaitingEmailConfirm = false;
  }
  await db.deleteMemory(userId, 'pending_email').catch(()=>{});
}

// ── UPGRADE MESSAGE ───────────────────────────────────────────────────────────
function upgradeMessage(plan) {
  if (plan === 'free') {
    return `\n\n⭐ *Upgrade to Pro* for unlimited messages + calendar, expense tracker, voice notes & more!\n👉 Send */upgrade* to see plans`;
  }
  return '';
}

// ── PLAN INFO ─────────────────────────────────────────────────────────────────
function planInfo(user) {
  const limits = db.PLAN_LIMITS[user.plan];
  const earlyAdopterBadge = user.is_early_adopter ? '\n🎖️ *Early Adopter* — Free Pro for 1 month!' : '';
  return `🦀 *Your GamaClaw Plan*\n\n` +
    `Plan: *${user.plan.toUpperCase()}*\n` +
    `Messages today: *${user.messages_today || 0} / ${limits.daily}*` +
    earlyAdopterBadge + `\n\n` +
    `*Available features:*\n${limits.features.map(f => `✅ ${f}`).join('\n')}\n\n` +
    (user.plan === 'free' ? `👉 Type */upgrade* to unlock everything!` : `🎉 You have full access!`);
}

// ── UPGRADE OPTIONS ───────────────────────────────────────────────────────────
async function upgradeOptions(userId = null, userEmail = '', userName = '') {
  const payment = require('./payments');
  let proLink = 'https://gamaclaw.vercel.app/#pricing';
  let bizLink = 'https://gamaclaw.vercel.app/#pricing';
  if (userId) {
    try {
      const [pl, bl] = await Promise.all([
        payment.createPaymentLink(userId, 'pro_india', userEmail, userName),
        payment.createPaymentLink(userId, 'business_india', userEmail, userName),
      ]);
      proLink = pl || proLink;
      bizLink = bl || bizLink;
    } catch {}
  }
  return `⭐ *GamaClaw Plans*\n\n` +
    `🆓 *Free* — ₹0/month\n• 30 messages/day\n• Email, Tasks, Reminders\n• EMI, GST, SIP calculators\n• Weather, News, Translate\n\n` +
    `🚀 *Pro* — ₹499/month\n• 500 messages/day\n• Everything in Free +\n• Calendar & Expenses\n• Voice notes\n• Price alerts\n• GST filing assistant\n• Lead CRM\n• All AI models\n• Priority support\n\n` +
    `🏢 *Business* — ₹2,999/month\n• Unlimited messages\n• Everything in Pro +\n• Team features\n• Follow-up automation\n• SLA support\n\n` +
    `💳 *Pay instantly via UPI/Card:*\n` +
    `🚀 Pro (₹499): ${proLink}\n` +
    `🏢 Business (₹2,999): ${bizLink}\n\n` +
    `_Payment auto-upgrades your account instantly!_ ✅`;
}

// ── HELP MESSAGE ──────────────────────────────────────────────────────────────
function helpMessage(plan) {
  const isPro = plan === 'pro' || plan === 'business';
  return `🦀 *GamaClaw — Your 24/7 AI Assistant*\n\n` +
    `*📧 Email*\n"Send an email to john@acme.com about project delay"\n\n` +
    `*💬 Chat*\n"What's the capital of France?" / "Write a tweet about AI"\n\n` +
    `*📝 Summarize*\n"Summarize: [paste meeting notes]"\n\n` +
    `*✅ Tasks*\n"Add task: Call Rahul tomorrow" / "Show my tasks" / "Done task 1"\n\n` +
    (isPro ? `*📅 Calendar*\n"Show my meetings" / "Add standup tomorrow 10am"\n\n` : '') +
    (isPro ? `*💰 Expenses*\n"I spent ₹450 on lunch" / "Show my expenses"\n\n` : '') +
    (isPro ? `*🧾 GST*\n"GST summary" / "Help me file GST this month"\n\n` : '') +
    (isPro ? `*🔔 Price Alerts*\n"Alert me when iPhone drops below ₹60000"\n\n` : '') +
    (isPro ? `*🧠 Memory*\n"Remember my boss email is john@acme.com"\n\n` : '') +
    (isPro ? `*☀️ Briefing*\n"/briefing" — Get your daily summary\n\n` : '') +
    (plan === 'business' ? `*🎯 Leads*\n"Add lead: John from LinkedIn"\n"Show my leads"\n\n` : '') +
    `*🌤️ Weather:* "Weather in Mumbai"\n` +
    `*📰 News:* "Latest news about AI startups"\n` +
    `*✈️ Flights:* "Flights Delhi to Mumbai tomorrow"\n` +
    `*🚂 Trains:* "Trains Mumbai to Pune Friday"\n` +
    `*🌍 Translate:* "Translate hello to Hindi"\n` +
    `*🏏 Sports:* "India cricket score"\n` +
    `*📱 Social:* "Write LinkedIn post about my startup"\n` +
    `*🧮 EMI:* "EMI for ₹40L at 8.5% 20 years"\n` +
    `*⏰ Remind:* "Remind me daily at 7pm to call mom"\n` +
    `*🧾 Invoice:* "Invoice for Rahul ₹15,000 design work"\n` +
    `*🏦 Gold Price:* "What's today's gold price?"\n` +
    `*💳 UPI:* Paste any UPI SMS to parse it\n\n` +
    `*/plan* — View your plan\n*/upgrade* — See pricing\n*/setmodel* — Switch AI model\n*/briefing* — Daily summary\n*/help* — This message\n\n` +
    (!isPro ? `⭐ Type */upgrade* to unlock calendar, expenses, GST & more!` : `🎉 You have full Pro access!`);
}

// ── MAIN PROCESSOR ────────────────────────────────────────────────────────────
async function processMessage(platformId, platform, messageText, userName = '', audioBase64 = null) {
  const user = await db.getOrCreateUser(platformId, platform, userName);
  const p = getPending(user.id || platformId);

  // ── PLATFORM ACCESS CONTROL ───────────────────────────────────────────────
  if (!db.canAccessPlatform(platform, user.plan)) {
    return `🔒 *WhatsApp & Discord access requires Pro or Business plan!*\n\n` +
      `You're currently on the *FREE* plan.\n\n` +
      `👉 Message us on Telegram @GamaClawBot and type */upgrade*\n\n` +
      `🚀 *Pro* — ₹499/month\n🏢 *Business* — ₹2,999/month`;
  }

  const limitCheck = await db.checkLimit(user);
  if (!limitCheck.allowed) {
    return `⛔ You've used all *${limitCheck.limit}* messages for today on the *${limitCheck.plan}* plan.\n\nResets at midnight! ${upgradeMessage(limitCheck.plan)}`;
  }

  let text = messageText?.trim() || '';

  // ── VOICE NOTE ────────────────────────────────────────────────────────────
  if (audioBase64) {
    if (!db.PLAN_LIMITS[user.plan]?.features.includes('voice')) {
      return `🎤 Voice notes are a *Pro feature*!${upgradeMessage(user.plan)}`;
    }
    try {
      text = await ai.transcribeAndDetect(audioBase64);
    } catch {
      return '❌ Could not process voice note. Please try again.';
    }
  }

  // ── COMMANDS ──────────────────────────────────────────────────────────────
  if (text === '/start') {
    const earlyAdopterMsg = user.is_early_adopter
      ? `\n\n🎖️ *You're one of our first 100 users!*\nYou get *FREE Pro access for 1 month* — enjoy all features on us! 🎉`
      : '';
    return `👋 *Welcome to GamaClaw, ${userName || 'there'}!*\n\nI'm your 24/7 AI personal assistant.` + earlyAdopterMsg + `\n\n` + helpMessage(user.plan);
  }

  if (text === '/help') return helpMessage(user.plan);
  if (text === '/plan') return planInfo(user);
  if (text === '/upgrade') return await upgradeOptions(user.id, user.email || '', user.name || '');

  if (text === '/briefing') {
    if (!db.PLAN_LIMITS[user.plan]?.features.includes('briefing')) {
      return `☀️ Daily briefing is a *Pro feature*!${upgradeMessage(user.plan)}`;
    }
    return await handleBriefing(user);
  }

  // ── SETMODEL ──────────────────────────────────────────────────────────────
  if (text.startsWith('/setmodel')) {
    const arg = text.replace('/setmodel', '').trim().toLowerCase();
    const allowed = db.MODEL_PLAN_ACCESS?.[user.plan] || ['groq'];
    const models = db.AVAILABLE_MODELS || {
      groq:   { label: 'Groq (Llama 3) — Fast & Free' },
      claude: { label: 'Claude (Anthropic) — Smart' },
      gpt:    { label: 'GPT-4o (OpenAI) — Powerful' },
      gemini: { label: 'Gemini (Google) — Multimodal' },
    };
    if (!arg) {
      let current = 'groq';
      try { current = await db.getUserModel(user.id); } catch {}
      const lines = Object.entries(models).map(([key, info]) => {
        const isAllowed = allowed.includes(key);
        const isCurrent = key === current;
        return `${isCurrent ? '✅' : isAllowed ? '◻️' : '🔒'} *${key}* — ${info.label}` +
          (!isAllowed ? ' _(Pro required)_' : '') + (isCurrent ? ' ← current' : '');
      });
      return `🤖 *Choose your AI Model*\n\n${lines.join('\n')}\n\nUsage: */setmodel [name]*\n` +
        (!allowed.includes('claude') ? `\n⭐ Upgrade to Pro to unlock Claude, GPT-4o & Gemini!` : '');
    }
    if (!models[arg]) return `❌ Unknown model *${arg}*. Available: ${Object.keys(models).join(', ')}`;
    if (!allowed.includes(arg)) return `🔒 *${models[arg].label}* requires Pro.\n\n👉 Type */upgrade*`;
    try { await db.setUserModel(user.id, arg); } catch {}
    return `✅ *AI Model updated to ${models[arg].label}!*\n\nSwitch anytime with */setmodel*`;
  }

  // ── LINK PHONE ────────────────────────────────────────────────────────────
  if (text.startsWith('/link')) {
    const phone = text.replace('/link', '').trim().replace(/\s/g, '');
    if (!phone) return `📱 *Link accounts!*\n\nUsage: */link +91XXXXXXXXXX*`;
    if (!/^\+?[0-9]{10,15}$/.test(phone)) return `❌ Invalid number. Use: */link +91XXXXXXXXXX*`;
    try {
      const result = await db.linkPhone(user.id, phone);
      if (result.linked && result.plan) return `✅ *Linked!*\n\n📱 ${phone}\n🚀 Plan: *${result.plan.toUpperCase()}*`;
      return `✅ *Phone saved!*\n\n📱 ${phone} linked.`;
    } catch { return `❌ Could not link. Try again.`; }
  }

  // ── AUTO DETECT PHONE ─────────────────────────────────────────────────────
  const phoneMatch = text.match(/^(\+?[0-9]{10,13})$/);
  if (phoneMatch) {
    const phone = phoneMatch[1].startsWith('+') ? phoneMatch[1] : '+91' + phoneMatch[1];
    try { await db.linkPhone(user.id, phone); return `✅ *Phone linked!*\n\n📱 ${phone} 🎉`; }
    catch { return `❌ Could not link. Try: */link +91XXXXXXXXXX*`; }
  }

  // ── CONNECT ───────────────────────────────────────────────────────────────
  if (text.startsWith('/connect')) {
    const code = text.replace('/connect', '').trim();
    if (!code || code.length !== 6) return `🔗 Usage: */connect 123456*\n\nGet code from *gamaclaw.vercel.app/dashboard*`;
    try {
      const result = await db.claimLinkingCode(platformId, platform, code);
      if (result.success) return `✅ *Dashboard linked!*\n\n🌐 gamaclaw.vercel.app/dashboard`;
      if (result.reason === 'expired') return `⏱ Code expired! Get a new one from dashboard.`;
      return `❌ Invalid code.`;
    } catch { return `❌ Could not link. Try again.`; }
  }

  // ── PENDING EMAIL CONFIRM ─────────────────────────────────────────────────
  const pendingEmail = await loadPendingEmail(user.id || platformId);
  if (pendingEmail) {
    const t = text.toLowerCase().trim();
    const isSend = ['send','yes','ok','okay','confirm','y','sure','haan','kar do','bhej do','send karo'].some(w => t === w) ||
                   ['send it','send now','go ahead','yes send','bhej'].some(w => t.includes(w));
    const isCancel = ['cancel','no','nahi','mat bhejo','stop','dont send'].some(w => t === w);
    const isEdit = ['edit','change','redo'].includes(t) || t.includes('edit');

    if (isSend) {
      try {
        await emailSvc.sendEmail(pendingEmail.to, pendingEmail.subject, pendingEmail.body);
        await clearPendingEmail(user.id || platformId);
        return `✅ *Email sent!*\n\n📧 To: ${pendingEmail.to}\n📝 ${pendingEmail.subject}\n\n_Delivered via GamaClaw 🦀_`;
      } catch (e) { await clearPendingEmail(user.id || platformId); return `❌ Failed: ${e.message}`; }
    } else if (isCancel) {
      await clearPendingEmail(user.id || platformId);
      return '❌ Email cancelled.';
    } else if (isEdit) {
      await clearPendingEmail(user.id || platformId);
      return '✏️ Tell me what changes you want.';
    } else {
      return `📧 *Unsent email waiting!*\n\n*To:* ${pendingEmail.to}\n*Subject:* ${pendingEmail.subject}\n\nReply *send* ✅ or *cancel* ❌`;
    }
  }

  if (p.awaitingEmailAddress) {
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (match) {
      p.pendingEmail.to = match[0];
      p.awaitingEmailAddress = false;
      p.awaitingEmailConfirm = true;
      return formatEmailPreview(p.pendingEmail);
    }
  }

  await db.incrementMessageCount(user);

  let userModel = 'groq';
  try { userModel = await db.getUserModel(user.id || platformId); } catch {}

  // ── INTENT DETECTION ──────────────────────────────────────────────────────
  const VALID_INTENTS = [
    'SEND_EMAIL','READ_CALENDAR','ADD_CALENDAR','SUMMARIZE',
    'LOG_EXPENSE','VIEW_EXPENSES','ADD_PRICE_ALERT','VIEW_PRICE_ALERTS','SAVE_MEMORY',
    'MORNING_BRIEFING','ADD_LEAD','VIEW_LEADS','DRAFT_FOLLOWUP','VOICE_NOTE',
    'UPGRADE_PLAN','VIEW_PLAN','HELP','WEATHER','NEWS','WEB_SEARCH','SET_REMINDER',
    'VIEW_REMINDERS','INVOICE','FLIGHT_SEARCH','TRAIN_SEARCH','TRANSLATE','UPI_PARSE',
    'UPI_HISTORY','SPORTS_SCORE','SOCIAL_POST','EMI_CALC','REVIEW_RESUME',
    'WRITE_CONTRACT','COMMODITY_PRICE','TRAIN_STATUS','TRACK_ORDER','TRANSCRIBE_MEETING',
    'ADD_TASK','VIEW_TASKS','COMPLETE_TASK','DELETE_TASK',
    'GST_FILING','GST_SUMMARY',
    'CHAT'
  ];

  let rawIntent = 'CHAT';
  try { rawIntent = await ai.detectIntent(text); } catch {}
  const intent = VALID_INTENTS.includes(rawIntent.trim().toUpperCase())
    ? rawIntent.trim().toUpperCase() : 'CHAT';
  const memoryCtx = await db.getMemoryString(user.id || platformId);
  const history = await db.getRecentMessages(user.id || platformId);

  // ── ROUTE BY INTENT ───────────────────────────────────────────────────────
  switch (intent) {

    case 'SEND_EMAIL': {
      const draft = await ai.draftEmail(text, memoryCtx);
      if (!draft) return '❌ Try: "Send email to john@gmail.com about meeting"';
      await savePendingEmail(user.id || platformId, draft);
      if (!draft.to) {
        p.awaitingEmailAddress = true;
        return `📧 *Email Draft Ready!*\n\n*Subject:* ${draft.subject}\n\n${draft.body}\n\n❓ Who should I send this to?`;
      }
      p.awaitingEmailConfirm = true;
      return formatEmailPreview(draft);
    }

    case 'READ_CALENDAR': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('calendar')) return `📅 Calendar is a *Pro feature*!${upgradeMessage(user.plan)}`;
      try { return calendarSvc.formatEvents(await calendarSvc.getUpcomingEvents(7)); }
      catch (e) { return `❌ Calendar error: ${e.message}`; }
    }

    case 'ADD_CALENDAR': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('calendar')) return `📅 Calendar is a *Pro feature*!${upgradeMessage(user.plan)}`;
      const event = await ai.extractEventDetails(text);
      if (!event) return '❌ Try: "Add meeting with John tomorrow at 3pm"';
      try {
        await calendarSvc.addEvent(event.title, event.date, event.time, event.duration, event.description);
        return `✅ *Event Added!*\n\n📌 ${event.title}\n📅 ${event.date} at ${event.time || '09:00'}`;
      } catch (e) { return `❌ Calendar error: ${e.message}`; }
    }

    case 'SUMMARIZE': {
      const summary = await ai.summarizeMeeting(text.replace(/summarize[:\s]*/i, ''));
      await db.saveMessage(user.id || platformId, 'user', text);
      await db.saveMessage(user.id || platformId, 'assistant', summary);
      return summary;
    }

    case 'LOG_EXPENSE': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `💰 Expense tracking is a *Pro feature*!${upgradeMessage(user.plan)}`;
      const exp = await ai.extractExpense(text);
      if (!exp) return '❌ Try: "I spent ₹450 on lunch"';
      await db.logExpense(user.id || platformId, exp.amount, exp.category, exp.note);
      return `✅ *Expense Logged!*\n\n💰 ₹${Number(exp.amount).toLocaleString('en-IN')}\n📂 ${exp.category}\n📝 ${exp.note}`;
    }

    case 'VIEW_EXPENSES': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `💰 Expense tracking is a *Pro feature*!${upgradeMessage(user.plan)}`;
      return await ai.summarizeExpenses(await db.getExpenseSummary(user.id || platformId, 30));
    }

    case 'ADD_PRICE_ALERT': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('price_alert')) return `🔔 Price alerts are a *Pro feature*!${upgradeMessage(user.plan)}`;
      const alert = await ai.extractPriceAlert(text);
      if (!alert) return '❌ Try: "Alert me when iPhone drops below ₹60000"';
      await db.addPriceAlert(user.id || platformId, alert.item, alert.target_price, '');
      return `✅ *Price Alert Set!*\n\n🔔 ${alert.item}\n💰 Alert when below ₹${Number(alert.target_price).toLocaleString('en-IN')}`;
    }

    case 'VIEW_PRICE_ALERTS': {
      const alerts = await db.getActivePriceAlerts(user.id || platformId);
      if (!alerts.length) return '🔔 No active price alerts.\n\nSay "Alert me when [product] drops below ₹[price]"';
      // Check if user wants to remove an alert
      const num = text.match(/\d+/);
      const wantsRemove = num && (text.toLowerCase().includes('remove') || text.toLowerCase().includes('delete') || text.toLowerCase().includes('cancel'));
      if (wantsRemove) {
        const idx = parseInt(num[0]) - 1;
        if (alerts[idx]) {
          await db.supabase.from('price_alerts').update({ active: false }).eq('id', alerts[idx].id);
          return `✅ *Price alert removed!*\n\n🗑️ "${alerts[idx].item}" deleted.`;
        }
        return `❌ Alert ${num[0]} not found.`;
      }
      return `🔔 *Your Price Alerts:*\n\n` +
        alerts.map((a, i) => `${i+1}. ${a.item} — below ₹${Number(a.target_price).toLocaleString('en-IN')}`).join('\n') +
        `\n\nSay "Remove alert 1" to delete.`;
    }

    case 'SAVE_MEMORY': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('memory')) return `🧠 Memory is a *Pro feature*!${upgradeMessage(user.plan)}`;
      const mem = await ai.extractMemory(text);
      if (!mem) return '❌ Could not understand what to remember.';
      await db.saveMemory(user.id || platformId, mem.key, mem.value);
      return `✅ *Saved!*\n🧠 ${mem.key}: ${mem.value}`;
    }

    case 'MORNING_BRIEFING': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('briefing')) return `☀️ Briefing is a *Pro feature*!${upgradeMessage(user.plan)}`;
      return await handleBriefing(user);
    }

    case 'ADD_LEAD': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) return `🎯 Leads is a *Business feature*!${upgradeMessage(user.plan)}`;
      const lead = await ai.extractLead(text);
      if (!lead) return '❌ Try: "Add lead: Sarah from Instagram, email sarah@co.com"';
      await db.saveLead(user.id || platformId, lead.name, lead.email, lead.source, lead.notes);
      return `✅ *Lead Added!*\n\n👤 ${lead.name}\n📧 ${lead.email || 'no email'}\n🔗 ${lead.source}`;
    }

    case 'VIEW_LEADS': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) return `🎯 Leads is a *Business feature*!${upgradeMessage(user.plan)}`;
      const leads = await db.getLeads(user.id || platformId);
      if (!leads.length) return '🎯 No leads yet.';
      return `🎯 *Your Leads:*\n\n` + leads.slice(0,10).map((l,i) =>
        `${i+1}. *${l.name}* (${l.status})\n   📧 ${l.email || 'no email'} | 🔗 ${l.source}`
      ).join('\n\n');
    }

    case 'DRAFT_FOLLOWUP': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) return `🎯 Follow-up is a *Business feature*!${upgradeMessage(user.plan)}`;
      const leads = await db.getLeads(user.id || platformId);
      if (!leads.length) return '🎯 No leads found. Add one first!';
      const lead = leads[0];
      const followup = await ai.draftFollowUp(lead, memoryCtx);
      p.pendingEmail = { to: lead.email, subject: followup.subject, body: followup.body };
      p.awaitingEmailConfirm = true;
      return `📧 *Follow-up for ${lead.name}:*\n\n*To:* ${lead.email}\n*Subject:* ${followup.subject}\n\n${followup.body}\n\nReply *SEND* or *CANCEL*`;
    }

    case 'UPGRADE_PLAN': return await upgradeOptions(user.id, user.email || '', user.name || '');
    case 'VIEW_PLAN': return planInfo(user);
    case 'HELP': return helpMessage(user.plan);
    case 'WEATHER': return await ai.getWeather(text);
    case 'NEWS': return await ai.getNews(text);
    case 'WEB_SEARCH': return await ai.webSearch(text);

    case 'SET_REMINDER': {
      const tz = db.getTimezoneFromPhone(user.phone);
      const reminder = await ai.extractReminder(text, tz);
      if (!reminder) return '❌ Try: "Remind me daily at 9pm to check emails"';
      try { await db.saveReminder(user.id || platformId, reminder); } catch (e) { console.error('Reminder save error:', e.message); }
      const recurText = reminder.recurring !== 'once' ? `\n🔄 ${reminder.recurring}` : '';
      const dateText = reminder.date ? `\n📅 ${reminder.date}` : '';
      return `⏰ *Reminder Set!*\n\n📝 ${reminder.text}\n🕐 ${reminder.time}${dateText}${recurText}`;
    }

    case 'VIEW_REMINDERS': {
      const reminders = await db.getReminders(user.id || platformId);
      if (!reminders.length) return '⏰ No active reminders.\n\nSay "Remind me daily at 7pm to call mom"';
      return `⏰ *Your Reminders (${reminders.length}):*\n\n` +
        reminders.map((r,i) => `${i+1}. *${r.text}*\n   🕐 ${r.time} · 🔄 ${r.recurring}`).join('\n\n');
    }

    // ── TASK TRACKING ─────────────────────────────────────────────────────
    case 'ADD_TASK': {
      const task = await ai.extractTask(text);
      if (!task) return '❌ Try: "Add task: Call Rahul tomorrow"';
      await db.saveTask(user.id || platformId, task.title, task.due_date, task.priority);
      return `✅ *Task Added!*\n\n📋 ${task.title}${task.due_date ? `\n📅 Due: ${task.due_date}` : ''}${task.priority ? `\n🔥 Priority: ${task.priority}` : ''}`;
    }

    case 'VIEW_TASKS': {
      const tasks = await db.getTasks(user.id || platformId);
      if (!tasks.length) return `📋 *No pending tasks!*\n\nAdd one: "Add task: Call client tomorrow"`;
      const taskList = tasks.map((t,i) =>
        `${i+1}. ${t.priority === 'high' ? '🔥' : t.priority === 'medium' ? '📌' : '📋'} *${t.title}*${t.due_date ? `\n   📅 ${t.due_date}` : ''}`
      ).join('\n\n');
      return `📋 *Your Tasks (${tasks.length}):*\n\n${taskList}\n\nSay "Done task 1" or "Delete task 2"`;
    }

    case 'COMPLETE_TASK': {
      const num = text.match(/\d+/);
      if (!num) return '❌ Say: "Done task 1"';
      const tasks = await db.getTasks(user.id || platformId);
      const idx = parseInt(num[0]) - 1;
      if (!tasks[idx]) return `❌ Task ${num[0]} not found.`;
      await db.completeTask(tasks[idx].id);
      return `✅ *Done!*\n\n~~${tasks[idx].title}~~ ✓\n\nGreat work! 🎉`;
    }

    case 'DELETE_TASK': {
      const num = text.match(/\d+/);
      if (!num) return '❌ Say: "Delete task 1"';
      const tasks = await db.getTasks(user.id || platformId);
      const idx = parseInt(num[0]) - 1;
      if (!tasks[idx]) return `❌ Task ${num[0]} not found.`;
      await db.deleteTask(tasks[idx].id);
      return `🗑️ *Deleted!*\n\n"${tasks[idx].title}" removed.`;
    }

    // ── GST FILING ────────────────────────────────────────────────────────
    case 'GST_FILING': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `🧾 GST Filing is a *Pro feature*!${upgradeMessage(user.plan)}`;
      const expenses = await db.getExpenseSummary(user.id || platformId, 30);
      return await ai.generateGSTFiling(text, expenses, memoryCtx);
    }

    case 'GST_SUMMARY': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `🧾 GST Summary is a *Pro feature*!${upgradeMessage(user.plan)}`;
      const expenses = await db.getExpenseSummary(user.id || platformId, 30);
      return await ai.generateGSTSummary(expenses);
    }

    case 'INVOICE': {
      const invoiceDetails = await ai.extractInvoiceDetails(text);
      if (!invoiceDetails) return '❌ Try: "Invoice for Rahul ₹15,000 for web design"';
      const invoiceText = await ai.generateInvoiceText(invoiceDetails);
      if (invoiceDetails.client_email) {
        p.pendingEmail = { to: invoiceDetails.client_email, subject: `Invoice ${invoiceDetails.invoice_number}`, body: invoiceText.replace(/[*_]/g, '') };
        p.awaitingEmailConfirm = true;
        return `${invoiceText}\n\nReply *SEND* to email or *CANCEL* to skip.`;
      }
      return invoiceText;
    }

    case 'FLIGHT_SEARCH': return await ai.searchFlights(text);
    case 'TRAIN_SEARCH': return await ai.searchTrains(text);
    case 'TRANSLATE': return await ai.translateText(text);
    case 'UPI_PARSE': return await ai.parseUPIMessage(text);
    case 'UPI_HISTORY': return await ai.parseUPIHistory(text);
    case 'SPORTS_SCORE': return await ai.getSportsScore(text);
    case 'SOCIAL_POST': return await ai.writeSocialPost(text);
    case 'EMI_CALC': return await ai.calculateEMI(text);
    case 'REVIEW_RESUME': return await ai.reviewResume(text);
    case 'WRITE_CONTRACT': return await ai.writeContract(text);
    case 'COMMODITY_PRICE': return await ai.getCommodityPrice(text);
    case 'TRAIN_STATUS': return await ai.checkTrainStatus(text);
    case 'TRACK_ORDER': return await ai.trackOrder(text);
    case 'TRANSCRIBE_MEETING': return await ai.summarizeMeeting(text);

    default: {
      const lowerText = text.toLowerCase();

      // Image generation — not supported yet
      if (lowerText.includes('image') || lowerText.includes('photo') || lowerText.includes('picture') ||
          lowerText.includes('इमेज') || lowerText.includes('फोटो') || lowerText.includes('generate image')) {
        return `🖼️ Image generation is not available yet in GamaClaw.\n\nI can help you with:\n• Writing descriptions\n• Finding information about the topic\n• Other tasks!\n\nWhat else can I help you with? 🦀`;
      }

      if (lowerText.includes('gst') || (lowerText.includes('tax') && lowerText.includes('%'))) {
        const result = await ai.calculateGST(text).catch(() => null);
        if (result) { await db.saveMessage(user.id || platformId, 'user', text); await db.saveMessage(user.id || platformId, 'assistant', result); return result; }
      }

      if (lowerText.includes('sip') || (lowerText.includes('invest') && lowerText.includes('month') && lowerText.includes('year'))) {
        const result = await ai.calculateSIP(text).catch(() => null);
        if (result) { await db.saveMessage(user.id || platformId, 'user', text); await db.saveMessage(user.id || platformId, 'assistant', result); return result; }
      }

      if ((lowerText.includes('emi') || lowerText.includes('loan')) && (lowerText.includes('%') || lowerText.includes('lakh'))) {
        const result = await ai.calculateEMI(text).catch(() => null);
        if (result && !result.includes('❌')) { await db.saveMessage(user.id || platformId, 'user', text); await db.saveMessage(user.id || platformId, 'assistant', result); return result; }
      }

      if (lowerText.includes('weather') || lowerText.includes('temperature') || lowerText.includes('mausam')) {
        const result = await ai.getWeather(text).catch(() => null);
        if (result && !result.includes('❌')) { await db.saveMessage(user.id || platformId, 'user', text); await db.saveMessage(user.id || platformId, 'assistant', result); return result; }
      }

      const reply = await ai.chat(text, history, memoryCtx, userModel);
      await db.saveMessage(user.id || platformId, 'user', text);
      await db.saveMessage(user.id || platformId, 'assistant', reply);
      runAutoMemory(user.id || platformId, text).catch(() => {});
      return reply;
    }
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatEmailPreview(draft) {
  return `📧 *Email Draft Ready!*\n\n*To:* ${draft.to}\n*Subject:* ${draft.subject}\n\n*Body:*\n${draft.body}\n\n` +
    `Reply *SEND* ✅ · *EDIT* ✏️ · *CANCEL* ❌`;
}

async function handleBriefing(user) {
  try {
    let events = [];
    try { events = await calendarSvc.getUpcomingEvents(1); } catch {}
    let expenses = [];
    try { expenses = await db.getExpenseSummary(user.id, 1); } catch {}
    const memCtx = await db.getMemoryString(user.id).catch(() => '');
    return await ai.generateBriefing(user.name, events, expenses, memCtx);
  } catch {
    return `☀️ *Good morning, ${user.name || 'there'}!*\n\n📅 Calendar: Not connected\n💰 Expenses: No data yet`;
  }
}

module.exports = { processMessage };