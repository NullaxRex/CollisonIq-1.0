# CollisionIQ tests

Kept at the repo root, outside `CollisonIq/`, so they never deploy to Railway.
Every suite creates its own throwaway databases in the OS temp folder, starts the
app on a free port, and never touches `CollisonIq/local-data/` or production.

**Setup (once):** `cd CollisonIq && npm install`. The tests use the app's dependencies.
They need no packages of their own.

**Run** (from this `tests/` folder):

```
npm test               # current Node
npm run test:node22    # Node 22 (downloaded on first use by npx)
npm run test:node26    # Node 26
npm run test:both      # both, one after the other
```

Without npm: `node tests/run-all.js` from the repo root, or
`npx -y -p node@22 node tests/run-all.js` for a specific version.

| File | What it checks |
|---|---|
| `run-suite.js` + `smoke.js` | Starts a seeded server and runs the end-to-end smoke and security checks: auth, CSRF, CSP, tenant isolation on every `:id` route, role matrix, uploads, share links, Stripe webhook, lapsed subscriptions, OEM API, logout |
| `prod-boot-test.js` | Refuses to boot without `SESSION_SECRET` under `NODE_ENV=production` or on Railway; Secure cookies, HSTS, CSP; `seed-demo.js` refuses to run in production |
| `migration-test.js` | Boot migrations run twice: `job_photos` rebuild and v1 `jobs` ADD COLUMN, idempotent, no data changes |
| `bcrypt-compat-test.js` | Hashes made by bcrypt 5 still verify with the installed bcrypt |
| `ford-rules-test.js` | Ford calibration trigger rules from the I-CAR matrix (18 vehicles): triggers, operation checks, camera variants, coverage limits; battery disconnect flag for all makes; Honda unchanged |
| `password-script-test.js` | `CollisonIq/scripts/set-platform-admin-password.js` on a throwaway DB |
| `run-all.js` | Runs all of the above and prints a summary; exits non-zero on any failure |
