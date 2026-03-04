const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendEmail(to, subject, body) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER or EMAIL_PASS not set in environment variables');
  }
  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `GamaClaw Assistant <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: body,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <p style="font-size:16px;line-height:1.6;color:#333">${body.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #eee;margin-top:30px">
      <p style="color:#999;font-size:12px">Sent via <b>GamaClaw 🦀</b> — Your 24/7 AI Assistant</p>
    </div>`,
  });
  return info.messageId;
}

module.exports = { sendEmail };