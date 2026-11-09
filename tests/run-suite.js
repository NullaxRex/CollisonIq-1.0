'use strict';
// Starts the app on a fresh, seeded, throwaway database and runs smoke.js against
// it, using whichever Node runs this script (so `npx -p node@22 node ...` tests
// Node 22 end to end). Usage: node tests/run-suite.js
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { APP_DIR, makeTempDir, freePort } = require('./lib');

(async () => {
  const port = await freePort();
  const data = makeTempDir('ciq-suite-');
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(data, 'collisioniq.db'),
    SESSION_DB_PATH: path.join(data, 'sessions.db'),
    UPLOADS_DIR: path.join(data, 'uploads'),
    PLATFORM_ADMIN_PASSWORD: 'localadmin123',
    STRIPE_WEBHOOK_SECRET: 'whsec_suite_test_secret',
  };
  // Never inherit production-ish settings or real Stripe keys into the test server.
  for (const k of ['NODE_ENV', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'STRIPE_SECRET_KEY', 'SESSION_SECRET', 'APP_BASE_URL']) delete env[k];

  console.log(`[suite] Node ${process.version}, port ${port}, data ${data}`);
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: APP_DIR, env });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  const deadline = Date.now() + 20000;
  while (!log.includes('running on')) {
    if (server.exitCode !== null || Date.now() > deadline) {
      console.error('[suite] server failed to start:\n' + log);
      server.kill();
      process.exit(3);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // seed-demo.js writes ./collisioniq.db in its working directory.
  const seed = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(APP_DIR, 'seed-demo.js')], { cwd: data, env, encoding: 'utf8' });
  if (seed.status !== 0) {
    console.error('[suite] seed failed:\n' + seed.stdout + seed.stderr);
    server.kill();
    process.exit(4);
  }
  // Demo shops are created 'inactive'; make them subscribed for the test run.
  new DatabaseSync(env.DB_PATH).prepare("UPDATE shops SET subscription_status='active'").run();

  const smoke = spawnSync(process.execPath, [path.join(__dirname, 'smoke.js'), `http://localhost:${port}`], {
    env: { ...env, CIQ_DB: env.DB_PATH, WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET },
    stdio: 'inherit',
  });
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  const crashed = /Node\.js v\d|Unhandled|uncaughtException/i.test(log);
  console.log(`[suite] server log: ${crashed ? 'CRASH DETECTED' : 'no crashes'}`);
  process.exit(smoke.status === 0 && !crashed ? 0 : 1);
})();
