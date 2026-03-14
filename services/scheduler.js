const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const db = require('../services/db');
const ai = require('../services/ai');
const calendarSvc = require('../services/calendar');

// ── MORNING BRIEFING (8:00 AM IST) ───────────────────────────────────────────
cron.schedule('30 2 * * *', async () => {
  console.log('⏰ Running morning briefing scheduler...');

  try {
    const { data: proUsers } = await db.supabase
      .from('users')
      .select('*')
      .in('plan', ['pro', 'business'])
      .eq('platform', 'telegram');

    if (!proUsers?.length) return;

    const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

    for (const user of proUsers) {
      try {
        let events = [];
        try { events = await calendarSvc.getUpcomingEvents(1); } catch {}

        const expenses = await db.getExpenseSummary(user.id, 1);
        const memCtx = await db.getMemoryString(user.id);
        const briefing = await ai.generateBriefing(user.name, events, expenses, memCtx);

        await bot.sendMessage(user.platform_id, briefing, { parse_mode: 'Markdown' });
        console.log(`✅ Sent briefing to ${user.platform_id}`);

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`Failed briefing for ${user.platform_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err);
  }
}, { timezone: 'Asia/Kolkata' });

// ── REMINDER SCHEDULER (every minute) ────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const { data: reminders, error } = await db.supabase
      .from('reminders')
      .select('*, users(id, platform_id, platform, name, phone)')
      .eq('active', true);

    if (error || !reminders?.length) return;

    for (const reminder of reminders) {
      if (!reminder.users) continue;

      // ── Get current time in user's timezone ──────────────────────────────
      const userTz    = db.getTimezoneFromPhone(reminder.users?.phone);
      const now       = new Date(new Date().getTime() + (userTz * 60 * 60 * 1000));
      const HH        = now.getHours().toString().padStart(2, '0');
      const MM        = now.getMinutes().toString().padStart(2, '0');
      const currentTime = `${HH}:${MM}`;
      const today     = now.toISOString().split('T')[0];
      const dayNames  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      const todayName = dayNames[now.getDay()];

      // ── Check time matches ────────────────────────────────────────────────
      const reminderTime = (reminder.time || '').substring(0, 5);
      if (reminderTime !== currentTime) continue;

      // ── Check date/recurrence ─────────────────────────────────────────────
      let shouldFire = false;
      switch (reminder.recurring) {
        case 'once':
          shouldFire = !reminder.date || reminder.date === today;
          break;
        case 'daily':
          shouldFire = true;
          break;
        case 'weekly':
          shouldFire = !reminder.day_of_week || todayName === reminder.day_of_week.toLowerCase();
          break;
        case 'monthly':
          shouldFire = reminder.date
            ? now.getDate() === new Date(reminder.date).getDate()
            : true;
          break;
        default:
          shouldFire = true;
      }

      if (!shouldFire) continue;

      // ── Fire the reminder ─────────────────────────────────────────────────
      await sendReminder(reminder.users, reminder.text);

      // Deactivate one-time reminders after firing
      if (reminder.recurring === 'once') {
        await db.supabase.from('reminders').update({ active: false }).eq('id', reminder.id);
      }
    }
  } catch (err) {
    console.error('Reminder scheduler error:', err.message);
  }
});

// ── SCHEDULED LEAD FOLLOW-UP SCHEDULER (every minute) ───────────────────────
  cron.schedule('* * * * *', async () => {
  try {
    console.log('🔍 Checking scheduled follow-up messages...');

    const dueMessages = await db.getDueScheduledMessages();

    console.log('📦 dueMessages:', JSON.stringify(dueMessages, null, 2));

    if (!dueMessages?.length) {
      console.log('ℹ️ No due scheduled messages found');
      return;
    }


    for (const item of dueMessages) {
      try {
        const lead = item.leads;
        const user = item.users;

        if (!lead) {
          console.log(`Skipping ${item.id}: lead not found`);
          continue;
        }

        if (!lead.phone) {
          console.log(`Skipping ${item.id}: lead has no phone`);
          continue;
        }

        if (!lead.whatsapp_opted_in) {
          console.log(`Skipping ${item.id}: lead has not opted in`);
          continue;
        }

        if (!lead.active) {
          console.log(`Skipping ${item.id}: lead inactive`);
          continue;
        }

        if (!user) {
          console.log(`Skipping ${item.id}: user not found`);
          continue;
        }

        if (user.plan !== 'business') {
          console.log(`Skipping ${item.id}: user is not on business plan`);
          continue;
        }

        await sendWhatsAppMessage(lead.phone, item.message);

        await db.markScheduledMessageSent(
          item.id,
          item.recurring,
          item.time,
          item.date,
          item.day_of_week,
          db.getTimezoneFromPhone(user.phone)
        );

        console.log(`✅ Scheduled follow-up sent to ${lead.name} (${lead.phone})`);
      } catch (err) {
        console.error(`❌ Scheduled follow-up error for ${item.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Scheduled follow-up scheduler error:', err.message);
  }
});

// ── SCHEDULED LEAD FOLLOW-UP SCHEDULER (every minute) ───────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const dueMessages = await db.getDueScheduledMessages();

    if (!dueMessages?.length) return;

    for (const item of dueMessages) {
      try {
        const lead = item.leads;
        const user = item.users;

        if (!lead) {
          console.log(`Skipping ${item.id}: lead not found`);
          continue;
        }

        if (!lead.phone) {
          console.log(`Skipping ${item.id}: lead has no phone`);
          continue;
        }

        if (!lead.whatsapp_opted_in) {
          console.log(`Skipping ${item.id}: lead has not opted in`);
          continue;
        }

        if (!lead.active) {
          console.log(`Skipping ${item.id}: lead is inactive`);
          continue;
        }

        if (!user) {
          console.log(`Skipping ${item.id}: user not found`);
          continue;
        }

        if (user.plan !== 'business') {
          console.log(`Skipping ${item.id}: user is not on business plan`);
          continue;
        }

        await sendWhatsAppMessage(lead.phone, item.message);

        await db.markScheduledMessageSent(
          item.id,
          item.recurring,
          item.time,
          item.date,
          item.day_of_week,
          db.getTimezoneFromPhone(user.phone)
        );

        console.log(`✅ Scheduled follow-up sent to ${lead.name} (${lead.phone})`);
      } catch (err) {
        console.error(`❌ Scheduled message error for ${item.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Scheduled lead follow-up scheduler error:', err.message);
  }
});

// ── SEND WHATSAPP MESSAGE ─────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  try {
    const fetch = require('node-fetch');

    await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    console.log(`✅ WhatsApp message sent to ${to}`);
  } catch (err) {
    console.error(`❌ WhatsApp send failed to ${to}:`, err.message);
    throw err;
  }
}

// ── SEND WHATSAPP MESSAGE ─────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  try {
    const fetch = require('node-fetch');

    await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    console.log(`✅ WhatsApp message sent to ${to}`);
  } catch (err) {
    console.error(`❌ WhatsApp send failed to ${to}:`, err.message);
    throw err;
  }
}

// ── SEND REMINDER ─────────────────────────────────────────────────────────────
async function sendReminder(user, text) {
  try {
    const platform   = user.platform;
    const platformId = user.platform_id;
    const message    = `⏰ *Reminder!*\n\n📝 ${text}`;

    if (platform === 'telegram') {
      const bot = require('./telegram');
      await bot.sendMessage(platformId, message, { parse_mode: 'Markdown' });

    } else if (platform === 'whatsapp') {
      const fetch = require('node-fetch');
      await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: platformId,
          type: 'text',
          text: { body: `⏰ Reminder!\n\n📝 ${text}` },
        }),
      });

    } else if (platform === 'discord') {
      const { getDiscordClient } = require('./discord');
      const client = getDiscordClient();
      if (client) {
        const channel = await client.channels.fetch(platformId).catch(() => null);
        if (channel) await channel.send(`⏰ **Reminder!**\n\n📝 ${text}`);
      }
    }

    console.log(`✅ Reminder fired → ${platform}:${platformId} — "${text}"`);
  } catch (err) {
    console.error(`❌ Reminder send failed:`, err.message);
  }
}

console.log('⏰ Morning briefing + reminder + scheduled follow-up scheduler started');
