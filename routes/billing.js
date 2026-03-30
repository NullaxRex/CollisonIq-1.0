// /routes/billing.js
// Webhook + portal + cancelled + reactivate routes.
//
// Mount in server.js:
//   app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), require('./routes/billing').webhook);
//   app.use('/', require('./routes/billing').router);
//
// CRITICAL: The webhook route must be registered BEFORE any global express.json() middleware.

'use strict';

const express = require('express');
const stripe = require('../utils/stripe');
const db = require('../db');

const router = express.Router();

// ── Webhook ───────────────────────────────────────────────────────────────
async function webhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        db.prepare(`
          UPDATE shops SET
            subscription_status = 'active',
            stripe_subscription_id = ?,
            subscription_current_period_end = ?,
            grace_period_end = NULL
          WHERE stripe_customer_id = ?
        `).run(sub.id, sub.current_period_end, session.customer);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        db.prepare(`
          UPDATE shops SET
            subscription_status = 'active',
            subscription_current_period_end = ?,
            grace_period_end = NULL
          WHERE stripe_customer_id = ?
        `).run(sub.current_period_end, invoice.customer);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const graceEnd = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
        db.prepare(`
          UPDATE shops SET
            subscription_status = 'past_due',
            grace_period_end = ?
          WHERE stripe_customer_id = ?
        `).run(graceEnd, invoice.customer);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const statusMap = {
          active:   'active',
          past_due: 'past_due',
          canceled: 'grace',
          unpaid:   'past_due',
        };
        const mappedStatus = statusMap[sub.status] || 'inactive';
        db.prepare(`
          UPDATE shops SET
            subscription_status = ?,
            subscription_current_period_end = ?
          WHERE stripe_subscription_id = ?
        `).run(mappedStatus, sub.current_period_end, sub.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const graceEnd = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
        db.prepare(`
          UPDATE shops SET
            subscription_status = 'grace',
            grace_period_end = ?
          WHERE stripe_subscription_id = ?
        `).run(graceEnd, sub.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${event.type}:`, err.message);
  }

  res.json({ received: true });
}

// ── GET /billing/portal ───────────────────────────────────────────────────
router.get('/billing/portal', requireShopAdmin, async (req, res) => {
  const shop = req.session.shop;
  if (!shop || !shop.stripe_customer_id) return res.redirect('/');
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   shop.stripe_customer_id,
      return_url: `${process.env.APP_BASE_URL}/`,
    });
    res.redirect(portalSession.url);
  } catch (err) {
    console.error('[billing/portal] Error:', err.message);
    res.status(500).send('Unable to open billing portal. Please try again.');
  }
});

// ── GET /billing/cancelled ────────────────────────────────────────────────
router.get('/billing/cancelled', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Subscription Cancelled — CollisionIQ</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.09);padding:2.5rem;width:100%;max-width:460px;text-align:center}
    h1{font-size:1.4rem;color:#1B3A6B;margin-bottom:.75rem}
    p{color:#555;font-size:.9rem;line-height:1.6;margin-bottom:1.25rem}
    .btn{display:inline-block;padding:.65rem 1.5rem;background:#1B3A6B;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:.95rem;margin:.3rem}
    .btn:hover{background:#14316b}
    .btn-outline{background:#fff;color:#1B3A6B;border:2px solid #1B3A6B}
    .btn-outline:hover{background:#f0f4f9}
  </style>
</head>
<body>
  <div class="card">
    <h1>Subscription Inactive</h1>
    <p>Your CollisionIQ subscription is no longer active. Reactivate below to restore full access to your shop's jobs and documentation.</p>
    <form method="POST" action="/billing/reactivate" style="display:inline">
      <button type="submit" class="btn">Reactivate Subscription</button>
    </form>
    <a href="/login" class="btn btn-outline">Back to Login</a>
  </div>
</body>
</html>`);
});

// ── POST /billing/reactivate ──────────────────────────────────────────────
router.post('/billing/reactivate', requireShopAdmin, async (req, res) => {
  const shop = req.session.shop;
  if (!shop) return res.redirect('/login');
  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      customer:    shop.stripe_customer_id,
      mode:        'subscription',
      line_items:  [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_BASE_URL}/billing/cancelled`,
    });
    res.redirect(checkoutSession.url);
  } catch (err) {
    console.error('[billing/reactivate] Error:', err.message);
    res.status(500).send('Unable to start reactivation. Please try again.');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────
function requireShopAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  if (user.role === 'platform_admin' || user.role === 'shop_admin') return next();
  return res.status(403).send('Shop admin access required.');
}

module.exports = { webhook, router };
