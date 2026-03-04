const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const db = require('../services/db');
const ai = require('../services/ai');
const calendarSvc = require('../services/calendar');

// Runs at 8:00 AM IST (2:30 AM UTC)
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

        // Throttle to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`Failed briefing for ${user.platform_id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Scheduler error:', err);
  }
}, { timezone: 'Asia/Kolkata' });

console.log('⏰ Morning briefing scheduler started');