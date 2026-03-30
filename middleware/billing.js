// /middleware/billing.js
// Apply after requireAuth on all shop-scoped routes.
// platform_admin bypasses all subscription checks.

const db = require('../db'); // adjust path to match your db module

function requireActiveSubscription(req, res, next) {
  const user = req.session.user;
  const shop = req.session.shop;

  // Platform admin always passes through
  if (user && user.role === 'platform_admin') return next();

  if (!shop) return res.redirect('/login');

  const now = Math.floor(Date.now() / 1000);
  const status = shop.subscription_status;
  const graceEnd = shop.grace_period_end;

  // Grace period expired — promote to cancelled
  if ((status === 'past_due' || status === 'grace') && graceEnd && now > graceEnd) {
    db.prepare('UPDATE shops SET subscription_status = ? WHERE id = ?')
      .run('cancelled', shop.id);
    req.session.shop.subscription_status = 'cancelled';
    return res.redirect('/billing/cancelled');
  }

  // Full access
  if (status === 'active') return next();

  // Grace window — read-only, no new jobs
  if (status === 'past_due' || status === 'grace') {
    req.session.billingRestricted = true;
    return next();
  }

  // Never subscribed
  if (status === 'inactive') return res.redirect('/register');

  // Expired
  return res.redirect('/billing/cancelled');
}

module.exports = { requireActiveSubscription };
