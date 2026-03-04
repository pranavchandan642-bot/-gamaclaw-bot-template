const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── USER MANAGEMENT ───────────────────────────────────────────────────────────

async function getOrCreateUser(platformId, platform, name = '') {
  try {
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('platform_id', platformId)
      .eq('platform', platform)
      .single();

    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          platform_id: platformId,
          platform,
          name,
          plan: 'free',
          messages_today: 0,
          messages_reset_date: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error('User insert error:', insertError.message);
        // Return a fallback user object so bot doesn't crash
        return {
          id: platformId,
          platform_id: platformId,
          platform,
          name,
          plan: 'free',
          messages_today: 0,
        };
      }
      user = newUser;
    }
    return user;
  } catch (err) {
    console.error('getOrCreateUser error:', err.message);
    // Fallback user so bot never crashes
    return {
      id: platformId,
      platform_id: platformId,
      platform,
      name,
      plan: 'free',
      messages_today: 0,
    };
  }
}

async function updateUser(platformId, platform, updates) {
  await supabase
    .from('users')
    .update(updates)
    .eq('platform_id', platformId)
    .eq('platform', platform);
}

// ── PLAN LIMITS ───────────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  free:       { daily: 30,   features: ['chat', 'email', 'summarize'] },
  pro:        { daily: 500,  features: ['chat', 'email', 'summarize', 'calendar', 'voice', 'expense', 'briefing', 'price_alert', 'memory'] },
  business:   { daily: 9999, features: ['chat', 'email', 'summarize', 'calendar', 'voice', 'expense', 'briefing', 'price_alert', 'memory', 'lead_followup', 'team'] },
};

async function checkLimit(user) {
  const today = new Date().toISOString().split('T')[0];
  let count = user.messages_today || 0;

  // Reset daily count if new day
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

// ── MEMORY ────────────────────────────────────────────────────────────────────

async function saveMemory(userId, key, value) {
  const { data: existing } = await supabase
    .from('memories')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .single();

  if (existing) {
    await supabase.from('memories').update({ value }).eq('id', existing.id);
  } else {
    await supabase.from('memories').insert({ user_id: userId, key, value });
  }
}

async function getMemories(userId) {
  const { data } = await supabase
    .from('memories')
    .select('key, value')
    .eq('user_id', userId);
  return data || [];
}

async function getMemoryString(userId) {
  const memories = await getMemories(userId);
  if (!memories.length) return '';
  return '\nUser memory:\n' + memories.map(m => `- ${m.key}: ${m.value}`).join('\n');
}

async function getMemory(userId, key) {
  const { data } = await supabase
    .from('memories')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .single();
  return data?.value || null;
}

async function deleteMemory(userId, key) {
  await supabase.from('memories').delete()
    .eq('user_id', userId)
    .eq('key', key);
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────

async function logExpense(userId, amount, category, note) {
  await supabase.from('expenses').insert({
    user_id: userId,
    amount,
    category,
    note,
    date: new Date().toISOString(),
  });
}

async function getExpenseSummary(userId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase
    .from('expenses')
    .select('amount, category, note, date')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false });
  return data || [];
}

// ── PRICE ALERTS ──────────────────────────────────────────────────────────────

async function addPriceAlert(userId, item, targetPrice, url) {
  await supabase.from('price_alerts').insert({
    user_id: userId,
    item,
    target_price: targetPrice,
    url,
    active: true,
    created_at: new Date().toISOString(),
  });
}

async function getActivePriceAlerts(userId) {
  const { data } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);
  return data || [];
}

// ── CONVERSATION HISTORY ──────────────────────────────────────────────────────

async function saveMessage(userId, role, content) {
  await supabase.from('messages').insert({
    user_id: userId,
    role,
    content: content.substring(0, 2000),
    created_at: new Date().toISOString(),
  });
}

async function getRecentMessages(userId, limit = 10) {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

// ── LEADS ─────────────────────────────────────────────────────────────────────

async function saveLead(userId, name, email, source, notes) {
  await supabase.from('leads').insert({
    user_id: userId,
    name,
    email,
    source,
    notes,
    status: 'new',
    created_at: new Date().toISOString(),
  });
}

async function getLeads(userId, status = null) {
  let query = supabase.from('leads').select('*').eq('user_id', userId);
  if (status) query = query.eq('status', status);
  const { data } = await query.order('created_at', { ascending: false });
  return data || [];
}

module.exports = {
  supabase,
  getOrCreateUser,
  updateUser,
  checkLimit,
  incrementMessageCount,
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
  PLAN_LIMITS,
};