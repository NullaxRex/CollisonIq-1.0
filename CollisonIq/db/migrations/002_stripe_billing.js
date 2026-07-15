// /db/migrations/002_stripe_billing.js
// Called from app startup after existing schema init.
// Safe to run multiple times — uses IF NOT EXISTS pattern via try/catch per column.

function runMigration(db) {
  const columns = [
    { name: 'stripe_customer_id',             def: 'TEXT' },
    { name: 'stripe_subscription_id',          def: 'TEXT' },
    { name: 'subscription_status',             def: "TEXT DEFAULT 'inactive'" },
    { name: 'subscription_current_period_end', def: 'INTEGER' },
    { name: 'grace_period_end',                def: 'INTEGER' },
    { name: 'trial_end',                       def: 'INTEGER' },
  ];

  for (const col of columns) {
    try {
      db.prepare(`ALTER TABLE shops ADD COLUMN ${col.name} ${col.def}`).run();
      console.log(`[migration 002] Added column: ${col.name}`);
    } catch (err) {
      if (err.message.includes('duplicate column name')) {
        // Already exists — skip silently
      } else {
        throw err;
      }
    }
  }

  console.log('[migration 002] Stripe billing migration complete.');
}

module.exports = { runMigration };
