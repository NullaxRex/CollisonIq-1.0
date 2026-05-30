'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const fs         = require('fs');
const bcrypt     = require('bcrypt');
const session    = require('express-session');
const multer     = require('multer');
const SQLiteStore = require('connect-sqlite3')(session);
const { DatabaseSync } = require('node:sqlite');
const Stripe     = require('stripe');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Stripe ───────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-04-10' });

// ─── Database ─────────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'collisioniq.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT, state TEXT, address TEXT, phone TEXT,
    stripe_customer_id TEXT, stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'inactive',
    subscription_current_period_end INTEGER,
    grace_period_end INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    full_name TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId TEXT UNIQUE,
    ro TEXT, vin TEXT, year TEXT, make TEXT, model TEXT, trim TEXT,
    technicianName TEXT, repairsPerformed TEXT,
    adasSystems TEXT, rationale TEXT, liabilityWarning TEXT, makeSpecificNotes TEXT,
    preScanRequired TEXT, postScanRequired TEXT, approvedScanTool TEXT,
    status TEXT DEFAULT 'Created',
    track TEXT DEFAULT 'post-collision',
    collision_grade TEXT,
    shareToken TEXT, shareUrl TEXT,
    shop_id INTEGER, created_by INTEGER,
    createdAt TEXT, updatedAt TEXT, last_changed TEXT
  );
  CREATE TABLE IF NOT EXISTS share_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    revoked INTEGER DEFAULT 0
  );
`);

const addCols = [
  ['jobs','mileage','TEXT'], ['jobs','service_date','TEXT'], ['jobs','assigned_tech','TEXT'],
  ['jobs','impact_areas','TEXT'], ['jobs','photo_status','TEXT'],
];
for (const [tbl, col, def] of addCols) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch(e) {}
}

for (const [col, def] of [
  ['stripe_customer_id','TEXT'], ['stripe_subscription_id','TEXT'],
  ['subscription_status',"TEXT DEFAULT 'inactive'"],
  ['subscription_current_period_end','INTEGER'], ['grace_period_end','INTEGER'],
]) {
  try { db.exec(`ALTER TABLE shops ADD COLUMN ${col} ${def}`); } catch(e) {}
}

// ─── ADAS Engine ──────────────────────────────────────────────────────────────
function runADASEngine(make, model, year, repairs) {
  const m = (make || '').toLowerCase();
  const r = Array.isArray(repairs) ? repairs.join(' ').toLowerCase() : (repairs || '').toLowerCase();
  const systems = [], rationale = [], notes = [];
  let preScan = 'REQUIRED — OEM position statement mandates pre-repair scan';
  let postScan = 'REQUIRED — OEM position statement mandates post-repair scan';
  let tool = 'OEM-compatible scan tool';
  let liability = 'Failure to perform required ADAS calibrations after collision repair may result in system malfunction, creating safety hazards and legal liability. Always follow OEM repair procedures.';

  const hasWindshield = /windshield|front camera|glass/i.test(r);
  const hasFrontBumper = /front bumper|radar/i.test(r);
  const hasRearBumper = /rear bumper/i.test(r);
  const hasDoor = /door|mirror/i.test(r);
  const hasAlignment = /alignment|suspension/i.test(r);
  const hasAirbag = /airbag|srs/i.test(r);

  if (m.includes('toyota') || m.includes('lexus')) {
    tool = 'Toyota Techstream / Techstream Lite';
    if (hasWindshield) { systems.push('PCS Static Calibration — TSS Camera (Static, target board required)'); rationale.push('Toyota/Lexus windshield replacement requires PCS camera static calibration per CRIB 191'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); rationale.push('Front bumper/radar work requires front radar calibration'); }
    if (hasRearBumper) { systems.push('Blind Spot Monitor Calibration (Static)'); }
    if (hasAlignment) { systems.push('Dynamic Calibration — Drive at 25+ mph on straight road'); }
    notes.push('Toyota/Lexus: Use Techstream. CRIB 191 governs camera calibration. All ADAS work requires pre and post scan.');
  } else if (m.includes('ford') || m.includes('lincoln')) {
    tool = 'Ford IDS or FDRS';
    if (hasWindshield) { systems.push('IPMA Dynamic Calibration — Drive cycle required (25-85 mph)'); rationale.push('Ford windshield replacement triggers IPMA dynamic calibration per Ford position statement 2018'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasDoor) { systems.push('SODCM Blind Spot / Lane Change Calibration'); }
    notes.push('Ford/Lincoln: IPMA handles forward camera. SODCM handles blind spot. Use FDRS for programming.');
  } else if (m.includes('chev') || m.includes('gmc') || m.includes('buick') || m.includes('cadillac')) {
    tool = 'GM GDS2';
    if (hasWindshield) { systems.push('Forward Camera Calibration (VARIES — Static or Dynamic per model)'); rationale.push('GM camera calibration requirements vary by model year'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    notes.push('GM: Calibration type varies by model. Verify in GDS2 before proceeding.');
  } else if (m.includes('honda') || m.includes('acura')) {
    tool = 'Honda i-HDS with Denso DST-i VCI';
    if (hasWindshield) { systems.push('Honda Sensing Multipurpose Camera — Static Calibration'); rationale.push('Honda windshield replacement requires Honda Sensing camera static calibration per May 2019 position statement'); }
    if (hasFrontBumper) { systems.push('Millimeter Wave Radar Unit Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Blind Spot Information System Calibration (Static)'); }
    notes.push('Honda/Acura: Position statement May 2019 governs all ADAS calibration requirements.');
  } else if (m.includes('nissan') || m.includes('infiniti')) {
    tool = 'Nissan/Infiniti CONSULT';
    if (hasWindshield) { systems.push('Front Camera Calibration (Static)'); rationale.push('Nissan/Infiniti front camera calibration required per NPSB/18-409'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Rear Sonar / BSM Calibration (Static)'); }
    notes.push('Nissan/Infiniti: NPSB/18-409 governs calibration requirements.');
  } else if (m.includes('kia') || m.includes('hyundai') || m.includes('genesis')) {
    tool = 'Kia/Hyundai GDS (Global Diagnostic System)';
    if (hasWindshield) { systems.push('SCC Front Camera Calibration (Static)'); rationale.push('Kia/Hyundai front camera calibration required per OEM position statements'); }
    if (hasFrontBumper) { systems.push('Front Radar Calibration (Static)'); }
    if (hasRearBumper) { systems.push('Rear Cross Traffic Alert Calibration (Static)'); }
  } else if (m.includes('subaru')) {
    tool = 'Subaru SSM4 / asTech remote';
    if (hasWindshield) { systems.push('EyeSight Dual-Camera Calibration — SST required (Static)'); rationale.push('Subaru EyeSight calibration requires Special Service Tool per July 2017 position statement'); }
    if (hasFrontBumper) { systems.push('Front Grille Radar Calibration (Static)'); }
    notes.push('Subaru: EyeSight calibration REQUIRES special SST tool. Cannot be performed without it.');
  } else if (m.includes('mazda')) {
    tool = 'Mazda diagnostic tool';
    if (hasWindshield) { systems.push('Front Camera Calibration (Static)'); rationale.push('Mazda front camera calibration required per January 2018 position statement'); }
  } else if (m.includes('mercedes')) {
    tool = 'Mercedes-Benz XENTRY';
    if (hasWindshield) { systems.push('Stereo Multi-Purpose Camera — Static Calibration'); }
    if (hasFrontBumper) { systems.push('Distronic Radar Calibration (Static)'); }
    notes.push('Mercedes-Benz: All calibrations require XENTRY. Refer to MBUSA position statement.');
  } else if (m.includes('jaguar') || m.includes('land rover')) {
    tool = 'JLR Pathfinder';
    systems.push('Full Pathfinder Diagnostic Scan Required');
    if (hasWindshield) { systems.push('Windscreen Camera Calibration (Static)'); }
    notes.push('Jaguar/Land Rover: All collision repairs require full Pathfinder scan per JLRGPS 02v2.');
  } else if (m.includes('volvo')) {
    tool = 'Volvo VIDA';
    if (hasWindshield) { systems.push('Camera/Sensor Calibration (Static)'); }
    if (hasFrontBumper) { systems.push('Autonomous Drive Sensor Calibration (VARIES)'); }
  } else if (m.includes('tesla')) {
    tool = 'Tesla Toolbox 3 (not OBDII compatible)';
    preScan = 'REQUIRED — Tesla alert-based scan required (not standard DTC scan)';
    postScan = 'REQUIRED — Tesla alert-based scan required (not standard DTC scan)';
    systems.push('Tesla Autopilot Camera Calibration — Drive cycle required');
    notes.push('Tesla does not use standard DTCs. Requires Tesla Toolbox 3. Alert-based diagnostic system only.');
  }

  if (hasAirbag) { systems.push('Full System Scan Required — Airbag/SRS deployment triggers all-makes scan requirement'); }
  if (systems.length === 0) { systems.push('No ADAS calibration flagged for the reported repairs on this vehicle'); }

  return {
    adasSystems: systems.join('\n'), rationale: rationale.join('\n'),
    liabilityWarning: liability, makeSpecificNotes: notes.join('\n'),
    preScanRequired: preScan, postScanRequired: postScan, approvedScanTool: tool,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function generateJobId() {
  const d = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `CIQ-${d}-${Math.floor(1000+Math.random()*9000)}`;
}
function formatDate(iso) { return iso ? iso.slice(0,10) : '—'; }
function statusClass(s) {
  return s === 'In Progress' ? 'orange' : s === 'Calibration Complete' ? 'green' : s === 'Closed' ? 'gray' : 'blue';
}
function scanBadgeClass(s) {
  const u = (s||'').toUpperCase();
  return u.startsWith('REQUIRED') ? 'red' : (u.startsWith('STRONGLY') || u.startsWith('HIGHLY') || u.startsWith('IMPERATIVE')) ? 'amber' : 'blue';
}
function scanBadgeLabel(s) {
  const u = (s||'').toUpperCase();
  if (u.startsWith('REQUIRED')) return 'REQUIRED';
  if (u.startsWith('STRONGLY')) return 'STRONGLY RECOMMENDED';
  if (u.startsWith('HIGHLY')) return 'HIGHLY RECOMMENDED';
  return 'RECOMMENDED';
}
function setFlash(req, type, msg) { req.session.flash = { type, msg }; }
function consumeFlash(req) { const f = req.session.flash || null; delete req.session.flash; return f; }

// ─── Layout ───────────────────────────────────────────────────────────────────
function layout(title, content, activeNav='', user=null) {
  const nav = (href, key, label) => `<a href="${href}" class="${activeNav===key?'active':''}">${label}</a>`;
  const role = user ? user.role : null;
  let navLinks = '';
  if (role === 'platform_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}${nav('/admin','admin','Admin')}${nav('/platform/shops','shops','Shops')}${nav('/platform/billing','billing','Billing')}<a href="/logout">Logout</a>`;
  } else if (role === 'shop_admin') {
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}${nav('/admin','admin','Admin')}${nav('/admin/users','users','Users')}<a href="/logout">Logout</a>`;
  } else if (role === 'technician') {
    navLinks = `${nav('/','list','My Jobs')}${nav('/reference','reference','ADAS Reference')}<a href="/logout">Logout</a>`;
  } else if (role === 'guest') {
    // ── Guest: full nav access until restricted later ──
    navLinks = `${nav('/','list','Jobs')}${nav('/new','new','New Job')}${nav('/reference','reference','ADAS Reference')}<a href="/logout">Logout</a>`;
  } else if (role) {
    navLinks = `${nav('/','list','Jobs')}${nav('/reference','reference','ADAS Reference')}<a href="/logout">Logout</a>`;
  }
  const userDisplay = user ? `<span class="nav-user">${escapeHtml(user.full_name||user.username)} <span class="nav-role">[${escapeHtml(user.role)}]</span></span>` : '';
  const adminBanner = role==='platform_admin' ? `<div style="background:#1B3A6B;color:#fff;text-align:center;padding:6px;font-size:13px">&#9881; PLATFORM ADMIN — CUELJURIS LLC</div>` : '';
  // ── Guest banner — visible reminder of guest mode ──
  const guestBanner = role==='guest' ? `<div style="background:#92400e;color:#fef3c7;text-align:center;padding:6px;font-size:13px">&#128100; Guest Mode — <a href="/register" style="color:#fef3c7;font-weight:600;text-decoration:underline">Create a free account</a> to save your work</div>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)} — CollisionIQ</title><link rel="stylesheet" href="/style.css"></head><body>${adminBanner}${guestBanner}<header class="site-header"><div class="header-inner"><div class="brand"><a href="/" class="brand-logo">CollisionIQ</a><span class="brand-tagline">ADAS Calibration Documentation Platform</span></div><nav class="main-nav">${navLinks}${userDisplay}</nav></div></header><main class="main-content">${content}</main><footer class="site-footer"><p>&copy; 2026 Cueljuris LLC &mdash; CollisionIQ Platform</p></footer></body></html>`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    console.error('[webhook] signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const status = ['active','trialing'].includes(sub.status) ? sub.status : sub.status === 'past_due' ? 'past_due' : 'inactive';
    db.prepare(`UPDATE shops SET subscription_status=?, stripe_subscription_id=?, subscription_current_period_end=? WHERE stripe_customer_id=?`)
      .run(status, sub.id, sub.current_period_end, sub.customer);
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    db.prepare(`UPDATE shops SET subscription_status='cancelled' WHERE stripe_customer_id=?`).run(sub.customer);
  }

  res.json({ received: true });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
  secret: process.env.SESSION_SECRET || 'collisioniq-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!['shop_admin','platform_admin'].includes(req.session.user.role)) return res.status(403).send('Access denied.');
  next();
}
function requirePlatformAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'platform_admin') return res.status(403).send('Access denied.');
  next();
}
function requireSubscription(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  // Platform admin and guest bypass subscription check
  if (['platform_admin', 'guest'].includes(req.session.user.role)) return next();
  const shop = db.prepare('SELECT subscription_status FROM shops WHERE id=?').get(req.session.user.shop_id);
  if (!shop || !['active','trialing'].includes(shop.subscription_status)) return res.redirect('/billing/inactive');
  next();
}

// ─── Registration ─────────────────────────────────────────────────────────────
app.get('/register', (req, res) => {
  const cancelled = req.query.cancelled === '1';
  res.send(layout('Register', `
    <div style="max-width:480px;margin:3rem auto;background:#fff;padding:2rem;border-radius:8px;border:1px solid #e0e0e0">
      <h1 style="margin-bottom:.25rem">Create Your Shop Account</h1>
      <p style="color:#666;margin-bottom:1.5rem;font-size:.9rem">CollisionIQ — Free to start. No credit card required.</p>
      ${cancelled ? '<div style="background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:.6rem;border-radius:4px;margin-bottom:1rem">Registration cancelled. Please try again.</div>' : ''}
      <form method="POST" action="/register">
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Shop Name</label><input type="text" name="shop_name" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Your Name</label><input type="text" name="owner_name" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Email</label><input type="email" name="email" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Username</label><input type="text" name="username" required autocomplete="off" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Password</label><input type="password" name="password" required minlength="8" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <div style="margin-bottom:1.5rem"><label style="display:block;font-weight:600;margin-bottom:.3rem">Confirm Password</label><input type="password" name="password_confirm" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px"></div>
        <button type="submit" style="width:100%;padding:.65rem;background:#1a1a2e;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer">Create Free Account →</button>
      </form>
      <div style="text-align:center;margin-top:1rem;font-size:.85rem;color:#666">Already have an account? <a href="/login" style="color:#1B3A6B;font-weight:600">Sign in</a></div>
    </div>`));
});

app.post('/register', async (req, res) => {
  const { shop_name, owner_name, email, username, password, password_confirm } = req.body;
  if (!shop_name || !owner_name || !email || !username || !password) return res.redirect('/register?error=1');
  if (password !== password_confirm) return res.redirect('/register?error=1');
  if (password.length < 8) return res.redirect('/register?error=1');

  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) return res.redirect('/register?error=1');

  try {
    const customer = await stripe.customers.create({ email, name: shop_name, metadata: { owner_name } });
    const password_hash = await bcrypt.hash(password, 12);
    req.session.pending_registration = { shop_name, owner_name, email, username, password_hash, stripe_customer_id: customer.id };

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{ price: 'price_1TZBLcQx0YVznfDrJelvhtP4', quantity: 1 }],
      payment_method_collection: 'if_required',
      success_url: `${process.env.APP_BASE_URL || 'https://'+req.get('host')}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL || 'https://'+req.get('host')}/register?cancelled=1`,
    });
    res.redirect(checkoutSession.url);
  } catch (err) {
    console.error('[register] error:', err.message);
    res.redirect('/register?error=1');
  }
});

app.get('/register/success', async (req, res) => {
  const { session_id } = req.query;
  const pending = req.session.pending_registration;
  if (!session_id || !pending) return res.redirect('/register');

  try {
    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    const allowed = ['paid', 'no_payment_required'];
    if (!allowed.includes(checkoutSession.payment_status)) return res.redirect('/register?cancelled=1');

    const sub = checkoutSession.subscription;
    const subStatus = sub && ['active','trialing'].includes(sub.status) ? sub.status : 'trialing';
    const now = new Date().toISOString();

    const shopResult = db.prepare(`INSERT INTO shops (name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_current_period_end, created_at) VALUES (?,?,?,?,?,?)`)
      .run(pending.shop_name, pending.stripe_customer_id, sub ? sub.id : null, subStatus, sub ? sub.current_period_end : null, now);
    const shopId = shopResult.lastInsertRowid;

    const userResult = db.prepare(`INSERT INTO users (shop_id, username, email, password_hash, role, full_name, created_at) VALUES (?,?,?,?,'shop_admin',?,?)`)
      .run(shopId, pending.username, pending.email, pending.password_hash, pending.owner_name, now);

    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userResult.lastInsertRowid);
    const shop = db.prepare('SELECT * FROM shops WHERE id=?').get(shopId);
    req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, shop_id: user.shop_id };
    req.session.shop = shop;
    delete req.session.pending_registration;
    res.redirect('/onboarding');
  } catch (err) {
    console.error('[register/success] error:', err.message);
    res.redirect('/register?cancelled=1');
  }
});

// ─── Onboarding ───────────────────────────────────────────────────────────────
app.get('/onboarding', requireAuth, (req, res) => {
  const user = req.session.user;
  const shop = db.prepare('SELECT * FROM shops WHERE id=?').get(user.shop_id);
  res.send(layout('Welcome to CollisionIQ', `
    <div style="max-width:560px;margin:3rem auto">
      <div style="background:#1B3A6B;color:#fff;border-radius:8px 8px 0 0;padding:2rem">
        <div style="font-size:1.5rem;font-weight:700;margin-bottom:.25rem">&#10003; Account Created!</div>
        <div style="opacity:.85;font-size:.95rem">Welcome to CollisionIQ, ${escapeHtml(user.full_name||user.username)}. Let's finish setting up your shop.</div>
      </div>
      <div style="background:#fff;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;padding:2rem">
        <h2 style="font-size:1.1rem;color:#1B3A6B;margin-bottom:1.25rem">Shop Details</h2>
        <form method="POST" action="/onboarding">
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Shop Name</label>
            <input type="text" name="shop_name" value="${escapeHtml(shop?shop.name:'')}" required style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
            <div>
              <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">City</label>
              <input type="text" name="city" placeholder="Houston" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
            </div>
            <div>
              <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">State</label>
              <input type="text" name="state" placeholder="TX" maxlength="2" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
            </div>
          </div>
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Phone</label>
            <input type="text" name="phone" placeholder="(555) 555-5555" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <div style="margin-bottom:1.5rem">
            <label style="display:block;font-size:.85rem;font-weight:600;color:#444;margin-bottom:.3rem">Address</label>
            <input type="text" name="address" placeholder="123 Main St" style="width:100%;box-sizing:border-box;padding:.55rem;border:1px solid #ccc;border-radius:4px">
          </div>
          <button type="submit" style="width:100%;padding:.7rem;background:#1B3A6B;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer">Complete Setup → Go to Dashboard</button>
        </form>
        <div style="text-align:center;margin-top:1rem">
          <a href="/" style="color:#666;font-size:.85rem;text-decoration:none">Skip for now →</a>
        </div>
      </div>
    </div>`, '', user));
});

app.post('/onboarding', requireAuth, (req, res) => {
  const { shop_name, city, state, phone, address } = req.body;
  db.prepare('UPDATE shops SET name=?, city=?, state=?, phone=?, address=? WHERE id=?')
    .run(shop_name||'', city||'', state||'', phone||'', address||'', req.session.user.shop_id);
  res.redirect('/');
});

app.get('/billing/inactive', (req, res) => {
  res.send(layout('Subscription Inactive', `
    <div style="max-width:480px;margin:3rem auto;text-align:center;padding:2rem">
      <h1>Subscription Inactive</h1>
      <p>Your subscription is not active. Please subscribe to continue using CollisionIQ.</p>
      <a href="/register" class="btn btn-primary" style="display:inline-block;margin-top:1rem">Subscribe Now</a>
    </div>`));
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const error = req.query.error || '';
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login — CollisionIQ</title><link rel="stylesheet" href="/style.css"><style>
    .login-wrap{display:flex;justify-content:center;align-items:center;min-height:80vh}
    .login-card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:2.5rem 2rem;width:100%;max-width:380px;box-shadow:0 2px 12px rgba(0,0,0,.07)}
    .login-logo{font-size:1.5rem;font-weight:700;color:#1a1a2e;margin-bottom:.25rem}
    .login-sub{font-size:.85rem;color:#666;margin-bottom:2rem}
    .login-btn{width:100%;padding:.65rem;background:#1a1a2e;color:#fff;border:none;border-radius:4px;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.5rem}
    .login-btn:hover{background:#2d2d4e}
    .guest-btn{display:block;width:100%;padding:.6rem;background:#fff;color:#92400e;border:2px solid #d97706;border-radius:4px;font-size:.95rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-top:.75rem;box-sizing:border-box}
    .guest-btn:hover{background:#fffbeb}
    .divider{display:flex;align-items:center;gap:.75rem;margin:1.25rem 0;color:#aaa;font-size:.8rem}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#e5e7eb}
  </style></head><body><div class="login-wrap"><div class="login-card">
    <div class="login-logo">CollisionIQ</div>
    <div class="login-sub">ADAS Calibration Documentation Platform</div>
    ${error?'<div style="background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:.6rem;border-radius:4px;margin-bottom:1rem;font-size:.875rem">Invalid username or password.</div>':''}
    <form method="POST" action="/login">
      <div style="margin-bottom:1rem"><label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.3rem">Username</label><input type="text" name="username" required autofocus style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1px solid #ccc;border-radius:4px;font-size:.95rem"></div>
      <div style="margin-bottom:1rem"><label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:.3rem">Password</label><input type="password" name="password" required style="width:100%;box-sizing:border-box;padding:.55rem .75rem;border:1px solid #ccc;border-radius:4px;font-size:.95rem"></div>
      <button type="submit" class="login-btn">Sign In</button>
    </form>
    <div class="divider">or</div>
    <form method="POST" action="/guest-login">
      <button type="submit" class="guest-btn">&#128100; Continue as Guest</button>
    </form>
    <div style="text-align:center;margin-top:1.25rem;font-size:.85rem;color:#666">New shop? <a href="/register" style="color:#1B3A6B;font-weight:600">Create an account</a></div>
    <div style="text-align:center;margin-top:.5rem;font-size:.75rem;color:#999">&copy; 2026 Cueljuris LLC</div>
  </div></div></body></html>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
  if (!user) return res.redirect('/login?error=1');
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.redirect('/login?error=1');
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, shop_id: user.shop_id };
  res.redirect('/');
});

// ─── Guest Login ──────────────────────────────────────────────────────────────
app.post('/guest-login', (req, res) => {
  const guestUser = db.prepare("SELECT * FROM users WHERE username='guest' AND active=1").get();
  if (!guestUser) return res.redirect('/login?error=1');
  req.session.user = {
    id: guestUser.id,
    username: guestUser.username,
    full_name: 'Guest',
    role: 'guest',
    shop_id: guestUser.shop_id,
  };
  res.redirect('/');
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

// ─── Jobs List ────────────────────────────────────────────────────────────────
app.get('/', requireAuth, requireSubscription, (req, res) => {
  const flash = consumeFlash(req);
  const search = (req.query.search || '').trim();
  const user = req.session.user;
  const shopId = user.role === 'platform_admin' ? null : user.shop_id;

  let jobs;
  if (search) {
    const q = `%${search}%`;
    jobs = shopId
      ? db.prepare('SELECT * FROM jobs WHERE shop_id=? AND (ro LIKE ? OR vin LIKE ? OR technicianName LIKE ?) ORDER BY last_changed DESC').all(shopId,q,q,q)
      : db.prepare('SELECT * FROM jobs WHERE ro LIKE ? OR vin LIKE ? OR technicianName LIKE ? ORDER BY last_changed DESC').all(q,q,q);
  } else {
    jobs = shopId
      ? db.prepare('SELECT * FROM jobs WHERE shop_id=? ORDER BY last_changed DESC').all(shopId)
      : db.prepare('SELECT * FROM jobs ORDER BY last_changed DESC').all();
  }

  const rows = jobs.map(j => `<tr>
    <td><a href="/jobs/${encodeURIComponent(j.jobId)}" style="font-family:monospace;font-weight:600;color:#1B3A6B;text-decoration:none">${escapeHtml(j.jobId)}</a></td>
    <td>${escapeHtml(j.ro)||'—'}</td>
    <td>${[j.year,j.make,j.model].filter(Boolean).map(escapeHtml).join(' ')||'—'}</td>
    <td><span class="badge badge-${statusClass(j.status)}">${escapeHtml(j.status)}</span></td>
    <td>${formatDate(j.createdAt)}</td>
    <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
  </tr>`).join('');

  const content = `
    ${flash?`<div style="background:${flash.type==='success'?'#D6F0D6':'#FFD6D6'};color:${flash.type==='success'?'#1A6B1A':'#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem">${escapeHtml(flash.msg)}</div>`:''}
    <div class="page-header"><h1>Jobs <span class="count-badge">${jobs.length}</span></h1><a href="/new" class="btn btn-primary">+ New Job</a></div>
    <div class="search-bar"><form method="GET" action="/"><input type="text" name="search" placeholder="Search by RO#, VIN, or Technician…" value="${escapeHtml(search)}"><button type="submit" class="btn">Search</button>${search?'<a href="/" class="btn btn-ghost">Clear</a>':''}</form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Job ID</th><th>RO #</th><th>Vehicle</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No jobs found.</td></tr>'}</tbody></table></div>`;

  res.send(layout('Jobs', content, 'list', user));
});

// ─── New Job ──────────────────────────────────────────────────────────────────
app.get('/new', requireAuth, requireSubscription, (req, res) => {
  const repairOptions = ['Windshield','Front Camera Area','Front Bumper','Rear Bumper','Radar','Structural Body Repair','Airbag / SRS Deployment','Wheel Alignment','Suspension','Door / Mirror Repair','EV / Hybrid Vehicle','Other'];
  const checkboxes = repairOptions.map(r => `<label class="checkbox-label"><input type="checkbox" name="repairs" value="${escapeHtml(r)}"><span>${escapeHtml(r)}</span></label>`).join('');
  const content = `
    <div class="page-header"><h1>New Job</h1></div>
    <form method="POST" action="/jobs" class="job-form">
      <div class="form-section"><h2 class="section-heading">Vehicle Information</h2><div class="form-grid">
        <div class="form-group"><label>RO Number <span class="req">*</span></label><input type="text" name="ro" required placeholder="e.g. RO-12345"></div>
        <div class="form-group"><label>VIN</label><input type="text" name="vin" maxlength="17" placeholder="17-character VIN" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Year</label><input type="text" name="year" maxlength="4" placeholder="e.g. 2022"></div>
        <div class="form-group"><label>Make</label><input type="text" name="make" placeholder="e.g. Toyota"></div>
        <div class="form-group"><label>Model</label><input type="text" name="model" placeholder="e.g. Camry"></div>
        <div class="form-group"><label>Trim</label><input type="text" name="trim" placeholder="e.g. XSE"></div>
        <div class="form-group"><label>Technician Name <span class="req">*</span></label><input type="text" name="technicianName" required placeholder="Full name"></div>
      </div></div>
      <div class="form-section"><h2 class="section-heading">Repairs Performed</h2><div class="checkbox-grid">${checkboxes}</div>
        <div class="form-group" style="margin-top:1rem"><label>Other Repairs</label><input type="text" name="otherRepairs" placeholder="Describe additional repairs…"></div>
      </div>
      <div class="form-actions"><a href="/" class="btn btn-ghost">Cancel</a><button type="submit" class="btn btn-primary btn-lg">Submit &amp; Generate ADAS Report</button></div>
    </form>`;
  res.send(layout('New Job', content, 'new', req.session.user));
});

app.post('/jobs', requireAuth, requireSubscription, (req, res) => {
  const { ro, vin, year, make, model, trim, technicianName, otherRepairs } = req.body;
  let repairs = req.body.repairs || [];
  if (!Array.isArray(repairs)) repairs = [repairs];
  if (otherRepairs && otherRepairs.trim()) repairs.push(otherRepairs.trim());

  const adas = runADASEngine(make, model, year, repairs);
  const jobId = generateJobId();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO jobs (jobId,ro,vin,year,make,model,trim,technicianName,repairsPerformed,adasSystems,rationale,liabilityWarning,makeSpecificNotes,preScanRequired,postScanRequired,approvedScanTool,status,shareToken,shareUrl,createdAt,updatedAt,last_changed,shop_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Created',?,?,?,?,?,?,?)`)
    .run(jobId, ro||'', (vin||'').toUpperCase(), year||'', make||'', model||'', trim||'', technicianName||'',
      repairs.join(', '), adas.adasSystems, adas.rationale, adas.liabilityWarning, adas.makeSpecificNotes,
      adas.preScanRequired, adas.postScanRequired, adas.approvedScanTool,
      shareToken, `/share/${shareToken}`, now, now, now,
      req.session.user.shop_id || 1, req.session.user.id);

  res.redirect(`/jobs/${jobId}`);
});

// ─── Job View ─────────────────────────────────────────────────────────────────
app.get('/jobs/:jobId', requireAuth, requireSubscription, (req, res) => {
  const user = req.session.user;
  const shopId = user.role === 'platform_admin' ? null : user.shop_id;
  const job = shopId
    ? db.prepare('SELECT * FROM jobs WHERE jobId=? AND shop_id=?').get(req.params.jobId, shopId)
    : db.prepare('SELECT * FROM jobs WHERE jobId=?').get(req.params.jobId);

  if (!job) return res.status(404).send(layout('Not Found', '<div class="error-page"><h1>Job Not Found</h1><a href="/" class="btn btn-primary">Back to Jobs</a></div>', '', user));

  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const rationaleList = job.rationale ? job.rationale.split('\n').filter(Boolean) : [];
  const activeToken = db.prepare('SELECT token FROM share_tokens WHERE job_id=? AND revoked=0 ORDER BY id DESC LIMIT 1').get(job.jobId);

  const adasItems = adasList.length > 0
    ? adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')
    : `<li class="adas-item adas-none"><span class="adas-flag adas-ok">&#10003;</span><span>No ADAS calibration flagged for the reported repairs on this vehicle.</span></li>`;

  const content = `
    <div class="job-doc">
      <div class="job-doc-header">
        <div><div class="doc-brand">CollisionIQ</div><div class="doc-owner">Cueljuris LLC</div></div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          <div><span class="meta-label">Status</span> <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span></div>
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print / Save PDF</button>
          ${['platform_admin','shop_admin','service_writer'].includes(user.role) ? `<a href="/jobs/${encodeURIComponent(job.jobId)}/edit" class="btn btn-white">&#9998; Edit</a>` : ''}
          <a href="/" class="btn btn-ghost-white">Back</a>
        </div>
      </div>
      <section class="doc-section"><h2 class="doc-section-title">Vehicle Information</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">RO Number</span><span class="info-val">${escapeHtml(job.ro)||'—'}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Year</span><span class="info-val">${escapeHtml(job.year)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Make</span><span class="info-val">${escapeHtml(job.make)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Model</span><span class="info-val">${escapeHtml(job.model)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Trim</span><span class="info-val">${escapeHtml(job.trim)||'—'}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName)||'—'}</span></div>
          <div class="info-row info-row-full"><span class="info-label">Repairs</span><span class="info-val">${escapeHtml(job.repairsPerformed)||'—'}</span></div>
        </div>
      </section>
      <section class="doc-section scan-req-section"><h2 class="doc-section-title">Scan Requirements</h2>
        <div class="scan-req-grid">
          <div class="scan-req-row"><span class="scan-req-label">Pre-Repair Scan</span><span class="badge scan-badge scan-badge-${scanBadgeClass(job.preScanRequired)}">${escapeHtml(scanBadgeLabel(job.preScanRequired))}</span><span class="scan-req-detail">${escapeHtml(job.preScanRequired||'RECOMMENDED')}</span></div>
          <div class="scan-req-row"><span class="scan-req-label">Post-Repair Scan</span><span class="badge scan-badge scan-badge-${scanBadgeClass(job.postScanRequired)}">${escapeHtml(scanBadgeLabel(job.postScanRequired))}</span><span class="scan-req-detail">${escapeHtml(job.postScanRequired||'RECOMMENDED')}</span></div>
          <div class="scan-req-row scan-req-tool-row"><span class="scan-req-label">&#128295; Approved Scan Tool</span><span class="scan-tool-value">${escapeHtml(job.approvedScanTool||'Consult OEM service information')}</span></div>
        </div>
      </section>
      <section class="doc-section adas-section"><h2 class="doc-section-title">ADAS Systems — Calibration Required</h2><ul class="adas-list">${adasItems}</ul></section>
      <section class="doc-section"><h2 class="doc-section-title">Rationale</h2><ul class="rationale-list">${rationaleList.map(r=>`<li>${escapeHtml(r)}</li>`).join('')||'<li>No rationale generated.</li>'}</ul></section>
      <section class="doc-section warning-section"><h2 class="doc-section-title">Liability Warning</h2><div class="warning-box"><span class="warning-icon">&#9888;</span><p>${escapeHtml(job.liabilityWarning)||'—'}</p></div></section>
      <section class="doc-section"><h2 class="doc-section-title">Make-Specific Notes</h2><div class="notes-box"><p>${escapeHtml(job.makeSpecificNotes)||'—'}</p></div></section>
      <section class="doc-section no-print"><h2 class="doc-section-title">Insurer Link</h2>
        ${activeToken
          ? `<div><code id="shareUrl">${escapeHtml(req.protocol+'://'+req.get('host')+'/share/'+activeToken.token)}</code> <button onclick="navigator.clipboard.writeText(document.getElementById('shareUrl').textContent)" class="btn btn-sm">Copy</button> <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share/revoke" style="display:inline"><button class="btn btn-sm" style="border-color:#c0392b;color:#c0392b">Revoke</button></form></div>`
          : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share"><button class="btn btn-primary btn-sm">Generate Insurer Link</button></form>`}
      </section>
      <div class="doc-footer"><p>Generated by CollisionIQ — Job ID: ${escapeHtml(job.jobId)} — &copy; 2026 Cueljuris LLC</p></div>
    </div>`;

  res.send(layout(`Job ${job.jobId}`, content, '', user));
});

// ─── Edit Job ─────────────────────────────────────────────────────────────────
app.get('/jobs/:jobId/edit', requireAuth, requireSubscription, (req, res) => {
  const user = req.session.user;
  const job = db.prepare('SELECT * FROM jobs WHERE jobId=?').get(req.params.jobId);
  if (!job) return res.status(404).send('Not found');

  const repairOptions = ['Windshield','Front Camera Area','Front Bumper','Rear Bumper','Radar','Structural Body Repair','Airbag / SRS Deployment','Wheel Alignment','Suspension','Door / Mirror Repair','EV / Hybrid Vehicle','Other'];
  const existing = (job.repairsPerformed||'').split(',').map(s=>s.trim());
  const checkboxes = repairOptions.map(r => `<label class="checkbox-label"><input type="checkbox" name="repairs" value="${escapeHtml(r)}"${existing.includes(r)?' checked':''}><span>${escapeHtml(r)}</span></label>`).join('');

  const content = `
    <div style="max-width:720px;margin:0 auto">
      <div class="page-header"><h1>Edit Job — <span style="font-family:monospace">${escapeHtml(job.jobId)}</span></h1><a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a></div>
      <div class="card" style="padding:1.5rem">
        <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/edit">
          <div class="form-row-2">
            <div class="form-group"><label>RO Number</label><input type="text" name="ro" value="${escapeHtml(job.ro||'')}"></div>
            <div class="form-group"><label>VIN</label><input type="text" name="vin" value="${escapeHtml(job.vin||'')}" maxlength="17"></div>
            <div class="form-group"><label>Year</label><input type="text" name="year" value="${escapeHtml(job.year||'')}"></div>
            <div class="form-group"><label>Make</label><input type="text" name="make" value="${escapeHtml(job.make||'')}"></div>
            <div class="form-group"><label>Model</label><input type="text" name="model" value="${escapeHtml(job.model||'')}"></div>
            <div class="form-group"><label>Trim</label><input type="text" name="trim" value="${escapeHtml(job.trim||'')}"></div>
            <div class="form-group"><label>Technician</label><input type="text" name="technicianName" value="${escapeHtml(job.technicianName||'')}"></div>
          </div>
          <div class="form-section" style="margin-top:1rem"><h3>Repairs Performed</h3><div class="checkbox-grid">${checkboxes}</div></div>
          <div style="margin-top:1.5rem;display:flex;gap:.75rem"><button type="submit" class="btn btn-primary">Save Changes</button><a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a></div>
        </form>
      </div>
    </div>`;
  res.send(layout(`Edit ${job.jobId}`, content, '', user));
});

app.post('/jobs/:jobId/edit', requireAuth, requireSubscription, (req, res) => {
  const { ro, vin, year, make, model, trim, technicianName } = req.body;
  let repairs = req.body.repairs || [];
  if (!Array.isArray(repairs)) repairs = [repairs];
  const adas = runADASEngine(make, model, year, repairs);
  const now = new Date().toISOString();
  db.prepare(`UPDATE jobs SET ro=?,vin=?,year=?,make=?,model=?,trim=?,technicianName=?,repairsPerformed=?,adasSystems=?,rationale=?,liabilityWarning=?,makeSpecificNotes=?,preScanRequired=?,postScanRequired=?,approvedScanTool=?,updatedAt=?,last_changed=? WHERE jobId=?`)
    .run(ro||'', (vin||'').toUpperCase(), year||'', make||'', model||'', trim||'', technicianName||'',
      repairs.join(', '), adas.adasSystems, adas.rationale, adas.liabilityWarning, adas.makeSpecificNotes,
      adas.preScanRequired, adas.postScanRequired, adas.approvedScanTool, now, now, req.params.jobId);
  setFlash(req, 'success', 'Job updated.');
  res.redirect(`/jobs/${encodeURIComponent(req.params.jobId)}`);
});

// ─── Share Link ───────────────────────────────────────────────────────────────
app.post('/jobs/:jobId/share', requireAuth, (req, res) => {
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO share_tokens (job_id, token, created_at) VALUES (?,?,?)').run(req.params.jobId, token, new Date().toISOString());
  res.redirect(`/jobs/${encodeURIComponent(req.params.jobId)}`);
});
app.post('/jobs/:jobId/share/revoke', requireAuth, (req, res) => {
  db.prepare('UPDATE share_tokens SET revoked=1 WHERE job_id=? AND revoked=0').run(req.params.jobId);
  res.redirect(`/jobs/${encodeURIComponent(req.params.jobId)}`);
});
app.get('/share/:token', (req, res) => {
  const row = db.prepare('SELECT * FROM share_tokens WHERE token=? AND revoked=0').get(req.params.token);
  if (!row) return res.status(404).send(layout('Link Expired', '<div class="error-page"><h1>Link Not Found or Revoked</h1></div>'));
  const job = db.prepare('SELECT * FROM jobs WHERE jobId=?').get(row.job_id);
  if (!job) return res.status(404).send('Not found');
  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const content = `<div class="job-doc"><div class="job-doc-header"><div><div class="doc-brand">CollisionIQ — Insurer View</div><div class="doc-owner">Cueljuris LLC</div></div><div class="doc-meta"><div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div><div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div></div></div><section class="doc-section"><h2 class="doc-section-title">Vehicle</h2><div class="info-grid"><div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin)||'—'}</span></div><div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}</span></div></div></section><section class="doc-section adas-section"><h2 class="doc-section-title">ADAS Requirements</h2><ul class="adas-list">${adasList.map(s=>`<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')||'<li>No ADAS flagged.</li>'}</ul></section><div class="doc-footer"><p>CollisionIQ — Insurer Read-Only View — &copy; 2026 Cueljuris LLC</p></div></div>`;
  res.send(layout(`Insurer View — ${job.jobId}`, content));
});

// ─── Admin ────────────────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  const user = req.session.user;
  const shopId = user.role === 'platform_admin' ? null : user.shop_id;
  const jobs = shopId
    ? db.prepare('SELECT * FROM jobs WHERE shop_id=? ORDER BY createdAt DESC').all(shopId)
    : db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
  const statusOptions = ['Created','In Progress','Calibration Complete','Closed'];
  const rows = jobs.map(j => `<tr><td><span class="job-id">${escapeHtml(j.jobId)}</span></td><td>${escapeHtml(j.ro)||'—'}</td><td>${escapeHtml(j.year)} ${escapeHtml(j.make)} ${escapeHtml(j.model)}</td><td>${escapeHtml(j.technicianName)||'—'}</td><td><form method="POST" action="/jobs/${encodeURIComponent(j.jobId)}/status" class="inline-form"><select name="status" onchange="this.form.submit()" class="status-select">${statusOptions.map(s=>`<option value="${s}"${j.status===s?' selected':''}>${s}</option>`).join('')}</select></form></td><td>${formatDate(j.createdAt)}</td><td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td></tr>`).join('');
  const content = `<div class="page-header"><h1>Admin — Job Management <span class="count-badge">${jobs.length}</span></h1></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Job ID</th><th>RO #</th><th>Vehicle</th><th>Technician</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">No jobs.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Admin', content, 'admin', user));
});

app.post('/jobs/:jobId/status', requireAdmin, (req, res) => {
  const valid = ['Created','In Progress','Calibration Complete','Closed'];
  if (!valid.includes(req.body.status)) return res.status(400).send('Invalid status');
  db.prepare('UPDATE jobs SET status=?, updatedAt=?, last_changed=? WHERE jobId=?').run(req.body.status, new Date().toISOString(), new Date().toISOString(), req.params.jobId);
  res.redirect('/admin');
});

// ─── User Management ──────────────────────────────────────────────────────────
app.get('/admin/users', requireAdmin, (req, res) => {
  const user = req.session.user;
  const users = user.role === 'platform_admin'
    ? db.prepare('SELECT id,full_name,username,email,role,active,created_at FROM users ORDER BY created_at DESC').all()
    : db.prepare('SELECT id,full_name,username,email,role,active,created_at FROM users WHERE shop_id=? ORDER BY created_at DESC').all(user.shop_id);
  const roleOptions = ['shop_admin','qc_manager','technician','service_writer'];
  const rows = users.map(u => `<tr><td>${escapeHtml(u.full_name||'—')}</td><td class="mono">${escapeHtml(u.username)}</td><td>${escapeHtml(u.email||'—')}</td><td><span class="badge badge-blue">${escapeHtml(u.role)}</span></td><td><span class="badge badge-${u.active?'green':'gray'}">${u.active?'Active':'Inactive'}</span></td><td><form method="POST" action="/admin/users/${u.id}/role" style="display:inline"><select name="role" onchange="this.form.submit()">${roleOptions.map(r=>`<option value="${r}"${u.role===r?' selected':''}>${r}</option>`).join('')}</select></form>${u.active?`<form method="POST" action="/admin/users/${u.id}/deactivate" style="display:inline;margin-left:.5rem"><button class="btn btn-sm btn-ghost">Deactivate</button></form>`:''}</td></tr>`).join('');
  const content = `<div class="page-header"><h1>Users <span class="count-badge">${users.length}</span></h1></div>
    <div class="doc-section" style="margin-bottom:2rem"><h2 class="doc-section-title">Add New User</h2><form method="POST" action="/admin/users/create" style="display:grid;gap:1rem;max-width:520px"><div class="form-group"><label>Full Name</label><input type="text" name="full_name" required placeholder="Jane Smith"></div><div class="form-group"><label>Username</label><input type="text" name="username" required autocomplete="off"></div><div class="form-group"><label>Email</label><input type="email" name="email" placeholder="optional"></div><div class="form-group"><label>Temporary Password</label><input type="password" name="password" required autocomplete="new-password"></div><div class="form-group"><label>Role</label><select name="role">${roleOptions.map(r=>`<option value="${r}">${r}</option>`).join('')}</select></div><button type="submit" class="btn btn-primary">Create User</button></form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">No users.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Users', content, 'users', user));
});

app.post('/admin/users/create', requireAdmin, async (req, res) => {
  const { full_name, username, email, password, role } = req.body;
  const allowed = ['shop_admin','qc_manager','technician','service_writer'];
  if (!allowed.includes(role)) return res.status(400).send('Invalid role');
  try {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (shop_id,username,email,password_hash,role,full_name,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(req.session.user.shop_id, username, email||null, hash, role, full_name||'', new Date().toISOString());
  } catch(e) { return res.redirect('/admin/users?error=1'); }
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/role', requireAdmin, (req, res) => {
  const allowed = ['shop_admin','qc_manager','technician','service_writer'];
  if (!allowed.includes(req.body.role)) return res.status(400).send('Invalid role');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.params.id);
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/deactivate', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.redirect('/admin/users');
});

// ─── Platform Admin ───────────────────────────────────────────────────────────
app.get('/platform/shops', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
  const rows = shops.map(s => {
    const uc = db.prepare('SELECT COUNT(*) as c FROM users WHERE shop_id=?').get(s.id);
    const jc = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE shop_id=?').get(s.id);
    return `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.subscription_status||'inactive')}</td><td>${uc.c}</td><td>${jc.c}</td><td>${formatDate(s.created_at)}</td></tr>`;
  }).join('');
  const content = `<div class="page-header"><h1>Shops <span class="count-badge">${shops.length}</span></h1></div>
    <div class="doc-section" style="margin-bottom:2rem"><h2 class="doc-section-title">Onboard New Shop</h2><form method="POST" action="/platform/shops/create" style="display:grid;gap:1rem;max-width:520px"><div class="form-group"><label>Shop Name</label><input type="text" name="shop_name" required></div><div class="form-group"><label>Admin Full Name</label><input type="text" name="admin_full_name" required></div><div class="form-group"><label>Admin Username</label><input type="text" name="admin_username" required autocomplete="off"></div><div class="form-group"><label>Temporary Password</label><input type="password" name="admin_password" required autocomplete="new-password"></div><button type="submit" class="btn btn-primary">Create Shop</button></form></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Status</th><th>Users</th><th>Jobs</th><th>Created</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">No shops.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Shops', content, 'shops', req.session.user));
});

app.post('/platform/shops/create', requirePlatformAdmin, async (req, res) => {
  const { shop_name, admin_full_name, admin_username, admin_password } = req.body;
  if (!shop_name || !admin_username || !admin_password) return res.status(400).send('Missing required fields');
  const hash = await bcrypt.hash(admin_password, 10);
  const now = new Date().toISOString();
  const shopId = db.prepare('INSERT INTO shops (name,created_at) VALUES (?,?)').run(shop_name, now).lastInsertRowid;
  db.prepare('INSERT INTO users (shop_id,username,password_hash,role,full_name,created_at) VALUES (?,?,?,?,?,?)')
    .run(shopId, admin_username, hash, 'shop_admin', admin_full_name||'', now);
  res.redirect('/platform/shops');
});

app.get('/platform/billing', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY name ASC').all();
  const rows = shops.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.subscription_status||'inactive')}</td><td>${escapeHtml(s.stripe_customer_id||'—')}</td><td>${formatDate(s.created_at)}</td></tr>`).join('');
  const content = `<div class="page-header"><h1>Billing Overview</h1></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Shop</th><th>Status</th><th>Stripe Customer</th><th>Joined</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">No shops.</td></tr>'}</tbody></table></div>`;
  res.send(layout('Billing', content, 'billing', req.session.user));
});

// ─── ADAS Reference ───────────────────────────────────────────────────────────
app.get('/reference', requireAuth, (req, res) => {
  const makes = ['Toyota','Lexus','Ford','Lincoln','Chevrolet','GMC','Buick','Cadillac','Chrysler','Dodge','Ram','Jeep','Honda','Acura','Nissan','Infiniti','Kia','Hyundai','Genesis','Subaru','Mazda','Mercedes-Benz','Jaguar','Land Rover','Volvo','Tesla'];
  const makeOptions = makes.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  const years = []; for (let y=2026;y>=2010;y--) years.push(y);
  const yearOptions = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const content = `<div class="page-header"><h1>ADAS OEM Reference</h1></div>
    <div class="ref-lookup-card"><form method="GET" action="/reference/lookup" class="ref-form"><div class="ref-form-steps">
      <div class="ref-step"><div class="ref-step-label">Make</div><select name="make" required class="ref-select"><option value="">— Select —</option>${makeOptions}</select></div>
      <div class="ref-step"><div class="ref-step-label">Model</div><input type="text" name="model" placeholder="e.g. Camry" class="ref-input"></div>
      <div class="ref-step"><div class="ref-step-label">Year</div><select name="year" class="ref-select">${yearOptions}</select></div>
      <div class="ref-step"><button type="submit" class="btn btn-primary btn-lg">Look Up</button></div>
    </div></form></div>`;
  res.send(layout('ADAS Reference', content, 'reference', req.session.user));
});

app.get('/reference/lookup', requireAuth, (req, res) => {
  const { make, model, year } = req.query;
  if (!make) return res.redirect('/reference');
  const allRepairs = ['Windshield','Front Camera Area','Front Bumper','Rear Bumper','Radar','Wheel Alignment','Suspension','Door','Mirror','Airbag','SRS'];
  const full = runADASEngine(make, model, year, allRepairs);
  const adasList = full.adasSystems.split('\n').filter(Boolean);
  const content = `
    <div class="ref-back-bar no-print"><a href="/reference" class="btn btn-ghost">&larr; New Lookup</a></div>
    <div class="ref-card">
      <div class="ref-card-header"><div><div class="ref-card-brand">CollisionIQ — ADAS OEM Reference</div><div class="ref-card-vehicle">${escapeHtml([year,make,model].filter(Boolean).join(' '))}</div></div><div class="ref-card-actions no-print"><button onclick="window.print()" class="btn btn-white">&#128438; Print</button></div></div>
      <section class="ref-section"><h2 class="ref-section-title">Scan Requirements</h2>
        <div class="ref-scan-grid">
          <div class="ref-scan-item"><div>Pre-Repair Scan</div><span class="badge scan-badge scan-badge-${scanBadgeClass(full.preScanRequired)}">${escapeHtml(scanBadgeLabel(full.preScanRequired))}</span></div>
          <div class="ref-scan-item"><div>Post-Repair Scan</div><span class="badge scan-badge scan-badge-${scanBadgeClass(full.postScanRequired)}">${escapeHtml(scanBadgeLabel(full.postScanRequired))}</span></div>
        </div>
        <div class="ref-tool-row"><span class="ref-tool-label">&#128295; Approved Scan Tool</span><span class="ref-tool-value">${escapeHtml(full.approvedScanTool)}</span></div>
      </section>
      <section class="ref-section"><h2 class="ref-section-title">Calibration Requirements</h2><ul class="adas-list">${adasList.map(s=>`<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}</ul></section>
      <section class="ref-section"><h2 class="ref-section-title">Liability Notice</h2><div class="warning-box"><span class="warning-icon">&#9888;</span><p>${escapeHtml(full.liabilityWarning)}</p></div></section>
      <section class="ref-section no-print"><a href="/new?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model||'')}&year=${encodeURIComponent(year||'')}" class="btn btn-primary btn-lg">+ Start New Job — ${escapeHtml(make)}</a></section>
    </div>`;
  res.send(layout(`ADAS Reference — ${make}`, content, 'reference', req.session.user));
});

// ─── Seed Platform Admin ──────────────────────────────────────────────────────
async function seedPlatformAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role='platform_admin'").get();
  if (!existing) {
    const hash = await bcrypt.hash('changeme123', 10);
    db.prepare("INSERT INTO users (shop_id,username,password_hash,role,full_name,created_at) VALUES (NULL,'platform_admin',?,'platform_admin','Cueljuris LLC',?)")
      .run(hash, new Date().toISOString());
    console.log('Platform admin created. Username: platform_admin / Password: changeme123');
    console.log('CHANGE THIS PASSWORD IMMEDIATELY.');
  }
}

// ─── Seed Guest Account ───────────────────────────────────────────────────────
async function seedGuestAccount() {
  const existing = db.prepare("SELECT id FROM users WHERE username='guest'").get();
  if (!existing) {
    const guestPassword = process.env.GUEST_PASSWORD || 'guest2026';
    const hash = await bcrypt.hash(guestPassword, 10);

    // Create a guest shop if it doesn't exist
    let guestShop = db.prepare("SELECT id FROM shops WHERE name='Guest Shop'").get();
    if (!guestShop) {
      const result = db.prepare("INSERT INTO shops (name, subscription_status, created_at) VALUES ('Guest Shop', 'active', ?)")
        .run(new Date().toISOString());
      guestShop = { id: result.lastInsertRowid };
    }

    db.prepare("INSERT INTO users (shop_id,username,password_hash,role,full_name,active,created_at) VALUES (?,?,?,'guest','Guest User',1,?)")
      .run(guestShop.id, 'guest', hash, new Date().toISOString());

    console.log(`Guest account created. Username: guest / Password: ${guestPassword}`);
    console.log('Set GUEST_PASSWORD env var to change the guest password.');
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
Promise.all([seedPlatformAdmin(), seedGuestAccount()]).then(() => {
  app.listen(PORT, () => console.log(`CollisionIQ running on http://localhost:${PORT}`));
});
