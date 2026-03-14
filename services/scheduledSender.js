// services/scheduledSender.js
const { getDueScheduledMessages, updateNextRun } = require('./db');
const axios = require('axios');

function getNextRunTime(recurring, dayOfWeek, sendTime, timezone) {
  const [hours, minutes] = sendTime.split(':').map(Number);
  const now = new Date();

  // Get current time in user's timezone
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const next = new Date(userNow);
  next.setHours(hours, minutes, 0, 0);

  if (recurring === 'once') {
    if (next <= userNow) next.setDate(next.getDate() + 1);
  } else if (recurring === 'daily') {
    if (next <= userNow) next.setDate(next.getDate() + 1);
  } else if (recurring === 'weekly') {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const targetDay = days.indexOf(dayOfWeek?.toLowerCase() || 'monday');
    const currentDay = userNow.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;
    if (daysUntil === 0 && next <= userNow) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
  } else if (recurring === 'monthly') {
    if (next <= userNow) next.setMonth(next.getMonth() + 1);
  }

  // Convert back to UTC for storage
  const utcOffset = userNow.getTime() - now.getTime();
  return new Date(next.getTime() - utcOffset).toISOString();
}

async function sendWhatsAppMessage(toPhone, message) {
  const phone = toPhone.replace(/\D/g, ''); // strip non-digits
  await axios.post(
    
    `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

async function sendTelegramMessage(toChatId, message) {
  await axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
    { chat_id: toChatId, text: message }
  );
}

async function runScheduledMessages() {
  const due = await getDueScheduledMessages();
  for (const msg of due) {
    try {
      if (msg.platform === 'whatsapp') {
        await sendWhatsAppMessage(msg.to_phone, msg.message);
      } else if (msg.platform === 'telegram') {
        await sendTelegramMessage(msg.to_phone, msg.message);
      }
      console.log(`✅ Scheduled message sent to ${msg.to_name || msg.to_phone}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${msg.to_phone}:`, err.message);
    }

    // Update next run or deactivate if 'once'
    if (msg.recurring === 'once') {
      await updateNextRun(msg.id, null);
      // mark inactive
      const { supabase } = require('./db');
      await supabase.from('scheduled_messages').update({ active: false }).eq('id', msg.id);
    } else {
      const timezone = msg.timezone || 'Asia/Kolkata';
      const nextRun = getNextRunTime(msg.recurring, msg.day_of_week, msg.send_time, timezone);
      await updateNextRun(msg.id, nextRun);
    }
  }
}

module.exports = { runScheduledMessages, getNextRunTime };