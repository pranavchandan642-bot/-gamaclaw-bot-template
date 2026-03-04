const { google } = require('googleapis');

function getCalendar() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

async function getUpcomingEvents(days = 7) {
  const calendar = getCalendar();
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 15,
  });

  return res.data.items || [];
}

async function addEvent(title, date, time, durationMins = 60, description = '') {
  const calendar = getCalendar();
  const startTime = new Date(`${date}T${time || '09:00'}:00+05:30`);
  const endTime = new Date(startTime.getTime() + durationMins * 60000);

  const result = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Kolkata' },
    },
  });

  return result.data;
}

function formatEvents(events) {
  if (!events.length) return '📅 No upcoming events.';
  let reply = '📅 *Upcoming Events:*\n\n';
  events.forEach((e, i) => {
    const start = e.start.dateTime || e.start.date;
    const date = new Date(start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    reply += `*${i + 1}. ${e.summary}*\n📍 ${date}\n`;
    if (e.description) reply += `📝 ${e.description.substring(0, 60)}...\n`;
    reply += '\n';
  });
  return reply;
}

module.exports = { getUpcomingEvents, addEvent, formatEvents };