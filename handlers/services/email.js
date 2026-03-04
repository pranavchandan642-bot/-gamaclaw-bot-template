const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail(to, subject, body) {
  await transporter.sendMail({
    from: `GamaClaw Assistant <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: body,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <p>${body.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #eee;margin-top:30px">
      <p style="color:#999;font-size:12px">Sent via GamaClaw 🦀 — Your 24/7 AI Assistant</p>
    </div>`,
  });
}

module.exports = { sendEmail };