const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');

// ── Razorpay instance ─────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Plan definitions ──────────────────────────────────────────────────────────
const PLANS = {
  pro_india: {
    name: 'Pro Plan',
    amount: 49900,
    currency: 'INR',
    description: '500 messages/day + all features',
    messages_per_day: 500,
  },
  business_india: {
    name: 'Business Plan',
    amount: 299900,
    currency: 'INR',
    description: 'Unlimited messages + team features',
    messages_per_day: 999999,
  },
};

// ── Create a Razorpay payment link ────────────────────────────────────────────
async function createPaymentLink(userId, planId, userEmail = '', userName = '') {
  const plan = PLANS[planId];
  if (!plan) return null;
  try {
    const paymentLink = await razorpay.paymentLink.create({
      amount: plan.amount,
      currency: plan.currency,
      accept_partial: false,
      description: `GamaClaw ${plan.name} — ${plan.description}`,
      customer: { name: userName || 'GamaClaw User', email: userEmail || '' },
      notify: { sms: false, email: !!userEmail },
      reminder_enable: false,
      notes: { user_id: userId.toString(), plan_id: planId },
      callback_url: `${process.env.RENDER_URL || 'https://gamaclaw-bot.onrender.com'}/webhook/razorpay-callback`,
      callback_method: 'get',
    });
    return paymentLink.short_url;
  } catch (err) {
    console.error('Razorpay payment link error:', err.message);
    return null;
  }
}

// ── Verify Razorpay webhook signature ─────────────────────────────────────────
function verifyWebhook(body, signature) {
  try {
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    return expectedSig === signature;
  } catch { return false; }
}

// ── WEBHOOK: Called by Razorpay when payment completes ────────────────────────
router.post('/razorpay', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhook(req.body, signature)) {
      console.error('Invalid Razorpay signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    console.log('Razorpay webhook:', event);

    if (event === 'payment_link.paid') {
      const paymentData = req.body.payload.payment_link.entity;
      const notes = paymentData.notes || {};
      const userId = notes.user_id;
      const planId = notes.plan_id;

      if (!userId || !planId) return res.status(200).json({ ok: true });

      const newPlan = planId.includes('business') ? 'business' : 'pro';
      const messagesPerDay = planId.includes('business') ? 999999 : 500;

      // Upgrade user in Supabase
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      await supabase.from('users').update({
        plan: newPlan,
        messages_per_day: messagesPerDay,
        plan_started_at: new Date().toISOString(),
        razorpay_payment_id: paymentData.id,
      }).eq('id', userId);

      console.log(`✅ User ${userId} upgraded to ${newPlan}`);

      // Notify user on Telegram
      try {
        const { supabase: db } = require('../services/db');
        const { data: user } = await db.from('users').select('telegram_id').eq('id', userId).single();
        if (user && user.telegram_id) {
          const TelegramBot = require('node-telegram-bot-api');
          const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
          await bot.sendMessage(user.telegram_id,
            `🎉 *Payment Successful! Welcome to ${newPlan.toUpperCase()}!*\n\n` +
            `✅ Account upgraded\n` +
            `📊 Messages/day: ${messagesPerDay === 999999 ? 'Unlimited' : messagesPerDay}\n` +
            `🚀 All features unlocked!\n\nType anything to start!`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (e) { console.error('Telegram notify error:', e.message); }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ ok: true });
  }
});

// ── CALLBACK: User lands here after payment ────────────────────────────────────
router.get('/razorpay-callback', (req, res) => {
  const paid = req.query.razorpay_payment_link_status === 'paid';
  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#050508;color:#e8e8f0">
    ${paid
      ? `<h1 style="color:#00e5a0">🎉 Payment Successful!</h1>
         <p style="color:#888;margin-bottom:32px">Your account has been upgraded. Go back to Telegram!</p>
         <a href="https://t.me/GamaClawBot" style="background:#00e5a0;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold">Open GamaClaw →</a>`
      : `<h1 style="color:#ff4d6d">Payment Incomplete</h1>
         <p style="color:#888;margin-bottom:32px">Please try again from the bot.</p>
         <a href="https://t.me/GamaClawBot" style="background:#00e5a0;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold">Back to Bot →</a>`
    }
  </body></html>`);
});

module.exports = router;
module.exports.createPaymentLink = createPaymentLink;
module.exports.PLANS = PLANS;