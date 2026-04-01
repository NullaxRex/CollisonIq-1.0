// /routes/register.js
// Self-serve shop registration with Stripe Checkout.
// Mount in server.js: app.use('/', require('./routes/register'));

'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const stripe = require('../utils/stripe');
const db = require('../db');

const router = express.Router();
const SALT_ROUNDS = 12;

function registerPage(cancelled, error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Register — CollisionIQ</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.09);padding:2.5rem;width:100%;max-width:480px}
    h1{font-size:1.5rem;color:#1B3A6B;margin-bottom:.25rem}
    .sub{color:#666;font-size:.85rem;margin-bottom:1.5rem}
    label{display:block;font-size:.8rem;font-weight:600;color:#444;margin-bottom:.3rem;margin-top:1rem}
    input{width:100%;border:1px solid #ccd1d9;border-radius:6px;padding:.6rem .75rem;font-size:.95rem}
    input:focus{outline:none;border-color:#1B3A6B}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    .btn{width:100%;margin-top:1.5rem;padding:.75rem;background:#1B3A6B;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer}
    .btn:hover{background:#14316b}
    .error{background:#ffe0e0;color:#8b0000;border-radius:6px;padding:.6rem .9rem;font-size:.85rem;margin-top:1rem}
    .cancelled{background:#FFF9CC;color:#7A6000;border-radius:6px;padding:.6rem .9rem;font-size:.85rem;margin-top:1rem}
    .login-link{text-align:center;margin-top:1.25rem;font-size:.85rem;color:#666}
    .login-link a{color:#1B3A6B;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <h1>CollisionIQ</h1>
    <p class="sub">Start your free trial — no setup fees</p>
    ${cancelled ? '<p class="cancelled">Payment was cancelled. You can try again below.</p>' : ''}
    ${error ? `<p class="error">${error}</p>` : ''}
    <form method="POST" action="/register">
      <label for="shop_name">Shop Name</label>
      <input id="shop_name" name="shop_name" required placeholder="Acme Auto Body">
      <label for="owner_name">Owner / Contact Name</label>
      <input id="owner_name" name="owner_name" required placeholder="Jane Smith">
      <label for="email">Email Address</label>
      <input id="email" name="email" type="email" required placeholder="jane@acmeautobody.com">
      <div class="row">
        <div>
          <label for="city">City</label>
          <input id="city" name="city" required placeholder="Springfield">
        </div>
        <div>
          <label for="state">State</label>
          <input id="state" name="state" required placeholder="IL" maxlength="2">
        </div>
      </div>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required placeholder="Minimum 8 characters">
      <label for="password_confirm">Confirm Password</label>
      <input id="password_confirm" name="password_confirm" type="password" required placeholder="Repeat password">
      <button type="submit" class="btn">Continue to Payment &rarr;</button>
    </form>
    <p class="login-link">Already have an account? <a href="/login">Sign in</a></p>
  </div>
</body>
</html>`;
}

// ── GET /register ──────────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  const cancelled = req.query.cancelled === '1';

  const errorMap = {
    fields:    'All fields are required.',
    passwords: 'Passwords do not match.',
    short:     'Password must be at least 8 characters.',
    exists:    'An account with that email already exists.',
    payment:   'Payment setup failed. Please try again.',
  };
  const error = errorMap[req.query.error] || null;

  res.send(registerPage(cancelled, error));
});

// ── POST /register ─────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { shop_name, owner_name, email, password, password_confirm, city, state } = req.body;

  if (!shop_name || !owner_name || !email || !password || !city || !state) {
    return res.redirect('/register?error=fields');
  }
  if (password !== password_confirm) {
    return res.redirect('/register?error=passwords');
  }
  if (password.length < 8) {
    return res.redirect('/register?error=short');
  }

  // Check for existing account (email stored in username column)
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(email);
  if (existing) {
    return res.redirect('/register?error=exists');
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name: shop_name,
      metadata: { shop_name, owner_name },
    });

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    req.session.pending_registration = {
      shop_name, owner_name, email, password_hash, city, state,
      stripe_customer_id: customer.id,
    };

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.APP_BASE_URL}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_BASE_URL}/register?cancelled=1`,
      metadata:    { owner_email: email },
    });

    res.redirect(checkoutSession.url);
  } catch (err) {
    console.error('[register] Stripe error:', err.message);
    res.redirect('/register?error=payment');
  }
});

// ── GET /register/success ──────────────────────────────────────────────────
router.get('/register/success', async (req, res) => {
  const { session_id } = req.query;
  const pending = req.session.pending_registration;

  if (!session_id || !pending) return res.redirect('/register');

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    if (checkoutSession.payment_status !== 'paid') {
      return res.redirect('/register?cancelled=1');
    }

    const sub = checkoutSession.subscription;

    // Write shop — username stored in email field, full_name for display name
    const shopResult = db.prepare(`
      INSERT INTO shops (
        name, city, state,
        stripe_customer_id, stripe_subscription_id,
        subscription_status, subscription_current_period_end,
        created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'))
    `).run(
      pending.shop_name, pending.city, pending.state,
      pending.stripe_customer_id, sub.id,
      sub.current_period_end
    );
    const shopId = shopResult.lastInsertRowid;

    // Write shop_admin user — username = email, full_name = owner_name
    const userResult = db.prepare(`
      INSERT INTO users (shop_id, username, full_name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, 'shop_admin', datetime('now'))
    `).run(shopId, pending.email, pending.owner_name, pending.email, pending.password_hash);
    const userId = userResult.lastInsertRowid;

    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    req.session.user = user;
    req.session.shop = shop;
    delete req.session.pending_registration;

    res.redirect('/');
  } catch (err) {
    console.error('[register/success] Error:', err.message);
    res.redirect('/register?cancelled=1');
  }
});

module.exports = router;
