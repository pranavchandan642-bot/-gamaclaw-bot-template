const ai = require('../services/ai');
const db = require('../services/db');
const emailSvc = require('../services/email');
const calendarSvc = require('../services/calendar');

// ── ONBOARDING STATE ──────────────────────────────────────────────────────────
const onboardingState = new Map();

async function runAutoMemory(userId, userMessage) {
  try {
    const result = await ai.extractAutoMemory(userMessage);
    if (result?.found && result?.key && result?.value) {
      await db.saveMemory(userId, result.key, result.value);
      console.log(`🧠 Auto-saved: ${result.key} = ${result.value}`);
    }
  } catch { }
}

const pendingCache = {};

function getPending(userId) {
  if (!pendingCache[userId]) pendingCache[userId] = {};
  return pendingCache[userId];
}

async function savePendingEmail(userId, emailData) {
  pendingCache[userId] = pendingCache[userId] || {};
  pendingCache[userId].pendingEmail = emailData;
  pendingCache[userId].awaitingEmailConfirm = true;
  await db.saveMemory(userId, 'pending_email', JSON.stringify(emailData)).catch(() => {});
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
  await db.deleteMemory(userId, 'pending_email').catch(() => {});
}

function upgradeMessage(plan) {
  if (plan === 'free') {
    return `\n\n⭐ *Upgrade to Pro* for unlimited messages + calendar, expense tracker, voice notes & more!\n👉 Send */upgrade* to see plans`;
  }
  return '';
}

function planInfo(user) {
  const limits = db.PLAN_LIMITS[user.plan];
  const earlyAdopterBadge = user.is_early_adopter ? '\n🎖️ *Early Adopter* — Free Pro for 1 month!' : '';
  return ` *Your GamaClaw Plan*\n\n` +
    `Plan: *${user.plan.toUpperCase()}*\n` +
    `Messages today: *${user.messages_today || 0} / ${limits.daily}*` +
    earlyAdopterBadge + `\n\n` +
    `*Available features:*\n${limits.features.map(f => `✅ ${f}`).join('\n')}\n\n` +
    (user.plan === 'free' ? `👉 Type */upgrade* to unlock everything!` : `🎉 You have full access!`);
}

async function upgradeOptions(userId = null, userEmail = '', userName = '') {
  const payment = require('./payments');
  let proLink = 'https://gamaclaw.vercel.app/pricing';
  let bizLink = 'https://gamaclaw.vercel.app/pricing';
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
    `🚀 *Pro* — ₹499/month\n• 500 messages/day\n• Everything in Free +\n• Calendar & Expenses\n• Voice notes\n• Price alerts\n• GST filing assistant\n• Lead CRM\n• Scheduled Messages\n• All AI models\n• Priority support\n\n` +
    `🏢 *Business* — ₹2,999/month\n• Unlimited messages\n• Everything in Pro +\n• Team features\n• Follow-up automation\n• SLA support\n\n` +
    `💳 *Pay instantly via UPI/Card:*\n` +
    `🚀 Pro (₹499): ${proLink}\n` +
    `🏢 Business (₹2,999): ${bizLink}\n\n` +
    `_Payment auto-upgrades your account instantly!_ ✅`;
}

function helpMessage(plan) {
  const isPro = plan === 'pro' || plan === 'business';
  return ` *GamaClaw — Your 24/7 AI Assistant*\n\n` +
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
    (isPro ? `*📅 Scheduled Messages*\n"Schedule message to Rahul +919876543210 every Monday at 10am: Hi, checking in!"\n"/schedules" — View all · "Cancel schedule 1"\n\n` : '') +
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
    `*/plan* — View your plan\n*/upgrade* — See pricing\n*/setmodel* — Switch AI model\n*/briefing* — Daily summary\n*/schedules* — Scheduled messages\n*/help* — This message\n\n` +
    (!isPro ? `⭐ Type */upgrade* to unlock calendar, expenses, GST & more!` : `🎉 You have full Pro access!`);
}

// ── ONBOARDING HELPERS ────────────────────────────────────────────────────────

async function tryLinkCode(code, platformId, platform, name) {
  try {
    const { data: linkRow } = await db.supabase
      .from('linking_codes')
      .select('*')
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!linkRow) return { success: false };

    await db.supabase
      .from('linking_codes')
      .update({ used: true })
      .eq('code', code);

    await db.supabase
      .from('users')
      .upsert({
        auth_user_id: linkRow.auth_user_id,
        platform_id: String(platformId),
        platform,
        name,
        email: linkRow.auth_email,
        plan: 'free',
      }, { onConflict: 'auth_user_id' });

    return { success: true };
  } catch (e) {
    console.error('tryLinkCode error:', e);
    return { success: false };
  }
}

async function savePhone(platformId, platform, phone) {
  try {
    await db.supabase
      .from('users')
      .update({ phone })
      .eq('platform_id', String(platformId))
      .eq('platform', platform);
  } catch (e) {
    console.error('savePhone error:', e);
  }
}

// ── MAIN PROCESSOR ────────────────────────────────────────────────────────────
async function processMessage(platformId, platform, messageText, userName = '', audioBase64 = null) {

  let text = messageText?.trim() || '';
  text = text.replace(/^["'""]|["'""]$/g, '').trim();

  // ── STEP 1: HANDLE /start ─────────────────────────────────────────────────
  if (text === '/start' || text.startsWith('/start ')) {
    const parts = text.split(' ');
    const codeFromDeepLink = parts[1];

    // Always check DB first — don't rely on memory state
    const { data: existingUser } = await db.supabase
      .from('users')
      .select('platform_id, phone')
      .eq('platform_id', String(platformId))
      .eq('platform', platform)
      .maybeSingle();

    // Already fully onboarded — welcome back
    if (existingUser?.platform_id && existingUser?.phone) {
      const user = await db.getOrCreateUser(platformId, platform, userName);
      return `👋 *Welcome back, ${userName || 'there'}!*\n\n` + helpMessage(user.plan);
    }

    // Linked but no phone yet
    if (existingUser?.platform_id && !existingUser?.phone) {
      onboardingState.set(String(platformId), { step: 'awaiting_phone' });
      return `📱 Please send your *phone number* to activate.\n\nExample: \`+91 9876543210\``;
    }

    // Not linked — ask for code
    onboardingState.set(String(platformId), { step: 'awaiting_code' });

    if (codeFromDeepLink && /^\d{6}$/.test(codeFromDeepLink)) {
      return `👋 *Welcome to GamaClaw, ${userName || 'there'}!*\n\n` +
        `I can see your connect code from the website.\n\n` +
        `Just send me this code to activate:\n\n` +
        `🔑 *${codeFromDeepLink}*\n\n` +
        `_(Just type it or copy-paste it below)_ 👇`;
    }

    return `👋 *Welcome to GamaClaw!*\n\n` +
      `To activate your bot:\n\n` +
      `1️⃣ Go to *gamaclaw.vercel.app/activate*\n` +
      `2️⃣ Sign in with Google\n` +
      `3️⃣ Copy the 6-digit code shown on that page\n` +
      `4️⃣ Send it here\n\n` +
      `Already have your code? Just send the 6 digits now! 👇`;
  }

  // ── STEP 2: HANDLE ONBOARDING STATE ──────────────────────────────────────
  let obState = onboardingState.get(String(platformId));

  // Recover state from DB if bot restarted and lost memory
  if (!obState) {
    const { data: recovering } = await db.supabase
      .from('users')
      .select('platform_id, phone')
      .eq('platform_id', String(platformId))
      .eq('platform', platform)
      .maybeSingle();

    if (recovering?.platform_id && !recovering?.phone) {
      obState = { step: 'awaiting_phone' };
      onboardingState.set(String(platformId), obState);
    } else if (!recovering?.platform_id) {
      const trimmed = text.replace(/\s+/g, '').replace(/-/g, '');
      if (/^\d{6}$/.test(trimmed)) {
        obState = { step: 'awaiting_code' };
        onboardingState.set(String(platformId), obState);
      }
    }
  }

  if (obState?.step === 'awaiting_code') {
    const trimmed = text.replace(/\s+/g, '').replace(/-/g, '').replace('/connect', '').trim();
    if (/^\d{6}$/.test(trimmed)) {
      const linked = await tryLinkCode(trimmed, platformId, platform, userName);
      if (linked.success) {
        onboardingState.set(String(platformId), { step: 'awaiting_phone' });
        return `✅ *Code accepted! Welcome, ${userName || 'there'}!*\n\n` +
          `📱 *One last step!*\n\n` +
          `Please send your *phone number* to activate your account.\n\n` +
          `Type it with country code:\n` +
          `Example: \`+91 9876543210\`\n\n` +
          `_This is required to use GamaClaw._`;
      } else {
        return `❌ That code is *invalid or expired*.\n\n` +
          `Please go to *gamaclaw.vercel.app/activate* and copy a fresh 6-digit code.`;
      }
    } else {
      return `Please send your *6-digit connect code* from:\n*gamaclaw.vercel.app/activate*\n\nExample: \`482910\``;
    }
  }

  if (obState?.step === 'awaiting_phone') {
    const phoneRaw = text.trim();
    const phoneClean = phoneRaw.replace(/[\s\-().]/g, '');
    if (phoneClean.length >= 8 && /^[\+0-9]+$/.test(phoneClean)) {
      await savePhone(platformId, platform, phoneClean);
      onboardingState.delete(String(platformId));
      return `🎉 *You're all set, ${userName || 'there'}!*\n\n` +
        `Your GamaClaw bot is now *active*! 🚀\n\n` +
        `📊 *View your dashboard:*\n👉 gamaclaw.vercel.app/dashboard\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `Try saying:\n` +
        `• "What's the weather in Delhi?"\n` +
        `• "Remind me at 9pm to call mom"\n` +
        `• "Add task: Follow up with client"\n\n` +
        `Type */help* to see everything I can do! 💪`;
    } else {
      return `Please send a *valid phone number* with country code.\n\nExample: \`+91 9876543210\``;
    }
  }

  // ── STEP 3: CHECK IF USER IS FULLY ONBOARDED ─────────────────────────────
  const { data: dbUser } = await db.supabase
    .from('users')
    .select('phone, platform_id, auth_user_id')
    .eq('platform_id', String(platformId))
    .eq('platform', platform)
    .maybeSingle();

  if (!dbUser || !dbUser.platform_id) {
    onboardingState.set(String(platformId), { step: 'awaiting_code' });
    return `👋 *Hi there!*\n\n` +
      `To use GamaClaw, first activate your account at:\n` +
      `*gamaclaw.vercel.app/activate*\n\n` +
      `Then send me your 6-digit connect code here.`;
  }

  if (!dbUser.phone) {
    onboardingState.set(String(platformId), { step: 'awaiting_phone' });
    return `📱 *Almost there!*\n\n` +
      `Please send your *phone number* to activate.\n\n` +
      `Example: \`+91 9876543210\``;
  }

  // ── STEP 4: FULLY ONBOARDED — normal processing ───────────────────────────
  const user = await db.getOrCreateUser(platformId, platform, userName);
  const p = getPending(user.id || platformId);

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

  const setModelMatch = text.match(/^\/?\s*set\s*model\s*(.*)$/i);
  if (setModelMatch) {
    text = '/setmodel ' + setModelMatch[1].trim().toLowerCase();
  }

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
      ? `\n\n🎖️ *You're one of our first 100 users!*\nYou get *FREE Pro access for 1 month* 🎉`
      : '';
    return `👋 *Welcome back, ${userName || 'there'}!*\n\nI'm your 24/7 AI personal assistant.` + earlyAdopterMsg + `\n\n` + helpMessage(user.plan);
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

  // ── CONNECT ───────────────────────────────────────────────────────────────
  if (text.startsWith('/connect')) {
    const code = text.replace('/connect', '').trim();
    if (!code || code.length !== 6) return `🔗 Usage: */connect 123456*\n\nGet code from *gamaclaw.vercel.app/activate*`;
    try {
      const result = await db.claimLinkingCode(platformId, platform, code);
      if (result.success) return `✅ *Dashboard linked!*\n\n🌐 gamaclaw.vercel.app/dashboard`;
      if (result.reason === 'expired') return `⏱ Code expired! Get a new one from the activate page.`;
      return `❌ Invalid code.`;
    } catch { return `❌ Could not link. Try again.`; }
  }

  const lowerTextCmd = text.toLowerCase().trim();

  // ── MY OPT-IN LINK ────────────────────────────────────────────────────────
  if (text === '/mylink' || lowerTextCmd === 'my link' || lowerTextCmd === 'get my link') {
    const waNumber = process.env.WHATSAPP_PHONE_ID_DISPLAY || '919XXXXXXXXX';
    const encodedMsg = encodeURIComponent(`Hi GamaClaw:${user.id}`);
    const link = `https://wa.me/${waNumber}?text=${encodedMsg}`;
    return `🔗 *Your Client Opt-in Link*\n\n${link}\n\n📲 Share this with your clients.\nWhen they click it → they message your bot → you can schedule messages to them!\n\nThey'll be saved automatically under your leads.`;
  }

  // ── SCHEDULED MESSAGES ────────────────────────────────────────────────────
  if (lowerTextCmd === '/schedules' || lowerTextCmd === 'my schedules' || lowerTextCmd === 'show schedules') {
    if (!db.PLAN_LIMITS[user.plan]?.features.includes('briefing')) {
      return `📅 Scheduled messages are a *Pro feature*!${upgradeMessage(user.plan)}`;
    }
    const msgs = await db.getScheduledMessages(user.id || platformId);
    if (!msgs.length) return `📅 *No scheduled messages.*\n\nTry:\n"Schedule message to Rahul +919876543210 every Monday at 10am: Hi, checking in!"`;
    const list = msgs.map((m, i) =>
      `${i+1}. 👤 *${m.to_name || m.to_phone}*\n   💬 "${m.message.length > 40 ? m.message.slice(0,40)+'...' : m.message}"\n   🔄 ${m.recurring}${m.day_of_week ? ' · ' + m.day_of_week : ''} at ${m.send_time}`
    ).join('\n\n');
    return `📅 *Your Scheduled Messages (${msgs.length}):*\n\n${list}\n\nSay "Cancel schedule 1" to remove one.`;
  }

  const cancelMatch = lowerTextCmd.match(/^cancel schedule\s+(\d+)$/);
  if (cancelMatch) {
    const index = parseInt(cancelMatch[1]) - 1;
    const msgs = await db.getScheduledMessages(user.id || platformId);
    if (!msgs[index]) return `❌ Schedule ${cancelMatch[1]} not found. Type */schedules* to see your list.`;
    await db.deleteScheduledMessage(user.id || platformId, msgs[index].id);
    return `✅ Cancelled scheduled message to *${msgs[index].to_name || msgs[index].to_phone}*.`;
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
      if (!pendingEmail.to) {
        p.awaitingEmailAddress = true;
        return `📧 Who should I send this email to? Please share their email address.`;
      }
      try {
        await emailSvc.sendEmail(pendingEmail.to, pendingEmail.subject, pendingEmail.body);
        await clearPendingEmail(user.id || platformId);
        return `✅ *Email sent!*\n\n📧 To: ${pendingEmail.to}\n📝 ${pendingEmail.subject}\n\n_Delivered via GamaClaw_`;
      } catch (e) { await clearPendingEmail(user.id || platformId); return `❌ Failed: ${e.message}`; }
    } else if (isCancel) {
      await clearPendingEmail(user.id || platformId);
      return 'Got it, email cancelled! 👍 What else can I help with?';
    } else if (isEdit) {
      await clearPendingEmail(user.id || platformId);
      return '✏️ Sure! Tell me what changes you want and I\'ll redraft it.';
    } else {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      if (emailRegex.test(t) && p.awaitingEmailAddress) {
        const emailMatch = t.match(emailRegex);
        pendingEmail.to = emailMatch[0];
        await savePendingEmail(user.id || platformId, pendingEmail);
        p.awaitingEmailAddress = false;
        return formatEmailPreview(pendingEmail);
      }
      if (t.length > 10 && !t.includes('@')) {
        await clearPendingEmail(user.id || platformId);
      } else {
        return `📧 *Email ready to send!*\n\n*To:* ${pendingEmail.to || 'No recipient yet'}\n*Subject:* ${pendingEmail.subject}\n\nReply *send* ✅ or *cancel* ❌`;
      }
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

  // ── MULTI-LINE EXPENSE ────────────────────────────────────────────────────
  const expenseLines = text.split('\n').filter(l => /i spent|i paid|spent ₹|paid ₹/i.test(l));
  if (expenseLines.length > 1) {
    let results = [];
    for (const line of expenseLines) {
      const exp = await ai.extractExpense(line);
      if (exp) {
        await db.logExpense(user.id || platformId, exp.amount, exp.category, exp.note);
        results.push(`✅ ₹${Number(exp.amount).toLocaleString('en-IN')} — ${exp.note}`);
      }
    }
    if (results.length) return `💰 *${results.length} Expenses Logged!*\n\n${results.join('\n')}`;
  }

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
    'GST_FILING','GST_SUMMARY','SCHEDULE_MESSAGE','CHAT'
  ];

  const lowerCheck = text.toLowerCase();

  if ((lowerCheck.includes('delete all') || lowerCheck.includes('clear all') || lowerCheck.includes('remove all')) &&
      (lowerCheck.includes('reminder') || lowerCheck.includes('reminders'))) {
    await db.supabase.from('reminders').update({ active: false }).eq('user_id', user.id || platformId);
    return '✅ All reminders cleared!';
  }

  if (lowerCheck.includes('delete reminder') || lowerCheck.includes('remove reminder') || lowerCheck.includes('cancel reminder')) {
    const reminders = await db.getReminders(user.id || platformId);
    if (!reminders.length) return 'You have no active reminders!';
    const num = text.match(/\d+/);
    if (num) {
      const idx = parseInt(num[0]) - 1;
      if (reminders[idx]) {
        await db.supabase.from('reminders').update({ active: false }).eq('id', reminders[idx].id);
        return `✅ Reminder "${reminders[idx].text}" deleted!`;
      }
    }
    return `Which reminder to delete?\n\n` + reminders.map((r,i) => `${i+1}. ${r.text} (${r.time})`).join('\n') + `\n\nSay "Delete reminder 1"`;
  }

  if ((lowerCheck.includes('generate') || lowerCheck.includes('create') || lowerCheck.includes('make')) &&
      (lowerCheck.includes('image') || lowerCheck.includes('photo') || lowerCheck.includes('picture'))) {
    return `🖼️ Image generation is coming soon!\n\nWhat else can I help you with?`;
  }

  if ((lowerCheck.includes('remove') || lowerCheck.includes('delete') || lowerCheck.includes('cancel')) &&
      (lowerCheck.includes('alert') || lowerCheck.includes('price alert'))) {
    const alerts = await db.getActivePriceAlerts(user.id || platformId);
    if (!alerts.length) return '🔔 You have no active price alerts.';
    const num = text.match(/\d+/);
    if (num) {
      const idx = parseInt(num[0]) - 1;
      if (alerts[idx]) {
        await db.supabase.from('price_alerts').update({ active: false }).eq('id', alerts[idx].id);
        return `✅ Price alert for *${alerts[idx].item}* removed.`;
      }
    }
    return `🔔 *Your Price Alerts:*\n\n` +
      alerts.map((a,i) => `${i+1}. ${a.item} — below ₹${Number(a.target_price).toLocaleString('en-IN')}`).join('\n') +
      `\n\nWhich one to remove? Say "Remove alert 1"`;
  }

  let forcedIntent = null;
  if (/^(write|draft|compose|create).*(email|mail)/i.test(lowerCheck) && !lowerCheck.includes('follow')) forcedIntent = 'SEND_EMAIL';
  if (/kya|kaisa|karo|kaise|bhai|yaar|mujhe|mera|tera/i.test(lowerCheck) && lowerCheck.length > 15) forcedIntent = 'CHAT';
  if (/schedule.*(message|msg|text|to)|send\s*(message|msg)?\s*(to\s+)?.*(every|daily|weekly|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(message|msg|text).*every.*(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm)|every\s*(day|daily|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday).*(at\s*\d)/i.test(lowerCheck)) forcedIntent = 'SCHEDULE_MESSAGE';

  let rawIntent = forcedIntent || 'CHAT';
  try { if (!forcedIntent) rawIntent = await ai.detectIntent(text); } catch {}
  const intent = VALID_INTENTS.includes(rawIntent.trim().toUpperCase()) ? rawIntent.trim().toUpperCase() : 'CHAT';
  const memoryCtx = await db.getMemoryString(user.id || platformId);
  const history = await db.getRecentMessages(user.id || platformId);

  switch (intent) {

    case 'SCHEDULE_MESSAGE': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('briefing')) return `📅 Scheduled messages are a *Pro feature*!${upgradeMessage(user.plan)}`;
      const extracted = await ai.extractScheduledMessage(text);
      if (!extracted) return `❌ Try:\n"Schedule message to Rahul +919876543210 every Monday at 10am: Hi!"`;
      const { toPhone, toName, message, recurring, dayOfWeek, sendTime } = extracted;
      if (!toPhone || !message || !sendTime) return `❌ I need a phone number, message and time.`;
      try {
        const { getNextRunTime } = require('../services/scheduledSender');
        const timezone = 'Asia/Kolkata';
        const nextRun = getNextRunTime(recurring, dayOfWeek, sendTime, timezone);
        const newMsg = await db.createScheduledMessage(user.id || platformId, platform, toPhone, toName, message, recurring, dayOfWeek, sendTime);
        await db.supabase.from('scheduled_messages').update({ next_run: nextRun, timezone }).eq('id', newMsg.id);
        return `✅ *Message Scheduled!*\n\n👤 To: ${toName || toPhone}\n💬 "${message}"\n🔄 ${recurring === 'weekly' ? `every ${dayOfWeek}` : recurring} at ${sendTime}\n\nType */schedules* to manage.`;
      } catch (e) { return `❌ Could not schedule. Try again.`; }
    }

    case 'SEND_EMAIL': {
      const draft = await ai.draftEmail(text, memoryCtx);
      if (!draft) return '❌ Try: "Send email to john@gmail.com about meeting"';
      await savePendingEmail(user.id || platformId, draft);
      if (!draft.to) { p.awaitingEmailAddress = true; return `📧 *Email Draft Ready!*\n\n*Subject:* ${draft.subject}\n\n${draft.body}\n\n❓ Who should I send this to?`; }
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
      const num = text.match(/\d+/);
      const wantsRemove = num && (lowerCheck.includes('remove') || lowerCheck.includes('delete') || lowerCheck.includes('cancel'));
      if (wantsRemove) {
        const idx = parseInt(num[0]) - 1;
        if (alerts[idx]) { await db.supabase.from('price_alerts').update({ active: false }).eq('id', alerts[idx].id); return `✅ Alert removed!`; }
      }
      return `🔔 *Your Price Alerts:*\n\n` + alerts.map((a,i) => `${i+1}. ${a.item} — below ₹${Number(a.target_price).toLocaleString('en-IN')}`).join('\n') + `\n\nSay "Remove alert 1" to delete.`;
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
      return `🎯 *Your Leads:*\n\n` + leads.slice(0,10).map((l,i) => `${i+1}. *${l.name}* (${l.status})\n   📧 ${l.email || 'no email'} | 🔗 ${l.source}`).join('\n\n');
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
      return `⏰ *Reminder Set!*\n\n📝 ${reminder.text}\n🕐 ${reminder.time}${reminder.date ? `\n📅 ${reminder.date}` : ''}${reminder.recurring !== 'once' ? `\n🔄 ${reminder.recurring}` : ''}`;
    }

    case 'VIEW_REMINDERS': {
      const reminders = await db.getReminders(user.id || platformId);
      if (!reminders.length) return '⏰ No active reminders.\n\nSay "Remind me daily at 7pm to call mom"';
      return `⏰ *Your Reminders (${reminders.length}):*\n\n` + reminders.map((r,i) => `${i+1}. *${r.text}*\n   🕐 ${r.time} · 🔄 ${r.recurring}`).join('\n\n');
    }

    case 'ADD_TASK': {
      const task = await ai.extractTask(text);
      if (!task) return '❌ Try: "Add task: Call Rahul tomorrow"';
      await db.saveTask(user.id || platformId, task.title, task.due_date, task.priority);
      return `✅ *Task Added!*\n\n📋 ${task.title}${task.due_date ? `\n📅 Due: ${task.due_date}` : ''}${task.priority ? `\n🔥 Priority: ${task.priority}` : ''}`;
    }

    case 'VIEW_TASKS': {
      const tasks = await db.getTasks(user.id || platformId);
      if (!tasks.length) return `📋 *No pending tasks!*\n\nAdd one: "Add task: Call client tomorrow"`;
      return `📋 *Your Tasks (${tasks.length}):*\n\n` + tasks.map((t,i) =>
        `${i+1}. ${t.priority === 'high' ? '🔥' : t.priority === 'medium' ? '📌' : '📋'} *${t.title}*${t.due_date ? `\n   📅 ${t.due_date}` : ''}`
      ).join('\n\n') + `\n\nSay "Done task 1" or "Delete task 2"`;
    }

    case 'COMPLETE_TASK': {
      const allTasksC = await db.getTasks(user.id || platformId);
      if (!allTasksC.length) return `You have no pending tasks! 📋`;
      const numC = text.match(/\d+/);
      if (!numC) return `Which task did you finish?\n\n` + allTasksC.map((t,i) => `${i+1}. ${t.title}`).join('\n') + `\n\nSay "Done task 1"`;
      const idxC = parseInt(numC[0]) - 1;
      if (!allTasksC[idxC]) return `Task ${numC[0]} not found.`;
      await db.completeTask(allTasksC[idxC].id);
      return `✅ *${allTasksC[idxC].title}* — done! Great work 💪🎉`;
    }

    case 'DELETE_TASK': {
      const allTasksD = await db.getTasks(user.id || platformId);
      if (!allTasksD.length) return `You have no tasks to delete!`;
      const numD = text.match(/\d+/);
      if (!numD) return `Which task?\n\n` + allTasksD.map((t,i) => `${i+1}. ${t.title}`).join('\n') + `\n\nSay "Delete task 1"`;
      const idxD = parseInt(numD[0]) - 1;
      if (!allTasksD[idxD]) return `Task ${numD[0]} not found.`;
      await db.deleteTask(allTasksD[idxD].id);
      return `🗑️ "${allTasksD[idxD].title}" deleted!`;
    }

    case 'GST_FILING': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `🧾 GST Filing is a *Pro feature*!${upgradeMessage(user.plan)}`;
      return await ai.generateGSTFiling(text, await db.getExpenseSummary(user.id || platformId, 30), memoryCtx);
    }

    case 'GST_SUMMARY': {
      if (!db.PLAN_LIMITS[user.plan]?.features.includes('expense')) return `🧾 GST Summary is a *Pro feature*!${upgradeMessage(user.plan)}`;
      return await ai.generateGSTSummary(await db.getExpenseSummary(user.id || platformId, 30));
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
      if (lowerText.includes('image') || lowerText.includes('generate image')) return `🖼️ Image generation coming soon!\n\nWhat else can I help with?`;
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