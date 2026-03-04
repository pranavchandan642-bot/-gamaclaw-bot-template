const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/db');

// ── RAZORPAY WEBHOOK ──────────────────────────────────────────────────────────
router.post('/razorpay', express.json(), async (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    const payment = req.body.payload?.payment?.entity;

    if (event === 'payment.captured' && payment) {
      const notes = payment.notes || {};
      const platformId = notes.platform_id;
      const platform = notes.platform || 'telegram';
      const plan = notes.plan || 'pro';

      if (platformId) {
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        await db.updateUser(platformId, platform, {
          plan,
          plan_expiry: expiry.toISOString(),
          razorpay_payment_id: payment.id,
        });

        console.log(`✅ Upgraded ${platformId} to ${plan} via Razorpay`);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Razorpay webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── STRIPE WEBHOOK ────────────────────────────────────────────────────────────
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const platformId = session.metadata?.platform_id;
      const platform = session.metadata?.platform || 'telegram';
      const plan = session.metadata?.plan || 'pro';

      if (platformId) {
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 1);

        await db.updateUser(platformId, platform, {
          plan,
          plan_expiry: expiry.toISOString(),
          stripe_customer_id: session.customer,
        });

        console.log(`✅ Upgraded ${platformId} to ${plan} via Stripe`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;