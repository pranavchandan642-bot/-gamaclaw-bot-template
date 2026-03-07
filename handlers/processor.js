const ai = require('../services/ai');
const db = require('../services/db');
const emailSvc = require('../services/email');
const calendarSvc = require('../services/calendar');

// Pending actions per user - persisted in Supabase memories
const pendingCache = {};

function getPending(userId) {
  if (!pendingCache[userId]) pendingCache[userId] = {};
  return pendingCache[userId];
}

async function savePendingEmail(userId, emailData) {
  pendingCache[userId] = pendingCache[userId] || {};
  pendingCache[userId].pendingEmail = emailData;
  pendingCache[userId].awaitingEmailConfirm = true;
  // Also save to DB so it survives server restarts
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
  return `🦀 *Your GamaClaw Plan*\n\n` +
    `Plan: *${user.plan.toUpperCase()}*\n` +
    `Messages today: *${user.messages_today || 0} / ${limits.daily}*\n\n` +
    `*Available features:*\n${limits.features.map(f => `✅ ${f}`).join('\n')}\n\n` +
    (user.plan === 'free' ? `👉 Type */upgrade* to unlock everything!` : `🎉 You have full access!`);
}

// ── UPGRADE OPTIONS ───────────────────────────────────────────────────────────
async function upgradeOptions(userId = null, userEmail = '', userName = '') {
  const payment = require('./payments');
  
  let proLink = 'Generating...';
  let bizLink = 'Generating...';
  
  // Generate personal payment links if userId provided
  if (userId) {
    try {
      const [pl, bl] = await Promise.all([
        payment.createPaymentLink(userId, 'pro_india', userEmail, userName),
        payment.createPaymentLink(userId, 'business_india', userEmail, userName),
      ]);
      proLink = pl || 'https://gamaclaw.vercel.app/#pricing';
      bizLink = bl || 'https://gamaclaw.vercel.app/#pricing';
    } catch {
      proLink = 'https://gamaclaw.vercel.app/#pricing';
      bizLink = 'https://gamaclaw.vercel.app/#pricing';
    }
  }

  return `⭐ *GamaClaw Plans*\n\n` +
    `🆓 *Free* — ₹0/month\n• 30 messages/day\n• Email draft & send\n• All calculators (EMI, GST, SIP)\n• Weather, News, Translate\n\n` +
    `🚀 *Pro* — ₹499/month\n• 500 messages/day\n• Everything in Free +\n• Expense tracker\n• Invoice generator\n• Lead CRM\n• Flight & train search\n• Voice notes\n• Price alerts\n• Priority support\n\n` +
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
    (isPro ? `*📅 Calendar*\n"Show my meetings" / "Add standup tomorrow 10am"\n\n` : '') +
    (isPro ? `*💰 Expenses*\n"I spent ₹450 on lunch" / "Show my expenses"\n\n` : '') +
    (isPro ? `*🔔 Price Alerts*\n"Alert me when iPhone drops below ₹60000"\n\n` : '') +
    (isPro ? `*🧠 Memory*\n"Remember my boss email is john@acme.com"\n\n` : '') +
    (isPro ? `*☀️ Briefing*\n"/briefing" — Get your daily summary\n\n` : '') +
    (plan === 'business' ? `*🎯 Leads*\n"Add lead: John from LinkedIn, email john@co.com"\n"Show my leads" / "Draft follow-up for John"\n\n` : '') +
    `*🌤️ Weather:* "Weather in Mumbai"\n` +
  `*📰 News:* "Latest news about AI startups"\n` +
  `*🔍 Research:* "Research Tesla competitors"\n` +
  `*✈️ Flights:* "Flights Delhi to Mumbai tomorrow"\n` +
  `*🚂 Trains:* "Trains Mumbai to Pune Friday"\n` +
  `*🌍 Translate:* "Translate hello to Hindi"\n` +
  `*💳 UPI:* Paste any UPI SMS to parse it\n` +
  `*🏏 Sports:* "India cricket score"\n` +
  `*📱 Social:* "Write LinkedIn post about my startup"\n` +
  `*🧮 EMI:* "EMI for ₹40L at 8.5% 20 years"\n` +
  `*⏰ Remind:* "Remind me daily at 7pm to call mom"\n` +
  `*🧾 Invoice:* "Invoice for Rahul ₹15,000 design work"\n` +
  `*📄 Resume:* "Review my resume: [paste resume text]"\n` +
  `*🤝 Contract:* "Write a freelance contract for web design ₹50,000"\n` +
  `*🏦 Gold Price:* "What's today's gold price?"\n` +
  `*🚂 Train Status:* "Check train status 12951"\n` +
  `*📦 Track Order:* "Track my Amazon order 403-1234567"\n` +
  `*💳 UPI History:* Paste multiple UPI SMS messages for summary\n` +
  `*📞 Transcribe:* Send a voice note of your meeting → summary\n\n` +
  `*/plan* — View your plan\n*/upgrade* — See pricing\n*/help* — This message\n\n` +
    (!isPro ? `⭐ Type */upgrade* to unlock calendar, expenses, voice & more!` : `🎉 You have full Pro access!`);
}

// ── MAIN PROCESSOR ────────────────────────────────────────────────────────────
async function processMessage(platformId, platform, messageText, userName = '', audioBase64 = null) {
  // Get/create user
  const user = await db.getOrCreateUser(platformId, platform, userName);
  const p = getPending(user.id || platformId);

  // Check limits
  const limitCheck = await db.checkLimit(user);
  if (!limitCheck.allowed) {
    return `⛔ You've used all *${limitCheck.limit}* messages for today on the *${limitCheck.plan}* plan.\n\n` +
      `Resets at midnight! ${upgradeMessage(limitCheck.plan)}`;
  }

  let text = messageText?.trim() || '';

  // ── VOICE NOTE ──────────────────────────────────────────────────────────────
  if (audioBase64) {
    if (!db.PLAN_LIMITS[user.plan]?.features.includes('voice')) {
      return `🎤 Voice notes are a *Pro feature*!${upgradeMessage(user.plan)}`;
    }
    try {
      const transcription = await ai.transcribeAndDetect(audioBase64);
      text = transcription;
      // Continue processing the transcribed text
    } catch {
      return '❌ Could not process voice note. Please try again.';
    }
  }

  // ── COMMANDS ─────────────────────────────────────────────────────────────────
  if (text === '/start') {
    return `👋 *Welcome to GamaClaw, ${userName || 'there'}!*\n\n` +
      `I'm your 24/7 AI personal assistant.\n\n` +
      helpMessage(user.plan);
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

  // ── PENDING EMAIL CONFIRM ─────────────────────────────────────────────────
  // ── PENDING EMAIL CHECK (survives server restarts) ──────────────────────────
  const pendingEmail = await loadPendingEmail(user.id || platformId);
  if (pendingEmail) {
    const t = text.toLowerCase().trim();
    const isSend = ['send','yes','ok','okay','confirm','y','sure','haan','kar do',
                    'bhej do','send karo'].some(w => t === w) || 
                   t.includes('send it') || t.includes('send now') || 
                   t.includes('go ahead') || t.includes('yes send') ||
                   t.includes('bhej') || t.includes('kar do');
    const isCancel = ['cancel','no','nahi','mat bhejo','stop','dont send'].some(w => t === w);
    const isEdit = t === 'edit' || t === 'change' || t === 'redo' || t.includes('edit');

    if (isSend) {
      try {
        await emailSvc.sendEmail(pendingEmail.to, pendingEmail.subject, pendingEmail.body);
        await clearPendingEmail(user.id || platformId);
        return `✅ *Email sent successfully!*

📧 To: ${pendingEmail.to}
📝 Subject: ${pendingEmail.subject}

_Delivered via GamaClaw 🦀_`;
      } catch (e) {
        await clearPendingEmail(user.id || platformId);
        return `❌ Failed to send: ${e.message}`;
      }
    } else if (isCancel) {
      await clearPendingEmail(user.id || platformId);
      return '❌ Email cancelled.';
    } else if (isEdit) {
      await clearPendingEmail(user.id || platformId);
      return '✏️ Tell me what changes you want and I\'ll redraft it.';
    } else {
      // Remind user about pending email
      return `📧 *You have an unsent email!*

*To:* ${pendingEmail.to}
*Subject:* ${pendingEmail.subject}

Reply *send* ✅ or *cancel* ❌`;
    }
  }

  // ── PENDING EMAIL ADDRESS ────────────────────────────────────────────────
  if (p.awaitingEmailAddress) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = text.match(emailRegex);
    if (match) {
      p.pendingEmail.to = match[0];
      p.awaitingEmailAddress = false;
      p.awaitingEmailConfirm = true;
      return formatEmailPreview(p.pendingEmail);
    }
  }

  await db.incrementMessageCount(user);

  // ── INTENT DETECTION ──────────────────────────────────────────────────────
  const VALID_INTENTS = ['SEND_EMAIL','READ_CALENDAR','ADD_CALENDAR','SUMMARIZE',
    'LOG_EXPENSE','VIEW_EXPENSES','ADD_PRICE_ALERT','VIEW_PRICE_ALERTS','SAVE_MEMORY',
    'MORNING_BRIEFING','ADD_LEAD','VIEW_LEADS','DRAFT_FOLLOWUP','VOICE_NOTE',
    'UPGRADE_PLAN','VIEW_PLAN','HELP','WEATHER','NEWS','WEB_SEARCH','SET_REMINDER',
    'VIEW_REMINDERS','INVOICE','FLIGHT_SEARCH','TRAIN_SEARCH','TRANSLATE','UPI_PARSE',
    'UPI_HISTORY','SPORTS_SCORE','SOCIAL_POST','EMI_CALC','REVIEW_RESUME',
    'WRITE_CONTRACT','COMMODITY_PRICE','TRAIN_STATUS','TRACK_ORDER',
    'TRANSCRIBE_MEETING','CHAT'];
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
      if (!draft) return '❌ Could not draft email. Try: "Send email to john@gmail.com about meeting"';
      await savePendingEmail(user.id || platformId, draft);
      if (!draft.to) {
        p.awaitingEmailAddress = true;
        return `📧 *Email Draft Ready!*\n\n*Subject:* ${draft.subject}\n\n*Body:*\n${draft.body}\n\n❓ Who should I send this to? Reply with the email address.`;
      }
      p.awaitingEmailConfirm = true;
      return formatEmailPreview(draft);
    }

    case 'READ_CALENDAR': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('calendar')) {
        return `📅 Calendar is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      try {
        const events = await calendarSvc.getUpcomingEvents(7);
        return calendarSvc.formatEvents(events);
      } catch (e) {
        return `❌ Calendar error: ${e.message}\n\nMake sure Google Calendar env vars are set in Render.`;
      }
    }

    case 'ADD_CALENDAR': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('calendar')) {
        return `📅 Calendar is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const event = await ai.extractEventDetails(text);
      if (!event) return '❌ Could not understand the event. Try: "Add meeting with John tomorrow at 3pm for 1 hour"';
      try {
        await calendarSvc.addEvent(event.title, event.date, event.time, event.duration, event.description);
        return `✅ *Event Added!*\n\n📌 ${event.title}\n📅 ${event.date} at ${event.time || '09:00'}\n⏱ ${event.duration} minutes`;
      } catch (e) {
        return `❌ Calendar error: ${e.message}`;
      }
    }

    case 'SUMMARIZE': {
      const summary = await ai.summarizeMeeting(text.replace(/summarize[:\s]*/i, ''));
      await db.saveMessage(user.id || platformId, 'user', text);
      await db.saveMessage(user.id || platformId, 'assistant', summary);
      return summary;
    }

    case 'LOG_EXPENSE': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) {
        return `💰 Expense tracking is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const exp = await ai.extractExpense(text);
      if (!exp) return '❌ Could not extract expense. Try: "I spent ₹450 on lunch"';
      await db.logExpense(user.id || platformId, exp.amount, exp.category, exp.note);
      return `✅ *Expense Logged!*\n\n💰 ₹${Number(exp.amount).toLocaleString('en-IN')}\n📂 ${exp.category}\n📝 ${exp.note}`;
    }

    case 'VIEW_EXPENSES': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) {
        return `💰 Expense tracking is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const expenses = await db.getExpenseSummary(user.id || platformId, 30);
      return await ai.summarizeExpenses(expenses);
    }

    case 'ADD_PRICE_ALERT': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('price_alert')) {
        return `🔔 Price alerts are a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const alert = await ai.extractPriceAlert(text);
      if (!alert) return '❌ Could not understand. Try: "Alert me when iPhone 15 drops below ₹60000"';
      await db.addPriceAlert(user.id || platformId, alert.item, alert.target_price, '');
      return `✅ *Price Alert Set!*\n\n🔔 ${alert.item}\n💰 Alert when below ₹${Number(alert.target_price).toLocaleString('en-IN')}\n\nI'll notify you when the price drops!`;
    }

    case 'VIEW_PRICE_ALERTS': {
      const alerts = await db.getActivePriceAlerts(user.id || platformId);
      if (!alerts.length) return '🔔 No active price alerts. Say "Alert me when [product] drops below ₹[price]"';
      return `🔔 *Your Price Alerts:*\n\n` + alerts.map((a, i) => `${i+1}. ${a.item} — below ₹${Number(a.target_price).toLocaleString('en-IN')}`).join('\n');
    }

    case 'SAVE_MEMORY': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('memory')) {
        return `🧠 Memory is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const mem = await ai.extractMemory(text);
      if (!mem) return '❌ Could not understand what to remember. Try: "Remember my boss email is john@acme.com"';
      await db.saveMemory(user.id || platformId, mem.key, mem.value);
      return `✅ *Saved to memory!*\n🧠 ${mem.key}: ${mem.value}`;
    }

    case 'MORNING_BRIEFING': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('briefing')) {
        return `☀️ Daily briefing is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      return await handleBriefing(user);
    }

    case 'ADD_LEAD': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) {
        return `🎯 Lead management is a *Business feature*!${upgradeMessage(user.plan)}`;
      }
      const lead = await ai.extractLead(text);
      if (!lead) return '❌ Try: "Add lead: Sarah from Instagram, email sarah@co.com, interested in Pro plan"';
      await db.saveLead(user.id || platformId, lead.name, lead.email, lead.source, lead.notes);
      return `✅ *Lead Added!*\n\n👤 ${lead.name}\n📧 ${lead.email || 'no email'}\n🔗 ${lead.source}\n📝 ${lead.notes}`;
    }

    case 'VIEW_LEADS': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) {
        return `🎯 Lead management is a *Business feature*!${upgradeMessage(user.plan)}`;
      }
      const leads = await db.getLeads(user.id || platformId);
      if (!leads.length) return '🎯 No leads yet. Say "Add lead: [name], [email], [source]"';
      return `🎯 *Your Leads:*\n\n` + leads.slice(0, 10).map((l, i) =>
        `${i+1}. *${l.name}* (${l.status})\n   📧 ${l.email || 'no email'} | 🔗 ${l.source}`
      ).join('\n\n');
    }

    case 'DRAFT_FOLLOWUP': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('lead_followup')) {
        return `🎯 Follow-up drafting is a *Business feature*!${upgradeMessage(user.plan)}`;
      }
      const leads = await db.getLeads(user.id || platformId);
      if (!leads.length) return '🎯 No leads found. Add a lead first!';
      const lead = leads[0]; // Most recent lead
      const followup = await ai.draftFollowUp(lead, memoryCtx);
      p.pendingEmail = { to: lead.email, subject: followup.subject, body: followup.body };
      p.awaitingEmailConfirm = true;
      return `📧 *Follow-up Draft for ${lead.name}:*\n\n*To:* ${lead.email}\n*Subject:* ${followup.subject}\n\n${followup.body}\n\nReply *SEND* to send or *CANCEL* to discard.`;
    }

    case 'UPGRADE_PLAN':
      return await upgradeOptions(user.id, user.email || '', user.name || '');

    case 'VIEW_PLAN':
      return planInfo(user);

    case 'HELP':
      return helpMessage(user.plan);

    case 'WEATHER':
      return await ai.getWeather(text);

    case 'NEWS':
      return await ai.getNews(text);

    case 'WEB_SEARCH':
      return await ai.webSearch(text);

    case 'SET_REMINDER': {
      const reminder = await ai.extractReminder(text);
      if (!reminder) return '❌ Try: "Remind me to take medicine daily at 9pm"';
      try {
        await db.saveReminder(user.id || platformId, reminder);
      } catch (e) { console.error('Reminder save error:', e.message); }
      const recurText = reminder.recurring !== 'once' ? `\n🔄 ${reminder.recurring}` : '';
      const dateText = reminder.date ? `\n📅 ${reminder.date}` : '';
      return `⏰ *Reminder Set!*\n\n📝 ${reminder.text}\n🕐 ${reminder.time}${dateText}${recurText}\n\n_I'll remind you at the right time!_`;
    }

    case 'VIEW_REMINDERS': {
      const reminders = await db.getReminders(user.id || platformId);
      if (!reminders.length) return '⏰ No active reminders.\n\nSay "Remind me daily at 7pm to call mom" to add one!';
      return `⏰ *Your Reminders (${reminders.length}):*\n\n` + 
        reminders.map((r, i) => `${i+1}. *${r.text}*\n   🕐 ${r.time} · 🔄 ${r.recurring}`).join('\n\n');
    }

    case 'INVOICE': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('email')) {
        return `📊 Invoice generation is a *Pro feature*!${upgradeMessage(user.plan)}`;
      }
      const invoiceDetails = await ai.extractInvoiceDetails(text);
      if (!invoiceDetails) return '❌ Try: "Generate invoice for Rahul ₹15,000 for web design"';
      const invoiceText = await ai.generateInvoiceText(invoiceDetails);
      if (invoiceDetails.client_email) {
        p.pendingEmail = { to: invoiceDetails.client_email, subject: `Invoice ${invoiceDetails.invoice_number}`, body: invoiceText.replace(/[*_]/g, '') };
        p.awaitingEmailConfirm = true;
        return `${invoiceText}\n\nReply *SEND* to email this to ${invoiceDetails.client_email} or *CANCEL* to skip.`;
      }
      return invoiceText;
    }

    case 'FLIGHT_SEARCH':
      return await ai.searchFlights(text);

    case 'TRAIN_SEARCH':
      return await ai.searchTrains(text);

    case 'TRANSLATE':
      return await ai.translateText(text);

    case 'UPI_PARSE': {
      const upiResult = await ai.parseUPIMessage(text);
      // Auto-suggest logging
      p.lastUPIAmount = upiResult;
      return upiResult;
    }

    case 'SPORTS_SCORE':
      return await ai.getSportsScore(text);

    case 'SOCIAL_POST':
      return await ai.writeSocialPost(text);

    case 'EMI_CALC':
      return await ai.calculateEMI(text);

    case 'REVIEW_RESUME':
      return await ai.reviewResume(text);

    case 'WRITE_CONTRACT':
      return await ai.writeContract(text);

    case 'COMMODITY_PRICE':
      return await ai.getCommodityPrice(text);

    case 'TRAIN_STATUS':
      return await ai.checkTrainStatus(text);

    case 'TRACK_ORDER':
      return await ai.trackOrder(text);

    case 'UPI_HISTORY':
      return await ai.parseUPIHistory(text);

    case 'TRANSCRIBE_MEETING': {
      // User sends a voice/audio file - handled in telegram.js
      // If they paste text notes, summarize them
      return await ai.summarizeMeeting(text);
    }

    default: {
      // Smart fallback — handle ANY task the user throws at the bot
      // First check if it's a task we can partially handle with existing tools
      const lowerText = text.toLowerCase();
      
      // GST calculation
      if (lowerText.includes('gst') || lowerText.includes('tax') && lowerText.includes('%')) {
        const result = await ai.calculateGST(text).catch(() => null);
        if (result) {
          await db.saveMessage(user.id || platformId, 'user', text);
          await db.saveMessage(user.id || platformId, 'assistant', result);
          return result;
        }
      }

      // SIP calculation
      if (lowerText.includes('sip') || (lowerText.includes('invest') && lowerText.includes('month') && lowerText.includes('year'))) {
        const result = await ai.calculateSIP(text).catch(() => null);
        if (result) {
          await db.saveMessage(user.id || platformId, 'user', text);
          await db.saveMessage(user.id || platformId, 'assistant', result);
          return result;
        }
      }

      // Detect if user is asking for EMI calculation
      if ((lowerText.includes('emi') || lowerText.includes('loan') || lowerText.includes('home loan') ||
           lowerText.includes('car loan') || lowerText.includes('personal loan')) &&
          (lowerText.includes('%') || lowerText.includes('percent') || lowerText.includes('interest') || lowerText.includes('lakh'))) {
        const result = await ai.calculateEMI(text).catch(() => null);
        if (result && !result.includes('❌')) {
          await db.saveMessage(user.id || platformId, 'user', text);
          await db.saveMessage(user.id || platformId, 'assistant', result);
          return result;
        }
      }

      // Detect if user wants translation even if TRANSLATE intent missed
      if (lowerText.includes('translate') || lowerText.includes('in hindi') || 
          lowerText.includes('in english') || lowerText.includes('in marathi') ||
          lowerText.includes('ko hindi') || lowerText.includes('meaning of')) {
        const result = await ai.translateText(text).catch(() => null);
        if (result && !result.includes('❌')) {
          await db.saveMessage(user.id || platformId, 'user', text);
          await db.saveMessage(user.id || platformId, 'assistant', result);
          return result;
        }
      }

      // Detect weather even if WEATHER intent missed  
      if (lowerText.includes('weather') || lowerText.includes('temperature') || 
          lowerText.includes('mausam') || lowerText.includes('barish') ||
          lowerText.includes('rain') || lowerText.includes('hot') && lowerText.includes('in ')) {
        const result = await ai.getWeather(text).catch(() => null);
        if (result && !result.includes('❌')) {
          await db.saveMessage(user.id || platformId, 'user', text);
          await db.saveMessage(user.id || platformId, 'assistant', result);
          return result;
        }
      }

      // Final fallback: Smart AI chat that can handle ANYTHING
      const reply = await ai.chat(text, history, memoryCtx);
      await db.saveMessage(user.id || platformId, 'user', text);
      await db.saveMessage(user.id || platformId, 'assistant', reply);
      return reply;
    }
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function formatEmailPreview(draft) {
  return `📧 *Email Draft Ready!*\n\n*To:* ${draft.to}\n*Subject:* ${draft.subject}\n\n*Body:*\n${draft.body}\n\n` +
    `Reply *SEND* to send ✅\nReply *EDIT* to redraft ✏️\nReply *CANCEL* to cancel ❌`;
}

async function sendPendingEmail(p, user) {
  const { to, subject, body } = p.pendingEmail;
  try {
    await emailSvc.sendEmail(to, subject, body);
    p.pendingEmail = null;
    return `✅ *Email sent to ${to}!*`;
  } catch (e) {
    return `❌ Failed to send: ${e.message}\n\nCheck EMAIL_USER and EMAIL_PASS in Render environment.`;
  }
}

async function handleBriefing(user) {
  try {
    const events = await calendarSvc.getUpcomingEvents(1);
    const expenses = await db.getExpenseSummary(user.id, 1);
    const memCtx = await db.getMemoryString(user.id);
    return await ai.generateBriefing(user.name, events, expenses, memCtx);
  } catch (e) {
    return `☀️ *Good morning!*\n\nCould not load full briefing: ${e.message}\n\nMake sure your Google Calendar is connected!`;
  }
}

module.exports = { processMessage };