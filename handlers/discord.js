const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const { processMessage } = require('./processor');
const axios = require('axios'); 

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [Partials.Channel, Partials.Message],
 });
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Discord bot ready as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  // Ignore other bots
  if (message.author.bot) return;

  // Only respond to DMs OR messages that @mention the bot
  const isDM = message.channel.type === 1; // DM channel
  const isMentioned = message.mentions.has(client.user);
  if (!isDM && !isMentioned) return;

  const platformId = message.author.id;
  const userName = message.author.username;

  // Strip mention from message
  let text = message.content
    .replace(/<@!?\d+>/g, '')
    .trim();

  try {
    await message.channel.sendTyping();

    let response;

    // Voice/audio attachment
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      if (attachment.contentType?.includes('audio') || attachment.name?.match(/\.(ogg|mp3|wav|m4a)$/i)) {
        const audioRes = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const audioBase64 = Buffer.from(audioRes.data).toString('base64');
        response = await processMessage(platformId, 'discord', null, userName, audioBase64);
      } else {
        response = await processMessage(platformId, 'discord', text || 'What is this file?', userName);
      }
    } else {
      if (!text) return;
      response = await processMessage(platformId, 'discord', text, userName);
    }

    // Discord has 2000 char limit — split if needed
    if (response.length <= 2000) {
      await message.reply(formatForDiscord(response));
    } else {
      const chunks = splitMessage(response, 1900);
      for (const chunk of chunks) {
        await message.channel.send(formatForDiscord(chunk));
      }
    }

  } catch (err) {
    console.error('Discord error:', err);
    await message.reply('⚠️ Something went wrong. Please try again!');
  }
});

// Convert Telegram-style Markdown to Discord Markdown
function formatForDiscord(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '**$1**')   // bold stays
    .replace(/\*(.*?)\*/g, '**$1**')        // single * → bold
    .replace(/_(.*?)_/g, '_$1_')            // italic stays
    .replace(/`(.*?)`/g, '`$1`')           // code stays
    .trim();
}

function splitMessage(text, maxLen) {
  const chunks = [];
  while (text.length > maxLen) {
    let split = text.lastIndexOf('\n', maxLen);
    if (split === -1) split = maxLen;
    chunks.push(text.slice(0, split));
    text = text.slice(split).trim();
  }
  if (text) chunks.push(text);
  return chunks;
}

function startDiscord() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('⚠️  DISCORD_BOT_TOKEN not set — Discord bot skipped');
    return;
  }
  client.login(token).catch(err => console.error('Discord login failed:', err.message));
}

module.exports = { startDiscord };