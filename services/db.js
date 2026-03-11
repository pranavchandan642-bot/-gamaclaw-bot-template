const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── PLAN LIMITS ───────────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  free:     { daily: 30,   features: ['chat', 'email', 'summarize'] },
  pro:      { daily: 500,  features: ['chat', 'email', 'summarize', 'calendar', 'voice', 'expense', 'briefing', 'price_alert', 'memory'] },
  business: { daily: 9999, features: ['chat', 'email', 'summarize', 'calendar', 'voice', 'expense', 'briefing', 'price_alert', 'memory', 'lead_followup', 'team'] },
};

const EARLY_ADOPTER_LIMIT = 100;

// ── EARLY ADOPTER CHECK ───────────────────────────────────────────────────────
async function isEarlyAdopterSlotAvailable() {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('is_early_adopter', true);
  return (count || 0) < EARLY_ADOPTER_LIMIT;
}

function getEarlyAdopterExpiry() {
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 1);
  return expiry.toISOString();
}

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────

async function getOrCreateUser(platformId, platform, name = '') {
  try {
    const phone = platform === 'whatsapp' ? platformId : null;

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('platform_id', platformId)
      .eq('platform', platform)
      .single();

    if (!user && phone) {
      const { data: linkedUser } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .neq('platform', platform)
        .single();

      if (linkedUser) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({
            platform_id: platformId,
            platform,
            name: name || linkedUser.name,
            phone,
            user_key: linkedUser.user_key || phone,
            plan: linkedUser.plan,
            messages_today: 0,
            messages_reset_date: new Date().toISOString().split('T')[0],
            is_early_adopter: linkedUser.is_early_adopter,
            early_adopter_expiry: linkedUser.early_adopter_expiry,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        return newUser || fallbackUser(platformId, platform, name);
      }
    }

    if (!user) {
      const slotAvailable = await isEarlyAdopterSlotAvailable();
      const isEarlyAdopter = slotAvailable;
      const plan = isEarlyAdopter ? 'pro' : 'free';
      const expiry = isEarlyAdopter ? getEarlyAdopterExpiry() : null;

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          platform_id: platformId,
          platform,
          name,
          phone,
          user_key: phone || platformId,
          plan,
          messages_today: 0,
          messages_reset_date: new Date().toISOString().split('T')[0],
          is_early_adopter: isEarlyAdopter,
          early_adopter_expiry: expiry,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error('User insert error:', insertError.message);
        return fallbackUser(platformId, platform, name, plan);
      }
      user = newUser;

      if (isEarlyAdopter) {
        console.log(`🎉 Early adopter #${(await getEarlyAdopterCount())} — ${platform}:${platformId}`);
      }
    }

    if (user.is_early_adopter && user.early_adopter_expiry) {
      const expired = new Date(user.early_adopter_expiry) < new Date();
      if (expired && user.plan === 'pro') {
        await supabase.from('users').update({ plan: 'free', is_early_adopter: false })
          .eq('id', user.id);
        user.plan = 'free';
      }
    }

    return user;
  } catch (err) {
    console.error('getOrCreateUser error:', err.message);
    return fallbackUser(platformId, platform, name);
  }
}

function fallbackUser(platformId, platform, name, plan = 'free') {
  return { id: platformId, platform_id: platformId, platform, name, plan, messages_today: 0 };
}

async function getEarlyAdopterCount() {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('is_early_adopter', true);
  return count || 0;
}

async function linkPhone(userId, phone) {
  const { data: existing } = await supabase
    .from('users')
    .select('id, platform, plan')
    .eq('phone', phone)
    .neq('id', userId)
    .single();

  if (existing) {
    const betterPlan = existing.plan === 'business' || existing.plan === 'pro' ? existing.plan : null;
    if (betterPlan) {
      await supabase.from('users').update({ plan: betterPlan, phone, user_key: phone }).eq('id', userId);
      return { linked: true, plan: betterPlan };
    }
  }

  await supabase.from('users').update({ phone, user_key: phone }).eq('id', userId);
  return { linked: !!existing, plan: null };
}

async function updateUser(platformId, platform, updates) {
  await supabase
    .from('users')
    .update(updates)
    .eq('platform_id', platformId)
    .eq('platform', platform);
}

async function upgradeAllLinkedAccounts(userId, phone, plan, messagesPerDay, paymentId) {
  const updates = {
    plan,
    messages_per_day: messagesPerDay,
    plan_started_at: new Date().toISOString(),
    razorpay_payment_id: paymentId,
  };

  await supabase.from('users').update(updates).eq('id', userId);

  if (phone) {
    await supabase.from('users').update({ plan, messages_per_day: messagesPerDay })
      .eq('phone', phone)
      .neq('id', userId);
  }
}

// ── PLAN LIMITS ───────────────────────────────────────────────────────────────

async function checkLimit(user) {
  const today = new Date().toISOString().split('T')[0];
  let count = user.messages_today || 0;

  if (user.messages_reset_date !== today) {
    count = 0;
    await updateUser(user.platform_id, user.platform, {
      messages_today: 0,
      messages_reset_date: today,
    });
  }

  const limit = PLAN_LIMITS[user.plan]?.daily || 30;
  return { allowed: count < limit, count, limit, plan: user.plan };
}

async function incrementMessageCount(user) {
  await updateUser(user.platform_id, user.platform, {
    messages_today: (user.messages_today || 0) + 1,
  });
}

function canAccessPlatform(platform, plan) {
  if (platform === 'telegram') return true;
  if (platform === 'whatsapp' || platform === 'discord') {
    return plan === 'pro' || plan === 'business';
  }
  return true;
}

// ── MEMORY ────────────────────────────────────────────────────────────────────

async function saveMemory(userId, key, value) {
  const { data: existing } = await supabase
    .from('memories').select('id').eq('user_id', userId).eq('key', key).single();
  if (existing) {
    await supabase.from('memories').update({ value }).eq('id', existing.id);
  } else {
    await supabase.from('memories').insert({ user_id: userId, key, value });
  }
}

async function getMemories(userId) {
  const { data } = await supabase.from('memories').select('key, value').eq('user_id', userId);
  return data || [];
}

async function getMemoryString(userId) {
  const memories = await getMemories(userId);
  if (!memories.length) return '';
  return '\nUser memory:\n' + memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
}

async function getMemory(userId, key) {
  const { data } = await supabase.from('memories').select('value').eq('user_id', userId).eq('key', key).single();
  return data?.value || null;
}

async function deleteMemory(userId, key) {
  await supabase.from('memories').delete().eq('user_id', userId).eq('key', key);
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────

async function logExpense(userId, amount, category, note) {
  await supabase.from('expenses').insert({
    user_id: userId, amount, category, note, date: new Date().toISOString(),
  });
}

async function getExpenseSummary(userId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase.from('expenses').select('amount, category, note, date')
    .eq('user_id', userId).gte('date', since).order('date', { ascending: false });
  return data || [];
}

// ── PRICE ALERTS ──────────────────────────────────────────────────────────────

async function addPriceAlert(userId, item, targetPrice, url) {
  await supabase.from('price_alerts').insert({
    user_id: userId, item, target_price: targetPrice, url, active: true,
    created_at: new Date().toISOString(),
  });
}

async function getActivePriceAlerts(userId) {
  const { data } = await supabase.from('price_alerts').select('*').eq('user_id', userId).eq('active', true);
  return data || [];
}

// ── CONVERSATION HISTORY ──────────────────────────────────────────────────────

async function saveMessage(userId, role, content) {
  await supabase.from('messages').insert({
    user_id: userId, role, content: content.substring(0, 2000), created_at: new Date().toISOString(),
  });
}

async function getRecentMessages(userId, limit = 10) {
  const { data } = await supabase.from('messages').select('role, content')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  return (data || []).reverse();
}

// ── LEADS ─────────────────────────────────────────────────────────────────────

async function saveLead(userId, name, email, source, notes) {
  await supabase.from('leads').insert({
    user_id: userId, name, email, source, notes, status: 'new',
    created_at: new Date().toISOString(),
  });
}

async function getLeads(userId, status = null) {
  let query = supabase.from('leads').select('*').eq('user_id', userId);
  if (status) query = query.eq('status', status);
  const { data } = await query.order('created_at', { ascending: false });
  return data || [];
}

// ── REMINDERS ─────────────────────────────────────────────────────────────────

async function saveReminder(userId, reminder) {
  const { error } = await supabase.from('reminders').insert({
    user_id: userId, text: reminder.text, time: reminder.time,
    date: reminder.date || null, recurring: reminder.recurring || 'once',
    day_of_week: reminder.day_of_week || null, active: true,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function getReminders(userId) {
  const { data } = await supabase.from('reminders').select('*')
    .eq('user_id', userId).eq('active', true).order('time');
  return data || [];
}

// ── ACCOUNT LINKING ───────────────────────────────────────────────────────────

async function generateLinkingCode(authUserId, authEmail) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single();

  if (existing) {
    await supabase.from('users').update({ linking_code: code, linking_code_expiry: expiry })
      .eq('auth_user_id', authUserId);
  } else {
    await supabase.from('users').update({ linking_code: code, linking_code_expiry: expiry })
      .eq('email', authEmail);

    const { data: emailUser } = await supabase.from('users').select('id').eq('email', authEmail).single();
    if (!emailUser) {
      await supabase.from('users').insert({
        platform_id: authUserId,
        platform: 'web',
        email: authEmail,
        auth_user_id: authUserId,
        linking_code: code,
        linking_code_expiry: expiry,
        plan: 'free',
        messages_today: 0,
        messages_reset_date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      });
    }
  }

  return code;
}

async function claimLinkingCode(platformId, platform, code) {
  try {
    const { data, error } = await supabase
      .from('linking_codes')
      .select('*')
      .eq('code', code)
      .eq('used', false)
      .single();

    if (error || !data) return { success: false, reason: 'invalid' };

    if (new Date(data.expires_at) < new Date()) {
      return { success: false, reason: 'expired' };
    }

    const { data: botUser } = await supabase
      .from('users')
      .select('*')
      .eq('platform_id', platformId)
      .eq('platform', platform)
      .single();

    if (!botUser) return { success: false, reason: 'invalid' };

    await supabase
      .from('users')
      .update({ auth_user_id: data.auth_user_id, email: data.auth_email })
      .eq('id', botUser.id);

    await supabase
      .from('linking_codes')
      .update({ used: true })
      .eq('id', data.id);

    return { success: true };
  } catch (e) {
    console.error('claimLinkingCode error:', e);
    return { success: false, reason: 'error' };
  }
}

async function getBotUserByAuthId(authUserId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .neq('platform', 'web')
    .single();
  return data;
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
module.exports = {
  supabase,
  getOrCreateUser,
  updateUser,
  linkPhone,
  upgradeAllLinkedAccounts,
  checkLimit,
  incrementMessageCount,
  canAccessPlatform,
  isEarlyAdopterSlotAvailable,
  getEarlyAdopterCount,
  generateLinkingCode,
  claimLinkingCode,
  getBotUserByAuthId,
  saveMemory,
  getMemory,
  deleteMemory,
  getMemories,
  getMemoryString,
  logExpense,
  getExpenseSummary,
  addPriceAlert,
  getActivePriceAlerts,
  saveMessage,
  getRecentMessages,
  saveLead,
  getLeads,
  saveReminder,
  getReminders,
  PLAN_LIMITS,
};