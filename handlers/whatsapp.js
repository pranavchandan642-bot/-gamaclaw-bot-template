const express = require('express');
const router = express.Router();
const { processMessage } = require('./processor');

// Twilio sends form-encoded POST requests
router.use(express.urlencoded({ extended: false }));

router.post('/', async (req, res) => {
  const from = req.body.From || ''; // e.g. "whatsapp:+919876543210"
  const body = req.body.Body || '';
  const profileName = req.body.ProfileName || '';
  const platformId = from.replace('whatsapp:', '');
  const numMedia = parseInt(req.body.NumMedia || '0');

  try {
    let response;

    // Voice/audio message
    if (numMedia > 0 && req.body.MediaContentType0?.includes('audio')) {
      const mediaUrl = req.body.MediaUrl0;
      const authHeader = 'Basic ' + Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');

      const fetch = require('node-fetch');
      const audioRes = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
      const audioBuffer = await audioRes.buffer();
      const audioBase64 = audioBuffer.toString('base64');

      response = await processMessage(platformId, 'whatsapp', null, profileName, audioBase64);
    } else {
      response = await processMessage(platformId, 'whatsapp', body, profileName);
    }

    // Twilio expects TwiML XML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>
    <Body>${escapeXml(response)}</Body>
  </Message>
</Response>`;

    res.set('Content-Type', 'text/xml');
    res.send(twiml);

  } catch (err) {
    console.error('WhatsApp error:', err);
    const errTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message><Body>⚠️ Something went wrong. Please try again!</Body></Message>
</Response>`;
    res.set('Content-Type', 'text/xml');
    res.send(errTwiml);
  }
});

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\*/g, '') // Remove markdown bold for WhatsApp plain text
    .replace(/_/g, '');
}

module.exports = router;