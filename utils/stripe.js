// /utils/stripe.js
// Single Stripe instance — import this everywhere, never call new Stripe() elsewhere.

const Stripe = require('stripe');

// Diagnostic: log which Stripe-related env vars Railway is actually injecting
console.log('[stripe] ENV CHECK — STRIPE vars present:', Object.keys(process.env).filter(k => k.includes('STRIPE')));
console.log('[stripe] All env var names:', Object.keys(process.env).join(', '));

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[stripe] WARNING: STRIPE_SECRET_KEY is not set — billing routes will fail at runtime.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
});

module.exports = stripe;
