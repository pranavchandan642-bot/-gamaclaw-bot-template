const https = require('https');

async function sendEmail(to, subject, body) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.EMAIL_USER || 'pranavchandan642@gmail.com';

  if (!apiKey) throw new Error('BREVO_API_KEY not set in environment');

  const data = JSON.stringify({
    sender: { name: 'GamaClaw Assistant', email: fromEmail },
    to: [{ email: to }],
    subject,
    textContent: body,
    htmlContent: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <p style="font-size:16px;line-height:1.6;color:#333">${body.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #eee;margin-top:30px">
      <p style="color:#999;font-size:12px">Sent via <b>GamaClaw 🦀</b> — Your 24/7 AI Assistant</p>
    </div>`
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve('sent');
        } else {
          reject(new Error(`Brevo error ${res.statusCode}: ${resBody}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { sendEmail };