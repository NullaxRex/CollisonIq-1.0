'use strict';

require('dotenv').config();

const express = require('express');
const { DatabaseSync: Database } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { runADASEngine } = require('./adasEngine');
const { generatePhotoLabels, ZONE_DISPLAY } = require('./utils/photoLabels');
const { updateJobPhotoStatus } = require('./utils/photoStatus');
const { requireActiveSubscription } = require('./middleware/billing');
const { webhook: billingWebhook, router: billingRouter } = require('./routes/billing');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Setup ───────────────────────────────────────────────────────────

const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId            TEXT UNIQUE,
    ro               TEXT,
    vin              TEXT,
    year             TEXT,
    make             TEXT,
    model            TEXT,
    trim             TEXT,
    technicianName   TEXT,
    repairsPerformed TEXT,
    adasSystems      TEXT,
    rationale        TEXT,
    liabilityWarning TEXT,
    makeSpecificNotes TEXT,
    status           TEXT DEFAULT 'Created',
    shareToken       TEXT,
    shareUrl         TEXT,
    createdAt        TEXT,
    updatedAt        TEXT
  )
`);

// Migration: add scan requirement and tool columns if not present
for (const col of ['preScanRequired', 'postScanRequired', 'approvedScanTool']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch (e) {}
}

// Step 1 — New column migrations
for (const col of ['track', 'collision_grade', 'mileage', 'service_date', 'assigned_tech', 'return_mileage', 'return_date', 'last_changed']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch (e) {}
}

// Step 1 — New tables
db.exec(`
  CREATE TABLE IF NOT EXISTS vin_flags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id         INTEGER NOT NULL,
    vin             TEXT NOT NULL,
    item_type       TEXT NOT NULL,
    sub_item        TEXT,
    grade           TEXT NOT NULL,
    origin_job_id   TEXT NOT NULL,
    date_flagged    TEXT NOT NULL,
    status          TEXT DEFAULT 'OPEN',
    resolved_job_id TEXT,
    date_resolved   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS grade_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         TEXT NOT NULL,
    shop_id        INTEGER NOT NULL,
    tech_name      TEXT NOT NULL,
    item_type      TEXT NOT NULL,
    sub_item       TEXT,
    grade          TEXT NOT NULL,
    previous_grade TEXT,
    timestamp      TEXT DEFAULT (datetime('now')),
    note           TEXT
  );

  CREATE TABLE IF NOT EXISTS job_service_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    item_type  TEXT NOT NULL,
    sub_item   TEXT,
    grade      TEXT,
    measurement TEXT,
    note       TEXT,
    tech_name  TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       TEXT NOT NULL,
    layer        INTEGER NOT NULL,
    category     TEXT NOT NULL,
    filename     TEXT NOT NULL,
    tech_name    TEXT,
    damage_grade TEXT,
    uploaded_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_checkpoints (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            TEXT NOT NULL,
    checkpoint_index  INTEGER NOT NULL,
    label             TEXT NOT NULL,
    completed         INTEGER DEFAULT 0,
    completed_by      TEXT,
    completed_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS share_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked    INTEGER DEFAULT 0
  );
`);

// Auth table migrations
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id)
    );
  `);
} catch (e) {}

for (const col of ['shop_id', 'created_by']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} INTEGER`); } catch (e) {}
}

// Photo label system
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_photos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id         TEXT    NOT NULL,
      shop_id        INTEGER NOT NULL,
      layer          INTEGER NOT NULL,
      zone           TEXT,
      label_key      TEXT    NOT NULL,
      label_display  TEXT    NOT NULL,
      is_recommended INTEGER DEFAULT 0,
      is_adas        INTEGER DEFAULT 0,
      file_path      TEXT,
      mime_type      TEXT,
      file_size_kb   INTEGER,
      tech_name      TEXT,
      uploaded_at    TEXT    DEFAULT (datetime('now')),
      notes          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_job_photos_job  ON job_photos(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_photos_zone ON job_photos(job_id, zone);
  `);
} catch (e) {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN impact_areas TEXT`); } catch (e) {}

// ─── Stripe Billing Schema ────────────────────────────────────────────────────
require('./db/migrations/002_stripe_billing').runMigration(db);
require('./db/migrations/003_photo_softlock_edit_assign').runMigration(db);

// Additional columns required by registration flow
for (const col of ['city TEXT', 'state TEXT']) {
  try { db.exec(`ALTER TABLE shops ADD COLUMN ${col}`); } catch (e) {}
}
try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch (e) {}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Stripe webhook — raw body required, must be BEFORE express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Service worker must be served with no-cache headers (before static middleware)
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './' }),
  secret: process.env.SESSION_SECRET || 'collisioniq-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Billing + registration routes (public — no auth required)
app.use('/', require('./routes/register'));
app.use('/', billingRouter);

// Uploads directory (photo storage)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 10 * 1024 * 1024 } });
// /uploads is no longer publicly served — photos are served via auth-gated route below

const DEFAULT_SHOP_ID = 1; // fallback for contexts without req

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  if (role !== 'shop_admin' && role !== 'platform_admin') {
    return res.status(403).send('Access denied.');
  }
  next();
}

function requireCreate(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  if (['platform_admin', 'shop_admin', 'service_writer'].includes(role)) return next();
  return res.status(403).send('Access denied.');
}

function requirePlatformAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'platform_admin') {
    return res.status(403).send('Access denied.');
  }
  next();
}

function requireQC(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  const allowed = ['platform_admin', 'shop_admin', 'qc_manager'];
  if (!allowed.includes(role)) return res.status(403).send('Access denied.');
  next();
}

function shopScope(req, res, next) {
  if (req.session.user.role === 'platform_admin') {
    // Platform admin uses voluntary shop filter (from shop switcher), never hard-restricted
    req.shopId = req.session.shopFilter || null;
  } else {
    req.shopId = req.session.user.shop_id;
  }
  next();
}

// Allows service_writer, shop_admin, and platform_admin to edit job fields
function requireEdit(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  const role = req.session.user.role;
  if (['platform_admin', 'shop_admin', 'service_writer'].includes(role)) return next();
  return res.status(403).send('Access denied.');
}

// Session flash helpers
function setFlash(req, type, msg) { req.session.flash = { type, msg }; }
function consumeFlash(req) { const f = req.session.flash || null; delete req.session.flash; return f; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateJobId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `CIQ-${date}-${rand}`;
}

function statusClass(status) {
  switch (status) {
    case 'Created':              return 'blue';
    case 'In Progress':          return 'orange';
    case 'Calibration Complete': return 'green';
    case 'Closed':               return 'gray';
    default:                     return 'blue';
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function scanBadgeClass(status) {
  const s = (status || '').toUpperCase();
  if (s.startsWith('REQUIRED'))              return 'red';
  if (s.startsWith('STRONGLY RECOMMENDED') ||
      s.startsWith('HIGHLY RECOMMENDED') ||
      s.startsWith('IMPERATIVE'))            return 'amber';
  return 'blue';  // RECOMMENDED and fallback
}

// Extract just the lead keyword for the compact badge label
function scanBadgeLabel(status) {
  const s = (status || '').toUpperCase();
  if (s.startsWith('REQUIRED'))              return 'REQUIRED';
  if (s.startsWith('STRONGLY RECOMMENDED'))  return 'STRONGLY RECOMMENDED';
  if (s.startsWith('HIGHLY RECOMMENDED'))    return 'HIGHLY RECOMMENDED';
  if (s.startsWith('IMPERATIVE'))            return 'IMPERATIVE';
  return 'RECOMMENDED';
}

// ─── Grade / Flag Helpers ─────────────────────────────────────────────────────

// Checkpoint labels for MODERATE collision jobs
const CHECKPOINT_LABELS = [
  'Pre-repair scan complete — DTCs documented',
  'Structural repair complete — frame inspection signed off',
  'Panel replacement complete — ADAS sensor mounting points inspected',
  'ADAS calibration setup — targets placed, tool connected',
  'Calibration performed — readings documented',
  'Post-repair scan complete — no ADAS-related DTCs remaining',
  'Road test / dynamic verification complete',
  'QC Manager final sign-off',
];

/**
 * Save a graded service item, write audit trail, and apply flag logic.
 * grade must be 'GREEN', 'YELLOW', or 'RED' (or empty/null to skip flag logic).
 */
function applyGradeFlag(vin, shopId, jobId, techName, itemType, subItem, grade, prevGrade, measurement, note) {
  const now = new Date().toISOString();
  const sub = subItem || null;

  // 1. Save service item
  db.prepare(`
    INSERT INTO job_service_items (job_id, item_type, sub_item, grade, measurement, note, tech_name, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(jobId, itemType, sub, grade || null, measurement || null, note || null, techName, now);

  // 2. Audit trail
  db.prepare(`
    INSERT INTO grade_audit (job_id, shop_id, tech_name, item_type, sub_item, grade, previous_grade, timestamp, note)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(jobId, shopId, techName, itemType, sub, grade || '', prevGrade || null, now, note || null);

  if (!grade || !vin) return;

  const findOpen = db.prepare(`
    SELECT id, grade FROM vin_flags
    WHERE vin=? AND shop_id=? AND item_type=?
      AND (sub_item IS ? OR sub_item = ?)
      AND status IN ('OPEN','ESCALATED')
    ORDER BY id DESC LIMIT 1
  `);

  if (grade === 'GREEN') {
    const existing = findOpen.get(vin, shopId, itemType, sub, sub);
    if (existing) {
      db.prepare(`UPDATE vin_flags SET status='RESOLVED', resolved_job_id=?, date_resolved=? WHERE id=?`)
        .run(jobId, now.slice(0, 10), existing.id);
    }
  } else if (grade === 'YELLOW') {
    db.prepare(`
      INSERT INTO vin_flags (shop_id, vin, item_type, sub_item, grade, origin_job_id, date_flagged)
      VALUES (?,?,?,?,?,?,?)
    `).run(shopId, vin, itemType, sub, 'YELLOW', jobId, now.slice(0, 10));
  } else if (grade === 'RED') {
    const existing = findOpen.get(vin, shopId, itemType, sub, sub);
    if (existing && existing.grade === 'YELLOW') {
      db.prepare(`UPDATE vin_flags SET status='ESCALATED' WHERE id=?`).run(existing.id);
    }
    db.prepare(`
      INSERT INTO vin_flags (shop_id, vin, item_type, sub_item, grade, origin_job_id, date_flagged)
      VALUES (?,?,?,?,?,?,?)
    `).run(shopId, vin, itemType, sub, 'RED', jobId, now.slice(0, 10));
  }
}

/** Photo placeholder card (used in /new collision form) */
function photoPlaceholderCard(label, required, hint) {
  const badge = required
    ? '<span class="photo-badge photo-badge-required">REQUIRED</span>'
    : '<span class="photo-badge photo-badge-optional">OPTIONAL</span>';
  return `
    <div class="photo-placeholder-card" onclick="alert('Photo upload coming soon')">
      ${badge}
      <svg class="photo-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="#AAAAAA" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      <div class="photo-placeholder-label">${escapeHtml(label)}</div>
      <div class="photo-placeholder-hint">${escapeHtml(hint)}</div>
    </div>`;
}

/** Server-side grade button HTML (used in tech view form) */
function gradeButtonHtml(fieldId, currentGrade) {
  const g = currentGrade || '';
  return `<input type="hidden" name="${escapeHtml(fieldId)}" id="${escapeHtml(fieldId)}" value="${escapeHtml(g)}">
    <div class="grade-btn-row" data-target="${escapeHtml(fieldId)}">
      <button type="button" class="grade-btn grade-green${g === 'GREEN' ? ' selected' : ''}" data-grade="GREEN">GREEN</button>
      <button type="button" class="grade-btn grade-yellow${g === 'YELLOW' ? ' selected' : ''}" data-grade="YELLOW">YELLOW</button>
      <button type="button" class="grade-btn grade-red${g === 'RED' ? ' selected' : ''}" data-grade="RED">RED</button>
    </div>`;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function layout(title, content, activeNav = '', user = null, shopFilter = null) {
  const nav = (href, key, label) =>
    `<a href="${href}" class="${activeNav === key ? 'active' : ''}">${label}</a>`;

  const role = user ? user.role : null;
  let navLinks = '';

  if (role === 'platform_admin') {
    // Shop switcher dropdown
    const shops = db.prepare('SELECT id, name FROM shops ORDER BY name').all();
    const shopOptions = [
      `<option value=""${!shopFilter ? ' selected' : ''}>All Shops</option>`,
      ...shops.map(s => `<option value="${s.id}"${String(shopFilter) === String(s.id) ? ' selected' : ''}>${escapeHtml(s.name)}</option>`),
    ].join('');
    const shopSwitcher = `
        <form method="POST" action="/platform/shop-filter" style="display:inline;margin-left:0.5rem">
          <select name="shop_id" onchange="this.form.submit()" class="shop-switcher-select">
            ${shopOptions}
          </select>
        </form>`;
    navLinks = `
        ${nav('/', 'list', 'Jobs')}
        ${nav('/new', 'new', 'New Job')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        ${nav('/admin', 'admin', 'Admin')}
        ${nav('/platform/shops', 'shops', 'Shops')}
        ${nav('/platform/billing', 'billing', 'Billing')}
        ${nav('/dashboard/flags', 'flags', 'Flag Dashboard')}
        ${nav('/platform/demo-credentials', 'demo', 'Demo Credentials')}
        ${shopSwitcher}
        <a href="/logout">Logout</a>`;
  } else if (role === 'shop_admin') {
    navLinks = `
        ${nav('/', 'list', 'Jobs')}
        ${nav('/new', 'new', 'New Job')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        ${nav('/admin', 'admin', 'Admin')}
        ${nav('/admin/users', 'users', 'Users')}
        ${nav('/dashboard/flags', 'flags', 'Flag Dashboard')}
        <a href="/logout">Logout</a>`;
  } else if (role === 'qc_manager') {
    navLinks = `
        ${nav('/', 'list', 'Jobs')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        ${nav('/dashboard/flags', 'flags', 'Flag Dashboard')}
        <a href="/logout">Logout</a>`;
  } else if (role === 'technician') {
    navLinks = `
        ${nav('/', 'list', 'My Jobs')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        <a href="/logout">Logout</a>`;
  } else if (role === 'service_writer') {
    navLinks = `
        ${nav('/', 'list', 'Jobs')}
        ${nav('/reference', 'reference', 'ADAS Reference')}
        <a href="/logout">Logout</a>`;
  }

  const userDisplay = user
    ? `<span class="nav-user">${escapeHtml(user.full_name || user.username)}&nbsp;<span class="nav-role">[${escapeHtml(user.role)}]</span></span>`
    : '';

  const adminBanner = role === 'platform_admin'
    ? `<div style="background:#1B3A6B;color:#fff;text-align:center;padding:6px 12px;font-size:13px;font-family:Arial,sans-serif;letter-spacing:0.5px">&#9881; PLATFORM ADMIN &mdash; MASTER ACCESS &mdash; CUELJURIS LLC${shopFilter ? ` &mdash; VIEWING: ${escapeHtml(db.prepare('SELECT name FROM shops WHERE id=?').get(shopFilter)?.name || '')}` : ''}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — CollisionIQ</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1B3A6B">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="CollisionIQ">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
</head>
<body>
  ${adminBanner}
  <header class="site-header">
    <div class="header-inner">
      <div class="brand">
        <a href="/" class="brand-logo">CollisionIQ</a>
        <span class="brand-tagline">ADAS Calibration Documentation Platform</span>
      </div>
      <nav class="main-nav">
        ${navLinks}
        ${userDisplay}
      </nav>
    </div>
  </header>

  <main class="main-content">
    ${content}
  </main>

  <footer class="site-footer">
    <p>&copy; 2026 Cueljuris LLC &mdash; CollisionIQ Platform</p>
  </footer>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js')
          .then(function (reg) { console.log('CollisionIQ SW registered:', reg.scope); })
          .catch(function (err) { console.log('CollisionIQ SW registration failed:', err); });
      });
    }
  </script>
</body>
</html>`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /login
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const error = req.query.error || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — CollisionIQ</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    .login-wrap { display:flex; justify-content:center; align-items:center; min-height:80vh; }
    .login-card { background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:2.5rem 2rem; width:100%; max-width:380px; box-shadow:0 2px 12px rgba(0,0,0,.07); }
    .login-logo  { font-size:1.5rem; font-weight:700; color:#1a1a2e; margin-bottom:0.25rem; }
    .login-sub   { font-size:0.85rem; color:#666; margin-bottom:2rem; }
    .login-error { background:#fef2f2; border:1px solid #fca5a5; color:#b91c1c; border-radius:4px; padding:0.6rem 0.8rem; margin-bottom:1rem; font-size:0.875rem; }
    .login-card .form-group { margin-bottom:1rem; }
    .login-card label { display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.3rem; color:#444; }
    .login-card input[type=text],
    .login-card input[type=password] { width:100%; box-sizing:border-box; padding:0.55rem 0.75rem; border:1px solid #ccc; border-radius:4px; font-size:0.95rem; }
    .login-btn { width:100%; padding:0.65rem; background:#1a1a2e; color:#fff; border:none; border-radius:4px; font-size:1rem; font-weight:600; cursor:pointer; margin-top:0.5rem; }
    .login-btn:hover { background:#2d2d4e; }
    .login-footer-note { text-align:center; font-size:0.75rem; color:#999; margin-top:1.5rem; }
  </style>
</head>
<body>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">CollisionIQ</div>
      <div class="login-sub">ADAS Calibration Documentation Platform</div>
      ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/login">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" autocomplete="username" required autofocus>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required>
        </div>
        <button type="submit" class="login-btn">Sign In</button>
      </form>
      <div style="text-align:center;margin-top:1.25rem;font-size:.85rem;color:#666">
        New shop? <a href="/register" style="color:#1B3A6B;font-weight:600">Create an account</a>
      </div>
      <div class="login-footer-note">&copy; 2026 Cueljuris LLC</div>
    </div>
  </div>
</body>
</html>`);
});

// POST /login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.redirect('/login?error=' + encodeURIComponent('Username and password are required.'));
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) {
    return res.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    shop_id: user.shop_id,
  };
  res.redirect('/');
});

// GET /logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// GET / — Jobs list
app.get('/', requireAuth, shopScope, (req, res) => {
  const flash  = consumeFlash(req);
  const search = (req.query.search || '').trim();
  const user = req.session.user;
  const isTech = user.role === 'technician';

  // ── Sort preference (session-persisted) ──────────────────────────────────
  const sortMap = {
    id: 'id', ronumber: 'ro', make: 'make', track: 'track',
    status: 'status', last_changed: 'last_changed', created_at: 'createdAt'
  };
  if (req.query.sort && sortMap[req.query.sort]) {
    req.session.jobSort = { sort: req.query.sort, dir: req.query.dir === 'asc' ? 'asc' : 'desc' };
  }
  const sortKey = (req.query.sort && sortMap[req.query.sort])
    ? req.query.sort
    : (req.session.jobSort && sortMap[req.session.jobSort.sort] ? req.session.jobSort.sort : 'last_changed');
  const sortDir = (req.query.sort
    ? (req.query.dir === 'asc' ? 'asc' : 'desc')
    : (req.session.jobSort ? req.session.jobSort.dir : 'desc'));
  const orderCol = sortMap[sortKey];
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  // ── Query ────────────────────────────────────────────────────────────────
  let jobs;
  if (search) {
    const q = `%${search}%`;
    if (req.shopId) {
      if (isTech) {
        jobs = db.prepare(`SELECT * FROM jobs WHERE shop_id=? AND (assigned_tech=? OR technicianName=?) AND (ro LIKE ? OR vin LIKE ? OR technicianName LIKE ?) ORDER BY ${orderCol} ${orderDir}`)
          .all(req.shopId, user.full_name, user.full_name, q, q, q);
      } else {
        jobs = db.prepare(`SELECT * FROM jobs WHERE shop_id=? AND (ro LIKE ? OR vin LIKE ? OR technicianName LIKE ?) ORDER BY ${orderCol} ${orderDir}`)
          .all(req.shopId, q, q, q);
      }
    } else {
      jobs = db.prepare(`SELECT * FROM jobs WHERE ro LIKE ? OR vin LIKE ? OR technicianName LIKE ? ORDER BY ${orderCol} ${orderDir}`)
        .all(q, q, q);
    }
  } else {
    if (req.shopId) {
      if (isTech) {
        jobs = db.prepare(`SELECT * FROM jobs WHERE shop_id=? AND (assigned_tech=? OR technicianName=?) ORDER BY ${orderCol} ${orderDir}`)
          .all(req.shopId, user.full_name, user.full_name);
      } else {
        jobs = db.prepare(`SELECT * FROM jobs WHERE shop_id=? ORDER BY ${orderCol} ${orderDir}`).all(req.shopId);
      }
    } else {
      jobs = db.prepare(`SELECT * FROM jobs ORDER BY ${orderCol} ${orderDir}`).all();
    }
  }

  const canCreate = ['platform_admin', 'shop_admin', 'service_writer'].includes(user.role);

  // ── Batch assignment query ────────────────────────────────────────────────
  const jobIds = jobs.map(j => j.jobId);
  const assignmentMap = {};
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(',');
    const assignRows = db.prepare(`
      SELECT ja.job_id, u.full_name
      FROM job_assignments ja
      JOIN users u ON u.id = ja.user_id
      WHERE ja.job_id IN (${placeholders})
      ORDER BY ja.assigned_at
    `).all(...jobIds);
    for (const row of assignRows) {
      if (!assignmentMap[row.job_id]) assignmentMap[row.job_id] = [];
      assignmentMap[row.job_id].push(row.full_name);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function timeAgo(dateStr) {
    if (!dateStr) return '—';
    const now = new Date();
    const then = new Date(dateStr);
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60)    return 'Just now';
    if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function sortHeader(label, column) {
    const isActive = sortKey === column;
    const nextDir = isActive && sortDir === 'asc' ? 'desc' : 'asc';
    const arrow = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
    const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
    return `<a href="/?sort=${column}&dir=${nextDir}${searchParam}" style="text-decoration:none;color:${isActive ? '#1B3A6B' : '#555555'};font-weight:${isActive ? 'bold' : 'normal'};white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(label)}<span style="font-size:11px;opacity:0.7">${arrow}</span></a>`;
  }

  function trackBadge(track) {
    if (!track) return '<span style="color:#999">—</span>';
    const isGM = track === 'general-maintenance';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;background:${isGM ? '#F0F0F0' : '#E8EEF7'};color:${isGM ? '#555555' : '#1B3A6B'}">${isGM ? 'General Maintenance' : 'Post-Collision'}</span>`;
  }

  function statusBadge(status) {
    const styles = {
      'Created':           { bg: '#F0F0F0', fg: '#555555' },
      'In Progress':       { bg: '#E8EEF7', fg: '#1B3A6B' },
      'Pending Insurance': { bg: '#FFF9CC', fg: '#7A6000' },
      'Complete':          { bg: '#D6F0D6', fg: '#1A6B1A' },
      'Total Loss':        { bg: '#FFD6D6', fg: '#8B0000' },
      'Calibration Complete': { bg: '#D6F0D6', fg: '#1A6B1A' },
      'Closed':            { bg: '#F0F0F0', fg: '#555555' },
    };
    const s = styles[status] || { bg: '#E8EEF7', fg: '#1B3A6B' };
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;background:${s.bg};color:${s.fg}">${escapeHtml(status || '—')}</span>`;
  }

  function photoStatusBadge(ps, isCollision) {
    if (!isCollision) return '<span style="color:#999">—</span>';
    const cfg = { green: ['#D6F0D6','#1A6B1A'], yellow: ['#FFF9CC','#7A6000'], red: ['#FFD6D6','#8B0000'] };
    const [bg, fg] = cfg[ps] || cfg.red;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;background:${bg};color:${fg}">${(ps||'red').toUpperCase()}</span>`;
  }

  function initialsStack(names) {
    if (!names || names.length === 0) return '<span style="color:#999">—</span>';
    const shown    = names.slice(0, 3);
    const overflow = names.length - 3;
    let html = shown.map(n => {
      const parts    = (n || '').trim().split(/\s+/);
      const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?')[0];
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#1B3A6B;color:#fff;font-size:10px;font-weight:700;margin-right:2px" title="${escapeHtml(n)}">${escapeHtml(initials.toUpperCase())}</span>`;
    }).join('');
    if (overflow > 0) html += `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#888;color:#fff;font-size:10px;font-weight:700">+${overflow}</span>`;
    return html;
  }

  // ── Table rows ───────────────────────────────────────────────────────────
  const rows = jobs.map(j => `
    <tr>
      <td><a href="/jobs/${encodeURIComponent(j.jobId)}" style="font-family:monospace;font-weight:600;color:#1B3A6B;text-decoration:none">${escapeHtml(j.jobId)}</a></td>
      <td>${escapeHtml(j.ro) || '&mdash;'}</td>
      <td>${[j.year, j.make, j.model].filter(Boolean).map(escapeHtml).join(' ') || '&mdash;'}</td>
      <td>${trackBadge(j.track)}</td>
      <td>${statusBadge(j.status)}</td>
      <td>${photoStatusBadge(j.photo_status, j.track !== 'general-maintenance')}</td>
      <td>${initialsStack(assignmentMap[j.jobId])}</td>
      <td><span title="${escapeHtml(j.last_changed || '')}">${timeAgo(j.last_changed)}</span></td>
      <td>${formatDate(j.createdAt)}</td>
      <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
    </tr>`).join('');

  // ── Mobile cards ─────────────────────────────────────────────────────────
  const cards = jobs.map(j => `
    <a href="/jobs/${encodeURIComponent(j.jobId)}" class="job-card-link">
      <div class="job-card">
        <div class="job-card-badges">${trackBadge(j.track)}&nbsp;${statusBadge(j.status)}</div>
        <div class="job-card-title">${escapeHtml(j.jobId)}${j.ro ? ` &mdash; RO #${escapeHtml(j.ro)}` : ''}</div>
        <div class="job-card-vehicle">${[j.year, j.make, j.model].filter(Boolean).map(escapeHtml).join(' ') || '&mdash;'}</div>
        <div class="job-card-time">Last changed: <span title="${escapeHtml(j.last_changed || '')}">${timeAgo(j.last_changed)}</span></div>
      </div>
    </a>`).join('');

  const content = `
    <style>
      .jobs-table { display: table; width: 100%; }
      .jobs-cards { display: none; }
      @media (max-width: 768px) {
        .jobs-table { display: none; }
        .jobs-cards { display: block; }
      }
      .job-card-link { text-decoration: none; color: inherit; display: block; }
      .job-card {
        background: #fff;
        border: 1px solid #e0e4ea;
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 10px;
      }
      .job-card-badges { margin-bottom: 6px; }
      .job-card-title { font-weight: 700; font-size: 14px; color: #1B3A6B; margin-bottom: 2px; }
      .job-card-vehicle { font-size: 13px; color: #333; margin-bottom: 4px; }
      .job-card-time { font-size: 12px; color: #888; }
    </style>

    ${flash ? `<div style="background:${flash.type === 'success' ? '#D6F0D6' : '#FFD6D6'};color:${flash.type === 'success' ? '#1A6B1A' : '#8B0000'};padding:.65rem 1rem;border-radius:6px;margin-bottom:1rem;font-size:.9rem">${escapeHtml(flash.msg)}</div>` : ''}

    <div class="page-header">
      <h1>${isTech ? 'My Jobs' : 'Jobs'} <span class="count-badge">${jobs.length}</span></h1>
      ${canCreate ? '<a href="/new" class="btn btn-primary">+ New Job</a>' : ''}
    </div>

    <div class="search-bar">
      <form method="GET" action="/">
        <input type="text" name="search" placeholder="Search by RO#, VIN, or Technician name&hellip;"
               value="${escapeHtml(search)}">
        ${sortKey !== 'last_changed' || sortDir !== 'desc' ? `<input type="hidden" name="sort" value="${escapeHtml(sortKey)}"><input type="hidden" name="dir" value="${escapeHtml(sortDir)}">` : ''}
        <button type="submit" class="btn">Search</button>
        ${search ? `<a href="/?sort=${escapeHtml(sortKey)}&dir=${escapeHtml(sortDir)}" class="btn btn-ghost">Clear</a>` : ''}
      </form>
    </div>

    <div class="table-wrap jobs-table">
      <table class="data-table">
        <thead>
          <tr>
            <th>${sortHeader('Job ID', 'id')}</th>
            <th>${sortHeader('RO Number', 'ronumber')}</th>
            <th>${sortHeader('Vehicle', 'make')}</th>
            <th>${sortHeader('Track', 'track')}</th>
            <th>${sortHeader('Status', 'status')}</th>
            <th>Photos</th>
            <th>Team</th>
            <th>${sortHeader('Last Changed', 'last_changed')}</th>
            <th>${sortHeader('Date Created', 'created_at')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="10" class="empty">No jobs found.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="jobs-cards">
      ${cards.length > 0 ? cards : '<p class="empty">No jobs found.</p>'}
    </div>`;

  res.send(layout('Jobs', content, 'list', user, req.session.shopFilter));
});

// GET /new — New job form (track selector → GM or Collision)
app.get('/new', requireAuth, requireCreate, (req, res) => {
  const prefill = {
    make:  req.query.make  || '',
    model: req.query.model || '',
    year:  req.query.year  || '',
  };

  const repairOptions = [
    'Windshield',
    'Front Camera Area',
    'Front Bumper',
    'Rear Bumper',
    'Radar',
    'Structural Body Repair',
    'Airbag / SRS Deployment',
    'Rear Structural',
    'Wheel Alignment',
    'Suspension',
    'Door / Mirror Repair',
    'EV / Hybrid Vehicle',
    'Other',
  ];

  const checkboxes = repairOptions.map(r => `
    <label class="checkbox-label">
      <input type="checkbox" name="repairs" value="${escapeHtml(r)}">
      <span>${escapeHtml(r)}</span>
    </label>`).join('');

  const impactAreaOptions = [
    ['front_end',      'Front End'],
    ['rear_end',       'Rear End'],
    ['driver_side',    'Driver Side'],
    ['passenger_side', 'Passenger Side'],
    ['roof',           'Roof / Rollover'],
    ['undercarriage',  'Undercarriage'],
  ];
  const impactAreaCheckboxes = impactAreaOptions.map(([val, label]) => `
    <label class="checkbox-label">
      <input type="checkbox" name="impact_areas" value="${val}">
      <span>${escapeHtml(label)}</span>
    </label>`).join('');

  const today = new Date().toISOString().slice(0, 10);

  // Sub-item rows for brakes/tires/wipers
  const brakePositions = [['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr']];
  const tirePositions  = [['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr']];
  const wiperPositions = [['Driver Side','driver'],['Passenger Side','passenger'],['Rear (optional)','rear']];

  const brakeSubItems = brakePositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="brake_${code}_grade" id="brake_${code}_grade" value="">
      <div class="grade-btn-row" data-target="brake_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
      <input type="text" name="brake_${code}_measurement" placeholder="mm" class="measurement-input">
    </div>`).join('');

  const tireSubItems = tirePositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="tire_${code}_grade" id="tire_${code}_grade" value="">
      <div class="grade-btn-row" data-target="tire_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
      <input type="text" name="tire_${code}_depth" placeholder="32nds" class="measurement-input">
    </div>`).join('');

  const wiperSubItems = wiperPositions.map(([label, code]) => `
    <div class="sub-item-row">
      <span class="sub-item-label">${label}</span>
      <input type="hidden" name="wiper_${code}_grade" id="wiper_${code}_grade" value="">
      <div class="grade-btn-row" data-target="wiper_${code}_grade">
        <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
        <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
        <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
      </div>
    </div>`).join('');

  const content = `
    <div class="page-header"><h1>New Job</h1></div>

    <!-- VIN Flag Warning Panel (populated via JS on VIN blur) -->
    <div id="vin-flags-panel" class="vin-flag-panel hidden" role="alert"></div>

    <!-- Change track bar (shown after a track is selected) -->
    <div id="changeTrackBar" class="change-track-bar hidden">
      <button type="button" onclick="changeTrack()" class="btn btn-ghost btn-sm">
        &larr; Change job type
      </button>
    </div>

    <!-- ── STEP 2: TRACK SELECTOR ───────────────────────────────────────────── -->
    <div class="track-selector" id="trackSelector">
      <p class="track-selector-label">Select job type to continue</p>
      <div class="track-btn-row">
        <button type="button" class="track-btn" id="btn-gm"
                onclick="selectTrack('general-maintenance')">
          <span class="track-btn-icon">&#9881;</span>
          <span class="track-btn-title">GENERAL MAINTENANCE</span>
          <span class="track-btn-sub">Oil change, brakes, tires, service inspection</span>
        </button>
        <button type="button" class="track-btn" id="btn-collision"
                onclick="selectTrack('post-collision')">
          <span class="track-btn-icon">&#9888;</span>
          <span class="track-btn-title">POST-COLLISION REPAIR</span>
          <span class="track-btn-sub">ADAS calibration, structural repair, insurance documentation</span>
        </button>
      </div>
    </div>

    <!-- ── TRACK 1: GENERAL MAINTENANCE FORM ────────────────────────────────── -->
    <form method="POST" action="/jobs" id="gm-form" class="track-form job-form hidden">
      <input type="hidden" name="track" value="general-maintenance">

      <div class="form-section">
        <h2 class="section-heading">Vehicle &amp; Job Information</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="gm-ro">RO Number <span class="req">*</span></label>
            <input type="text" id="gm-ro" name="ro" placeholder="e.g. RO-12345" required>
          </div>
          <div class="form-group">
            <label for="gm-vin">VIN</label>
            <div style="display:flex;gap:0.5rem;align-items:flex-start">
              <div style="flex:1">
                <input type="text" id="gm-vin" name="vin" placeholder="17-character VIN" maxlength="17"
                       style="text-transform:uppercase;width:100%;box-sizing:border-box" autocomplete="off">
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                <button type="button" id="gm-gen-vin" class="btn btn-ghost" style="white-space:nowrap;font-size:0.8rem">Generate Test VIN</button>
                <span style="font-size:0.7rem;color:#999;text-align:center">For testing only — not a real vehicle record</span>
              </div>
            </div>
            <span class="field-hint" id="gm-vin-status"></span>
            <span class="field-hint" id="gm-vin-test-label" style="color:#999"></span>
          </div>
          <div class="form-group">
            <label for="gm-year">Year</label>
            <input type="text" id="gm-year" name="year" placeholder="e.g. 2022" maxlength="4">
          </div>
          <div class="form-group">
            <label for="gm-make">Make</label>
            <input type="text" id="gm-make" name="make" placeholder="e.g. Honda">
          </div>
          <div class="form-group">
            <label for="gm-model">Model</label>
            <input type="text" id="gm-model" name="model" placeholder="e.g. Accord">
          </div>
          <div class="form-group">
            <label for="gm-trim">Trim</label>
            <input type="text" id="gm-trim" name="trim" placeholder="e.g. Sport">
          </div>
          <div class="form-group">
            <label for="gm-service-date">Date of Service</label>
            <input type="date" id="gm-service-date" name="service_date" value="${today}">
          </div>
          <div class="form-group">
            <label for="gm-mileage">Mileage at Service</label>
            <input type="number" id="gm-mileage" name="mileage" placeholder="e.g. 47250" min="0">
          </div>
          <div class="form-group">
            <label for="gm-tech">Assigned Technician <span class="req">*</span></label>
            <input type="text" id="gm-tech" name="assigned_tech" placeholder="Full name" required>
          </div>
          <div class="form-group form-group-full">
            <label for="gm-notes">Notes</label>
            <textarea id="gm-notes" name="notes" rows="2"
                      placeholder="General notes for this visit..."></textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <h2 class="section-heading">Service Items</h2>
        <p class="section-hint">Check each service item performed or inspected during this visit.</p>

        <!-- OIL CHANGE -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="oil_change_enabled" value="1"
                   class="module-checkbox" id="oil-toggle">
            <span class="module-toggle-label">Oil Change</span>
          </label>
          <div class="module-body hidden" id="oil-body">
            <div class="form-grid">
              <div class="form-group">
                <label>Oil Type</label>
                <select name="oil_type">
                  <option value="">— Select —</option>
                  <option value="conventional">Conventional</option>
                  <option value="synthetic-blend">Synthetic Blend</option>
                  <option value="full-synthetic">Full Synthetic</option>
                  <option value="diesel">Diesel</option>
                </select>
              </div>
              <div class="form-group">
                <label>Viscosity</label>
                <input type="text" name="oil_viscosity" placeholder="e.g. 5W-30">
              </div>
              <div class="form-group">
                <label>Return Interval — Miles</label>
                <input type="number" name="oil_return_miles" id="oil-return-miles"
                       placeholder="e.g. 5000" min="0" oninput="calcOilReturn()">
              </div>
              <div class="form-group">
                <label>Return Interval — Months</label>
                <input type="number" name="oil_return_months" id="oil-return-months"
                       placeholder="e.g. 6" min="0" oninput="calcOilReturn()">
              </div>
              <div class="form-group">
                <label>Return Mileage (auto-calculated)</label>
                <input type="text" name="return_mileage" id="oil-return-mileage-display"
                       readonly placeholder="Auto-calculated" class="field-readonly">
              </div>
              <div class="form-group">
                <label>Return Date (auto-calculated)</label>
                <input type="text" name="return_date" id="oil-return-date-display"
                       readonly placeholder="Auto-calculated" class="field-readonly">
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="oil_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- BRAKES -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="brakes_enabled" value="1"
                   class="module-checkbox" id="brakes-toggle">
            <span class="module-toggle-label">Brakes</span>
          </label>
          <div class="module-body hidden" id="brakes-body">
            <div class="service-sub-items">${brakeSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Front Rotor Condition</label>
                <select name="brake_rotor_front">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="grooved">Grooved</option>
                  <option value="needs-replacement">Needs Replacement</option>
                </select>
              </div>
              <div class="form-group">
                <label>Rear Rotor Condition</label>
                <select name="brake_rotor_rear">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="grooved">Grooved</option>
                  <option value="needs-replacement">Needs Replacement</option>
                </select>
              </div>
              <div class="form-group">
                <label>Brake Fluid</label>
                <select name="brake_fluid">
                  <option value="">— Select —</option>
                  <option value="good">Good</option>
                  <option value="contaminated">Contaminated</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="brake_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- TIRES -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="tires_enabled" value="1"
                   class="module-checkbox" id="tires-toggle">
            <span class="module-toggle-label">Tires</span>
          </label>
          <div class="module-body hidden" id="tires-body">
            <div class="service-sub-items">${tireSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Rotation Performed</label>
                <select name="tire_rotation">
                  <option value="">— Select —</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="tire_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- WINDSHIELD WIPERS -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="wipers_enabled" value="1"
                   class="module-checkbox" id="wipers-toggle">
            <span class="module-toggle-label">Windshield Wipers</span>
          </label>
          <div class="module-body hidden" id="wipers-body">
            <div class="service-sub-items">${wiperSubItems}</div>
            <div class="form-grid" style="margin-top:1rem">
              <div class="form-group">
                <label>Replaced This Visit</label>
                <select name="wiper_replaced">
                  <option value="">— Select —</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="wiper_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- BATTERY -->
        <div class="service-module">
          <label class="module-toggle">
            <input type="checkbox" name="battery_enabled" value="1"
                   class="module-checkbox" id="battery-toggle">
            <span class="module-toggle-label">Battery</span>
          </label>
          <div class="module-body hidden" id="battery-body">
            <div class="form-grid">
              <div class="form-group">
                <label>Voltage Reading (V)</label>
                <input type="number" name="battery_voltage" step="0.01"
                       placeholder="e.g. 12.6" min="0">
              </div>
              <div class="form-group">
                <label>CCA if Tested (optional)</label>
                <input type="number" name="battery_cca" placeholder="e.g. 550" min="0">
              </div>
              <div class="form-group">
                <label>Test Result</label>
                <select name="battery_test_result">
                  <option value="">— Select —</option>
                  <option value="PASS">PASS</option>
                  <option value="FAIL">FAIL</option>
                </select>
              </div>
              <div class="form-group">
                <label>Battery Age (years, optional)</label>
                <input type="number" name="battery_age" placeholder="e.g. 3" min="0">
              </div>
              <div class="form-group">
                <label>Battery Grade</label>
                <input type="hidden" name="battery_grade" id="battery_grade" value="">
                <div class="grade-btn-row" data-target="battery_grade">
                  <button type="button" class="grade-btn grade-green" data-grade="GREEN">GREEN</button>
                  <button type="button" class="grade-btn grade-yellow" data-grade="YELLOW">YELLOW</button>
                  <button type="button" class="grade-btn grade-red" data-grade="RED">RED</button>
                </div>
              </div>
              <div class="form-group form-group-full">
                <label>Internal Note</label>
                <textarea name="battery_note" rows="2" placeholder="Technician notes..."></textarea>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div class="form-actions">
        <a href="/" class="btn btn-ghost">Cancel</a>
        <button type="submit" class="btn btn-primary btn-lg">Save General Maintenance Job</button>
      </div>
    </form>

    <!-- ── TRACK 2: POST-COLLISION FORM ──────────────────────────────────────── -->
    <form method="POST" action="/jobs" id="collision-form" class="track-form job-form hidden">
      <input type="hidden" name="track" value="post-collision">
      <input type="hidden" name="collision_grade" id="collision_grade" value="">

      <!-- Step 9: Collision grade selector — required before rest renders -->
      <div class="form-section">
        <h2 class="section-heading">Collision Damage Grade <span class="req">*</span></h2>
        <p class="section-hint">Select a grade before continuing. This determines calibration checkpoints and documentation requirements.</p>
        <div class="collision-grade-row">
          <button type="button" class="collision-grade-btn" data-grade="MINOR"
                  onclick="selectCollisionGrade('MINOR')">
            <span class="cgb-label">MINOR</span>
            <span class="cgb-def">No structural involvement. Cosmetic/panel work.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="MODERATE"
                  onclick="selectCollisionGrade('MODERATE')">
            <span class="cgb-label">MODERATE</span>
            <span class="cgb-def">Panels replaced. Frame inspection required. Full ADAS verification required at milestones and at close.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="MAJOR"
                  onclick="selectCollisionGrade('MAJOR')">
            <span class="cgb-label">MAJOR</span>
            <span class="cgb-def">Likely total loss. Pending insurance decision.</span>
          </button>
          <button type="button" class="collision-grade-btn" data-grade="TOTAL"
                  onclick="selectCollisionGrade('TOTAL')">
            <span class="cgb-label">TOTAL</span>
            <span class="cgb-def">Total loss confirmed.</span>
          </button>
        </div>
      </div>

      <div id="collision-rest" class="hidden">
        <div class="form-section">
          <h2 class="section-heading">Vehicle Information</h2>
          <div class="form-grid">
            <div class="form-group">
              <label for="col-ro">RO Number <span class="req">*</span></label>
              <input type="text" id="col-ro" name="ro" placeholder="e.g. RO-12345" required>
            </div>
            <div class="form-group">
              <label for="col-vin">VIN</label>
              <div style="display:flex;gap:0.5rem;align-items:flex-start">
                <div style="flex:1">
                  <input type="text" id="col-vin" name="vin" placeholder="17-character VIN" maxlength="17"
                         style="text-transform:uppercase;width:100%;box-sizing:border-box" autocomplete="off">
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
                  <button type="button" id="col-gen-vin" class="btn btn-ghost" style="white-space:nowrap;font-size:0.8rem">Generate Test VIN</button>
                  <span style="font-size:0.7rem;color:#999;text-align:center">For testing only — not a real vehicle record</span>
                </div>
              </div>
              <span class="field-hint" id="col-vin-status"></span>
              <span class="field-hint" id="col-vin-test-label" style="color:#999"></span>
            </div>
            <div class="form-group">
              <label for="col-year">Year</label>
              <input type="text" id="col-year" name="year" placeholder="e.g. 2022" maxlength="4"
                     value="${escapeHtml(prefill.year)}">
            </div>
            <div class="form-group">
              <label for="col-make">Make</label>
              <input type="text" id="col-make" name="make" placeholder="e.g. Honda"
                     value="${escapeHtml(prefill.make)}">
            </div>
            <div class="form-group">
              <label for="col-model">Model</label>
              <input type="text" id="col-model" name="model" placeholder="e.g. Accord"
                     value="${escapeHtml(prefill.model)}">
            </div>
            <div class="form-group">
              <label for="col-trim">Trim</label>
              <input type="text" id="col-trim" name="trim" placeholder="e.g. Sport">
            </div>
            <div class="form-group">
              <label for="col-tech">Technician Name <span class="req">*</span></label>
              <input type="text" id="col-tech" name="technicianName" placeholder="Full name" required>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h2 class="section-heading">Repairs Performed</h2>
          <p class="section-hint">Select all that apply. The ADAS engine will analyze these to flag required calibrations.</p>
          <div class="checkbox-grid">${checkboxes}</div>
          <div class="form-group" style="margin-top:1.25rem">
            <label for="col-other-repairs">Other Repairs (describe)</label>
            <input type="text" id="col-other-repairs" name="otherRepairs"
                   placeholder="Describe any additional repairs performed&hellip;">
          </div>
        </div>

        <div class="form-section">
          <h2 class="section-heading">Impact Areas <span class="req">*</span></h2>
          <p class="section-hint">Select all vehicle zones with collision damage. These drive photo documentation requirements.</p>
          <div class="checkbox-grid">${impactAreaCheckboxes}</div>
        </div>

        <!-- ── Photo Documentation Placeholder (renders after grade selected) ── -->
        <div id="photo-doc-section" class="hidden">

          <!-- TOTAL grade notice -->
          <div id="total-loss-notice" class="total-loss-notice hidden">
            This job is graded <strong>TOTAL LOSS</strong>. Photo documentation preserves the pre-repair state
            for the insurance claim. Complete Layer 1 in full. Layer 2 is not required unless partial repairs
            were authorized by the insurer.
          </div>

          <!-- ── LAYER 1 ──────────────────────────────────────────────────── -->
          <div class="photo-layer-section">
            <div class="photo-layer-header">
              <div>
                <h2 class="photo-layer-title-form">Layer 1 &mdash; General Area</h2>
                <p class="photo-layer-subtitle">Establish full context before documenting specific damage.</p>
              </div>
              <div class="photo-progress-pill" id="layer1-progress">Layer 1 Complete: 0 of 6 photos</div>
            </div>

            <div class="photo-placeholder-grid" id="layer1-grid">
              ${[
                { label: 'Front Full View',            req: true,  hint: 'Full front of vehicle, all lights and panels visible' },
                { label: 'Driver Side Full View',      req: true,  hint: 'Full driver side from bumper to bumper' },
                { label: 'Passenger Side Full View',   req: true,  hint: 'Full passenger side from bumper to bumper' },
                { label: 'Rear Full View',             req: true,  hint: 'Full rear of vehicle, all lights and panels visible' },
                { label: 'Impact Zone — Wide',         req: true,  hint: 'Full impact area in context, show surrounding panels' },
                { label: 'Adjacent Panels',            req: true,  hint: 'Panels directly neighboring primary damage zone' },
              ].map(p => photoPlaceholderCard(p.label, p.req, p.hint)).join('')}
            </div>
          </div>

          <!-- ── LAYER 2 ──────────────────────────────────────────────────── -->
          <div class="photo-layer-section" id="layer2-section">
            <div class="photo-layer-header">
              <div>
                <h2 class="photo-layer-title-form">Layer 2 &mdash; Focused Damage &amp; Repair</h2>
                <p class="photo-layer-subtitle">Document specific damage, repair process, and ADAS verification.</p>
              </div>
              <div class="photo-progress-pill" id="layer2-progress">Layer 2 Complete: 0 of 12 required photos</div>
            </div>

            <!-- Locked overlay (shown until Layer 1 complete) -->
            <div class="layer2-lock-overlay" id="layer2-lock">
              <span class="layer2-lock-icon">&#128274;</span>
              <span>Complete Layer 1 to unlock focused damage documentation</span>
            </div>

            <!-- Damage Detail sub-group -->
            <div class="photo-subgroup">
              <div class="photo-subgroup-header">Damage Detail</div>
              <div class="photo-placeholder-grid">
                ${[
                  { label: 'Primary Damage — Close',  req: true,  hint: 'Closest detail shot of primary impact point' },
                  { label: 'Secondary Damage — Close',req: false, hint: 'Any secondary damage points, close detail' },
                  { label: 'Structural Concern',      req: false, hint: 'Any visible structural deformation, close detail' },
                ].map(p => photoPlaceholderCard(p.label, p.req, p.hint)).join('')}
              </div>
            </div>

            <!-- In-Process Repair sub-group -->
            <div class="photo-subgroup">
              <div class="photo-subgroup-header">In-Process Repair</div>
              <div class="photo-placeholder-grid">
                ${[
                  { label: 'Disassembly State',              req: true,  hint: 'Vehicle at full disassembly before repair begins' },
                  { label: 'Structural Repair — In Progress',req: false, hint: 'Frame or structural work in progress' },
                  { label: 'Panel Work — In Progress',       req: false, hint: 'Panel replacement or repair in progress' },
                  { label: 'Pre-Paint / Pre-Assembly',       req: true,  hint: 'Vehicle state before reassembly begins' },
                ].map(p => photoPlaceholderCard(p.label, p.req, p.hint)).join('')}
              </div>
            </div>

            <!-- ADAS Setup Documentation sub-group (hidden for MINOR grade) -->
            <div class="photo-subgroup" id="adas-doc-subgroup">
              <div class="photo-subgroup-header">ADAS Setup Documentation</div>
              <div class="photo-placeholder-grid">
                ${[
                  { label: 'Calibration Target Placement', req: true, hint: 'Target board or fixture positioned per OEM spec' },
                  { label: 'Tool Connection',              req: true, hint: 'Scan tool or calibration tool connected and active' },
                  { label: 'Calibration Readings',         req: true, hint: 'Screen showing calibration result or completion confirmation' },
                ].map(p => photoPlaceholderCard(p.label, p.req, p.hint)).join('')}
              </div>
            </div>

            <!-- Finished State sub-group -->
            <div class="photo-subgroup">
              <div class="photo-subgroup-header">Finished State</div>
              <div class="photo-placeholder-grid">
                ${[
                  { label: 'Repair Complete — Full View',   req: true, hint: 'Full vehicle showing completed repair area' },
                  { label: 'Repair Complete — Close Detail',req: true, hint: 'Close shot of repaired area matching opening damage photo' },
                  { label: 'Post-Repair Scan Screen',       req: true, hint: 'Scan tool showing no active ADAS-related DTCs' },
                ].map(p => photoPlaceholderCard(p.label, p.req, p.hint)).join('')}
              </div>
            </div>

          </div><!-- /layer2-section -->
        </div><!-- /photo-doc-section -->

        <div class="form-actions">
          <a href="/" class="btn btn-ghost">Cancel</a>
          <button type="submit" class="btn btn-primary btn-lg">Submit &amp; Generate ADAS Report</button>
        </div>
      </div>
    </form>

    <script>
    /* ── Track Selection ─────────────────────────────────────────────────── */
    function selectTrack(track) {
      // Hide selector, show only the chosen form
      document.getElementById('trackSelector').classList.add('hidden');
      document.querySelectorAll('.track-form').forEach(function(f) { f.classList.add('hidden'); });
      document.querySelectorAll('.track-btn').forEach(function(b) { b.classList.remove('selected'); });
      document.getElementById(track === 'general-maintenance' ? 'btn-gm' : 'btn-collision').classList.add('selected');
      document.getElementById(track === 'general-maintenance' ? 'gm-form' : 'collision-form').classList.remove('hidden');
      document.getElementById('changeTrackBar').classList.remove('hidden');
    }

    function changeTrack() {
      // Reset to selector, clear both forms
      document.getElementById('trackSelector').classList.remove('hidden');
      document.querySelectorAll('.track-form').forEach(function(f) { f.classList.add('hidden'); });
      document.querySelectorAll('.track-btn').forEach(function(b) { b.classList.remove('selected'); });
      document.getElementById('changeTrackBar').classList.add('hidden');
      document.getElementById('vin-flags-panel').classList.add('hidden');
      document.getElementById('vin-flags-panel').innerHTML = '';
    }

    /* ── Service Module Expand/Collapse ─────────────────────────────────── */
    document.querySelectorAll('.module-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var bodyId = this.id.replace('-toggle', '-body');
        document.getElementById(bodyId).classList.toggle('hidden', !this.checked);
      });
    });

    /* ── Grade Buttons ───────────────────────────────────────────────────── */
    document.addEventListener('click', function(e) {
      if (!e.target.classList.contains('grade-btn')) return;
      var row = e.target.closest('.grade-btn-row');
      if (!row) return;
      var targetId = row.dataset.target;
      row.querySelectorAll('.grade-btn').forEach(function(b) { b.classList.remove('selected'); });
      e.target.classList.add('selected');
      document.getElementById(targetId).value = e.target.dataset.grade;
    });

    /* ── Collision Grade ─────────────────────────────────────────────────── */
    function selectCollisionGrade(grade) {
      document.querySelectorAll('.collision-grade-btn').forEach(function(b) {
        b.classList.toggle('selected', b.dataset.grade === grade);
      });
      document.getElementById('collision_grade').value = grade;
      document.getElementById('collision-rest').classList.remove('hidden');

      // Show photo section
      document.getElementById('photo-doc-section').classList.remove('hidden');

      // TOTAL grade notice
      document.getElementById('total-loss-notice').classList.toggle('hidden', grade !== 'TOTAL');

      // MINOR grade: hide ADAS Setup Documentation sub-group
      document.getElementById('adas-doc-subgroup').classList.toggle('hidden', grade === 'MINOR');

      // TOTAL grade: flip all Layer 2 badges to OPTIONAL
      var l2 = document.getElementById('layer2-section');
      l2.querySelectorAll('.photo-badge-required').forEach(function(b) {
        if (grade === 'TOTAL') {
          b.textContent = 'OPTIONAL';
          b.classList.replace('photo-badge-required', 'photo-badge-optional');
          b.dataset.wasRequired = '1';
        } else if (b.dataset.wasRequired) {
          b.textContent = 'REQUIRED';
          b.classList.replace('photo-badge-optional', 'photo-badge-required');
          delete b.dataset.wasRequired;
        }
      });
    }

    /* ── Oil Change Auto-Calculate ───────────────────────────────────────── */
    function calcOilReturn() {
      var miles   = parseInt(document.getElementById('oil-return-miles').value)  || 0;
      var months  = parseInt(document.getElementById('oil-return-months').value) || 0;
      var mileage = parseInt(document.getElementById('gm-mileage').value)        || 0;
      var sDate   = document.getElementById('gm-service-date').value;
      if (miles > 0 && mileage > 0)
        document.getElementById('oil-return-mileage-display').value = (mileage + miles).toLocaleString();
      if (months > 0 && sDate) {
        var d = new Date(sDate + 'T12:00:00');
        d.setMonth(d.getMonth() + months);
        document.getElementById('oil-return-date-display').value = d.toISOString().slice(0, 10);
      }
    }
    document.getElementById('gm-mileage').addEventListener('input', calcOilReturn);

    /* ── Shared VIN decode + flag lookup ────────────────────────────────── */
    function toTitleCase(str) {
      return String(str || '').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    function vinDecode(vinInput, yearId, makeId, modelId, trimId, statusId, testLabelId) {
      var vin = vinInput.value.trim().toUpperCase();
      vinInput.value = vin;
      var statusEl = document.getElementById(statusId);

      // Clear previous status
      statusEl.textContent = '';
      statusEl.className = 'field-hint';

      // Length validation — do not call API unless exactly 17 chars
      if (vin.length !== 17) {
        if (vin.length > 0) {
          statusEl.textContent = 'VIN must be 17 characters. Current length: ' + vin.length;
          statusEl.className = 'field-hint hint-err';
        }
        document.getElementById(yearId).value  = '';
        document.getElementById(makeId).value  = '';
        document.getElementById(modelId).value = '';
        if (trimId) document.getElementById(trimId).value = '';
        return;
      }

      statusEl.textContent = 'Decoding VIN\u2026';
      statusEl.className = 'field-hint';

      fetch('https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/' + encodeURIComponent(vin) + '?format=json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var r = data.Results && data.Results[0];
          if (r && r.ModelYear) {
            var year  = r.ModelYear;
            var make  = r.Make;
            var model = r.Model;
            var trim  = r.Trim || r.Series || r.BodyClass || '';

            document.getElementById(yearId).value  = year;
            document.getElementById(makeId).value  = toTitleCase(make);
            document.getElementById(modelId).value = toTitleCase(model);
            if (trimId) document.getElementById(trimId).value = trim ? toTitleCase(trim) : '';

            statusEl.textContent = 'VIN decoded.';
            statusEl.className = 'field-hint hint-ok';
          } else {
            statusEl.textContent = 'VIN could not be decoded. Please enter vehicle details manually.';
            statusEl.className = 'field-hint hint-err';
          }
        })
        .catch(function() {
          statusEl.textContent = 'VIN could not be decoded. Please enter vehicle details manually.';
          statusEl.className = 'field-hint hint-err';
        });

      fetch('/api/vin/' + encodeURIComponent(vin) + '/flags')
        .then(function(r) { return r.json(); })
        .then(function(flags) {
          var panel = document.getElementById('vin-flags-panel');
          if (!flags || flags.length === 0) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
          panel.innerHTML = '<strong>\u26A0 OPEN FLAGS ON VIN ' + _esc(vin) + '</strong>' +
            flags.map(function(f) {
              return '<div class="vin-flag-item">\u26A0 OPEN FLAG \u2014 ' +
                _esc(f.item_type) + (f.sub_item ? ' &mdash; ' + _esc(f.sub_item) : '') +
                ' \u2014 <strong class="grade-text-' + f.grade.toLowerCase() + '">' + _esc(f.grade) + '</strong>' +
                ' \u2014 First flagged: ' + _esc(f.date_flagged) +
                ' \u2014 Job: <a href="/jobs/' + encodeURIComponent(f.origin_job_id) + '">' + _esc(f.origin_job_id) + '</a></div>';
            }).join('');
          panel.classList.remove('hidden');
        })
        .catch(function() {});
    }

    function _esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    var testVINs = [
      { vin: '1HGCV1F3XLA025410', label: '2020 Honda Accord' },
      { vin: '2T1BURHE0JC034301', label: '2018 Toyota Corolla' },
      { vin: '1FTFW1ET5DFC10312', label: '2013 Ford F-150' },
      { vin: '1G1ZD5ST4JF246849', label: '2018 Chevrolet Malibu' },
      { vin: '1C4RJFBG8FC198072', label: '2015 Jeep Grand Cherokee' },
      { vin: '3VWF17AT4FM019976', label: '2015 Volkswagen Jetta' },
      { vin: '1N4AL3AP7JC231503', label: '2018 Nissan Altima' },
      { vin: '5NPE24AF8FH089298', label: '2015 Hyundai Sonata' },
      { vin: '1FADP3F24EL381528', label: '2014 Ford Focus' },
      { vin: '2C3CDXBG8EH316940', label: '2014 Dodge Charger' },
      { vin: '1HGCM82633A004352', label: '2003 Honda Accord' },
      { vin: '4T1BF1FK5CU147227', label: '2012 Toyota Camry' },
      { vin: 'WBAJB0C51BC613615', label: '2011 BMW 535i' },
      { vin: 'JM1BL1SF8A1134586', label: '2010 Mazda 3' },
      { vin: '1GNSKCKC8FR672786', label: '2015 Chevrolet Tahoe' },
    ];

    function setupVinField(vinId, yearId, makeId, modelId, trimId, statusId, testLabelId, genBtnId) {
      var vinEl = document.getElementById(vinId);
      var testLabelEl = document.getElementById(testLabelId);

      vinEl.addEventListener('blur', function() {
        vinDecode(this, yearId, makeId, modelId, trimId, statusId, testLabelId);
      });

      // Clear test label if user manually edits the VIN
      vinEl.addEventListener('input', function() {
        if (testLabelEl) testLabelEl.textContent = '';
      });

      document.getElementById(genBtnId).addEventListener('click', function() {
        var entry = testVINs[Math.floor(Math.random() * testVINs.length)];
        vinEl.value = entry.vin;
        if (testLabelEl) testLabelEl.textContent = 'Test VIN loaded: ' + entry.label + ' \u2014 Replace with real VIN before saving';
        vinDecode(vinEl, yearId, makeId, modelId, trimId, statusId, testLabelId);
      });
    }

    setupVinField('gm-vin',  'gm-year',  'gm-make',  'gm-model',  'gm-trim',  'gm-vin-status',  'gm-vin-test-label',  'gm-gen-vin');
    setupVinField('col-vin', 'col-year', 'col-make', 'col-model', 'col-trim', 'col-vin-status', 'col-vin-test-label', 'col-gen-vin');
    </script>`;

  res.send(layout('New Job', content, 'new', req.session.user, req.session.shopFilter));
});

// POST /jobs — Create job (handles both tracks)
app.post('/jobs', requireAuth, requireCreate, (req, res) => {
  const track = req.body.track || 'post-collision';
  const jobId      = generateJobId();
  const shareToken = crypto.randomBytes(16).toString('hex');
  const shareUrl   = `/share/${shareToken}`;
  const now        = new Date().toISOString();
  const sessionShopId = req.session.user.shop_id || DEFAULT_SHOP_ID;

  if (track === 'general-maintenance') {
    // ── Step 3: General Maintenance ──────────────────────────────────────────
    const { ro, vin, year, make, model, trim, notes } = req.body;
    const serviceDate = req.body.service_date || now.slice(0, 10);
    const mileage     = req.body.mileage     || '';
    const assignedTech = req.body.assigned_tech || '';

    const returnMileage = req.body.return_mileage || '';
    const returnDate    = req.body.return_date    || '';

    db.prepare(`
      INSERT INTO jobs
        (jobId, ro, vin, year, make, model, trim, technicianName, assigned_tech,
         track, service_date, mileage, return_mileage, return_date,
         repairsPerformed, status, shareToken, shareUrl, createdAt, updatedAt, shop_id, created_by, last_changed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      jobId, ro || '', (vin || '').toUpperCase(), year || '', make || '', model || '', trim || '',
      assignedTech, assignedTech, 'general-maintenance',
      serviceDate, mileage, returnMileage, returnDate,
      notes || '', 'Created', shareToken, shareUrl, now, now, sessionShopId, req.session.user.id, now
    );

    // ── Step 5: Save service items + grade audit + vin flags ─────────────────
    const vinUpper = (vin || '').trim().toUpperCase();

    // Oil Change — grade is always GREEN when performed
    if (req.body.oil_change_enabled) {
      applyGradeFlag(vinUpper, sessionShopId, jobId, assignedTech,
        'Oil Change', null, 'GREEN', null,
        [req.body.oil_type, req.body.oil_viscosity].filter(Boolean).join(' / '),
        req.body.oil_note || null
      );
    }

    // Brakes
    if (req.body.brakes_enabled) {
      const brakeSubs = [
        ['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr'],
      ];
      for (const [label, code] of brakeSubs) {
        const grade = req.body[`brake_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, sessionShopId, jobId, assignedTech,
            'Brakes', label, grade, null,
            req.body[`brake_${code}_measurement`] || null,
            req.body.brake_note || null
          );
        }
      }
    }

    // Tires
    if (req.body.tires_enabled) {
      const tireSubs = [
        ['Front Left','fl'],['Front Right','fr'],['Rear Left','rl'],['Rear Right','rr'],
      ];
      for (const [label, code] of tireSubs) {
        const grade = req.body[`tire_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, sessionShopId, jobId, assignedTech,
            'Tires', label, grade, null,
            req.body[`tire_${code}_depth`] || null,
            req.body.tire_note || null
          );
        }
      }
    }

    // Wipers
    if (req.body.wipers_enabled) {
      const wiperSubs = [
        ['Driver Side','driver'],['Passenger Side','passenger'],['Rear','rear'],
      ];
      for (const [label, code] of wiperSubs) {
        const grade = req.body[`wiper_${code}_grade`] || '';
        if (grade) {
          applyGradeFlag(vinUpper, sessionShopId, jobId, assignedTech,
            'Wipers', label, grade, null, null,
            req.body.wiper_note || null
          );
        }
      }
    }

    // Battery
    if (req.body.battery_enabled) {
      const grade = req.body.battery_grade || '';
      if (grade) {
        applyGradeFlag(vinUpper, sessionShopId, jobId, assignedTech,
          'Battery', null, grade, null,
          [req.body.battery_voltage ? `${req.body.battery_voltage}V` : '',
           req.body.battery_test_result || ''].filter(Boolean).join(' / '),
          req.body.battery_note || null
        );
      }
    }

    return res.redirect(`/jobs/${jobId}`);
  }

  // ── Step 9: Post-Collision ────────────────────────────────────────────────
  const { ro, vin, year, make, model, trim, technicianName, otherRepairs } = req.body;
  const collisionGrade = req.body.collision_grade || '';

  let repairs = req.body.repairs || [];
  if (!Array.isArray(repairs)) repairs = [repairs];
  if (otherRepairs && otherRepairs.trim()) repairs.push(otherRepairs.trim());
  const repairsStr = repairs.join(', ');

  let impactAreas = req.body.impact_areas || [];
  if (!Array.isArray(impactAreas)) impactAreas = [impactAreas];
  const impactAreasJson = JSON.stringify(impactAreas);

  const {
    adasSystems, rationale, liabilityWarning, makeSpecificNotes,
    preScanRequired, postScanRequired, approvedScanTool,
  } = runADASEngine(make, model, year, repairs);

  db.prepare(`
    INSERT INTO jobs
      (jobId, ro, vin, year, make, model, trim, technicianName,
       repairsPerformed, adasSystems, rationale, liabilityWarning,
       makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
       track, collision_grade, impact_areas,
       status, shareToken, shareUrl, createdAt, updatedAt, shop_id, created_by, last_changed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Created',?,?,?,?,?,?,?)
  `).run(
    jobId, ro || '', (vin || '').toUpperCase(), year || '', make || '', model || '', trim || '',
    technicianName || '', repairsStr, adasSystems, rationale, liabilityWarning,
    makeSpecificNotes, preScanRequired, postScanRequired, approvedScanTool,
    'post-collision', collisionGrade, impactAreasJson,
    shareToken, shareUrl, now, now, sessionShopId, req.session.user.id, now
  );

  // Seed photo label rows
  const adasRequired = !!(adasSystems && adasSystems.trim());
  const photoLabels = generatePhotoLabels({ impact_areas: impactAreas, adas_required: adasRequired });
  const insertLabel = db.prepare(`
    INSERT INTO job_photos (job_id, shop_id, layer, zone, label_key, label_display, is_recommended, is_adas, tech_name)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  for (const l of photoLabels) {
    insertLabel.run(jobId, sessionShopId, l.layer, l.zone || null, l.key, l.display,
      l.is_recommended ? 1 : 0, l.is_adas ? 1 : 0, '');
  }

  // Step 11: Create ADAS checkpoints for MODERATE grade jobs
  if (collisionGrade === 'MODERATE') {
    for (let i = 0; i < CHECKPOINT_LABELS.length; i++) {
      db.prepare(`
        INSERT INTO job_checkpoints (job_id, checkpoint_index, label)
        VALUES (?,?,?)
      `).run(jobId, i, CHECKPOINT_LABELS[i]);
    }
  }

  res.redirect(`/jobs/${jobId}`);
});

// GET /jobs/:jobId — Job view (hard copy)
app.get('/jobs/:jobId', requireAuth, shopScope, (req, res) => {
  const flash  = consumeFlash(req);
  const user   = req.session.user;
  const isTech = user.role === 'technician';
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId = ? AND shop_id = ?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  }

  if (!job) {
    return res.status(404).send(layout('Not Found', `
      <div class="error-page">
        <div class="error-icon">&#x26A0;</div>
        <h1>Job Not Found</h1>
        <p>No job with ID <strong>${escapeHtml(req.params.jobId)}</strong> exists.</p>
        <a href="/" class="btn btn-primary" style="margin-top:1.5rem">Back to Jobs</a>
      </div>`, '', user));
  }

  // Tech can only see their own jobs
  if (isTech && job.assigned_tech !== user.full_name && job.technicianName !== user.full_name) {
    return res.status(403).send(layout('Access Denied', '<div class="error-page"><h1>Access Denied</h1><p>You do not have permission to view this job.</p></div>', '', user));
  }

  const isGM        = job.track === 'general-maintenance';
  const isCollision = !isGM;

  // ── GM: service items section ─────────────────────────────────────────────
  let serviceItemsSection = '';
  if (isGM) {
    const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);
    if (items.length > 0) {
      const itemRows = items.map(i => `
        <tr>
          <td>${escapeHtml(i.item_type)}</td>
          <td>${escapeHtml(i.sub_item || '—')}</td>
          <td><span class="grade-badge grade-badge-${(i.grade || '').toLowerCase()}">${escapeHtml(i.grade || '—')}</span></td>
          <td>${escapeHtml(i.measurement || '—')}</td>
          <td>${escapeHtml(i.note || '—')}</td>
        </tr>`).join('');
      serviceItemsSection = `
      <section class="doc-section">
        <h2 class="doc-section-title">Service Items</h2>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Sub-Item</th><th>Grade</th><th>Measurement</th><th>Note</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
        ${job.return_mileage || job.return_date ? `
        <div class="info-grid" style="margin-top:1rem">
          ${job.return_mileage ? `<div class="info-row"><span class="info-label">Return Mileage</span><span class="info-val">${escapeHtml(job.return_mileage)}</span></div>` : ''}
          ${job.return_date    ? `<div class="info-row"><span class="info-label">Return Date</span><span class="info-val">${escapeHtml(job.return_date)}</span></div>` : ''}
        </div>` : ''}
      </section>`;
    }
  }

  // ── Collision: checkpoints ────────────────────────────────────────────────
  let checkpointsSection = '';
  if (isCollision && job.collision_grade === 'MODERATE') {
    const cps = db.prepare(`SELECT * FROM job_checkpoints WHERE job_id = ? ORDER BY checkpoint_index`).all(job.jobId);
    if (cps.length > 0) {
      const cpRows = cps.map(cp => `
        <div class="checkpoint-row ${cp.completed ? 'checkpoint-done' : ''}">
          <span class="checkpoint-num">${cp.checkpoint_index + 1}</span>
          <span class="checkpoint-label">${escapeHtml(cp.label)}</span>
          <span class="checkpoint-status">
            ${cp.completed
              ? `&#10003; Signed off by ${escapeHtml(cp.completed_by || '—')} on ${escapeHtml(cp.completed_at ? cp.completed_at.slice(0,10) : '—')}`
              : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/checkpoints/${cp.checkpoint_index}/complete" class="inline-form">
                   <input type="text" name="completed_by" placeholder="Your name" required style="width:140px">
                   <button type="submit" class="btn btn-sm btn-primary">Sign Off</button>
                 </form>`}
          </span>
        </div>`).join('');
      const allDone = cps.every(c => c.completed);
      checkpointsSection = `
      <section class="doc-section">
        <h2 class="doc-section-title">ADAS Verification Checkpoints
          ${allDone ? '<span class="badge badge-green" style="font-size:.7rem;margin-left:.5rem">ALL COMPLETE</span>' : ''}</h2>
        <div class="checkpoint-list no-print">${cpRows}</div>
        <div class="print-only checkpoint-print">
          ${cps.map(cp => `<div class="cp-print-row">${cp.checkpoint_index+1}. ${escapeHtml(cp.label)} — ${cp.completed ? 'COMPLETE — ' + escapeHtml(cp.completed_by||'') : 'PENDING'}</div>`).join('')}
        </div>
      </section>`;
    }
  }

  // ── Photos section (labeled slots) ───────────────────────────────────────
  let photosSection = '';
  if (isCollision) {
    const jobPhotoRows = db.prepare(
      `SELECT * FROM job_photos WHERE job_id=? ORDER BY layer, id`
    ).all(job.jobId);

    if (jobPhotoRows.length > 0) {
      // Role gates for upload and delete
      const canUpload = ['platform_admin', 'shop_admin', 'qc_manager', 'technician'].includes(user.role) &&
                        (job.status !== 'Closed' || user.role === 'platform_admin');
      const canDelete = user.role !== 'service_writer' &&
                        (job.status !== 'Closed' || user.role === 'platform_admin');

      // Layer 1 gate
      const l1Required = jobPhotoRows.filter(r => r.layer === 1 && !r.is_recommended);
      const l1Done     = l1Required.filter(r => r.file_path).length;
      const l1Total    = l1Required.length;
      const layer1Locked = l1Done < l1Total;

      // Build slot card HTML
      function slotCard(slot) {
        const filled = !!slot.file_path;
        const rec    = !!slot.is_recommended;
        const border = filled ? '2px solid #22863a' : (rec ? '2px dashed #b8860b' : '2px dashed #cccccc');
        const bg     = filled ? '#f0fff4'           : (rec ? '#fffbea'            : '#fafafa');
        const clickable = !filled && canUpload;

        let html = '<div class="photo-slot" style="border:' + border + ';background:' + bg + '"';
        if (clickable) html += ' onclick="triggerUpload(' + slot.id + ')" tabindex="0"';
        html += ' data-slot-id="' + slot.id + '">';

        if (canUpload) {
          html += '<input type="file" id="slot-input-' + slot.id + '" '
                + 'accept="image/jpeg,image/png,image/heic,image/webp" class="no-print" '
                + 'style="display:none" onchange="uploadSlot(' + slot.id + ',this)">';
        }

        if (filled) {
          // Auth-gated serve route — no unauthenticated access
          html += '<img src="/jobs/' + encodeURIComponent(job.jobId) + '/photos/' + slot.id + '/file" '
                + 'alt="' + escapeHtml(slot.label_display) + '" class="slot-thumb-img" loading="lazy">';
        } else {
          html += '<div class="slot-empty-icon no-print">&#128247;</div>';
          html += '<div class="print-only" style="font-size:10px;color:#999;font-style:italic">'
                + (rec ? '' : '[ Not Uploaded ]') + '</div>';
        }

        html += '<div class="slot-label">' + escapeHtml(slot.label_display)
              + (rec ? ' <span class="rec-star">&#11088;</span>' : '') + '</div>';

        if (filled) {
          html += '<div class="slot-meta no-print">' + escapeHtml(slot.tech_name || '') + ' &middot; '
                + escapeHtml(slot.uploaded_at ? slot.uploaded_at.slice(0,10) : '') + '</div>';
          html += '<div class="slot-meta print-only" style="font-size:9px;color:#888">'
                + escapeHtml(slot.tech_name || '') + ' &bull; '
                + escapeHtml(slot.uploaded_at ? slot.uploaded_at.slice(0,10) : '') + '</div>';
          if (canDelete) {
            html += '<button class="slot-remove-btn no-print" data-photo-id="' + slot.id + '" '
                  + 'onclick="removeSlot(event,' + slot.id + ')" title="Remove">&#10005;</button>';
          }
        } else if (canUpload) {
          html += '<div class="slot-tap-hint no-print">' + (rec ? 'Tap to add (optional)' : 'Tap to upload') + '</div>';
        } else {
          html += '<div class="slot-tap-hint no-print" style="color:#aaa">No photo</div>';
        }

        if (slot.label_key === 'MIRROR_SIDE_UNDAMAGED' && !filled) {
          html += '<div class="mirror-callout no-print">&#11088; Recommended: undamaged opposite side '
                + 'helps adjusters establish pre-loss condition.</div>';
        }

        html += '</div>';
        return html;
      }

      function slotGroup(title, slots, locked) {
        let html = '<div class="photo-label-group' + (locked ? ' group-locked' : '') + '">';
        html += '<h3 class="photo-group-title">' + escapeHtml(title);
        if (locked) html += ' <span style="font-size:.7rem;background:#FFF9CC;color:#7A6000;padding:1px 7px;border-radius:10px;font-weight:600">LOCKED</span>';
        html += '</h3>';
        if (locked) {
          html += '<p class="photo-locked-msg">Complete all required Layer 1 photos to unlock Layer 2.</p>';
        } else {
          html += '<div class="photo-slot-grid">' + slots.map(slotCard).join('') + '</div>';
        }
        html += '</div>';
        return html;
      }

      // Layer 1 groups
      const l1Overview = jobPhotoRows.filter(r => r.layer === 1 && !r.zone);
      const l1Zones    = [...new Set(jobPhotoRows.filter(r => r.layer === 1 && r.zone).map(r => r.zone))];

      let layer1Html = slotGroup(
        'Vehicle Overview (' + l1Done + '/' + l1Total + ' required)',
        l1Overview, false
      );
      for (const z of l1Zones) {
        const zSlots = jobPhotoRows.filter(r => r.layer === 1 && r.zone === z);
        layer1Html += slotGroup((ZONE_DISPLAY[z] || z) + ' \u2014 Zone View', zSlots, false);
      }

      // Layer 2 groups
      const l2ZoneOrder = [...new Set(jobPhotoRows.filter(r => r.layer === 2).map(r => r.zone || 'other'))];
      let layer2Html = '';
      for (const z of l2ZoneOrder) {
        const slots = jobPhotoRows.filter(r => r.layer === 2 && (r.zone || 'other') === z);
        const title = z === 'adas_setup'
          ? 'ADAS Documentation'
          : (ZONE_DISPLAY[z] || z) + ' \u2014 Damage Documentation';
        layer2Html += slotGroup(title, slots, layer1Locked);
      }

      const techNameJs = escapeHtml((job.technicianName || job.assigned_tech || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
      const jobIdJs    = encodeURIComponent(job.jobId);

      photosSection = `
      <style>
        .photo-slot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
        .photo-slot{border-radius:8px;padding:10px;min-height:130px;display:flex;flex-direction:column;
                    align-items:center;justify-content:center;gap:5px;position:relative;cursor:pointer}
        .photo-slot.slot-filled-cursor{cursor:default}
        .photo-slot:not([onclick]):hover{box-shadow:none}
        .photo-slot[onclick]:hover{box-shadow:0 2px 8px rgba(0,0,0,.14)}
        .slot-thumb-img{width:100%;max-height:100px;object-fit:cover;border-radius:4px}
        .slot-empty-icon{font-size:28px;opacity:.3}
        .slot-label{font-size:11px;font-weight:600;text-align:center;color:#333;line-height:1.3}
        .slot-tap-hint{font-size:10px;color:#999}
        .slot-meta{font-size:10px;color:#555;text-align:center}
        .slot-remove-btn{position:absolute;top:4px;right:4px;background:none;border:none;color:#c0392b;
                         cursor:pointer;font-size:11px;padding:2px 4px;border-radius:3px;line-height:1}
        .slot-remove-btn:hover{background:#ffe0e0}
        .mirror-callout{font-size:10px;color:#7a6000;background:#fffbea;border:1px solid #f0d060;
                        border-radius:4px;padding:4px 6px;text-align:center;margin-top:2px}
        .photo-label-group{margin-bottom:22px}
        .photo-group-title{font-size:13px;font-weight:700;color:#1B3A6B;border-bottom:1px solid #e0e4ea;
                           padding-bottom:5px;margin:0 0 6px 0}
        .group-locked{opacity:.45;pointer-events:none}
        .photo-locked-msg{font-size:12px;color:#7a6000;margin:4px 0}
        .photo-layer-title-sub{font-size:14px;font-weight:700;color:#333;margin:0 0 12px 0}
        .rec-star{font-size:10px}
        @media print{
          .photo-slot-grid{grid-template-columns:1fr 1fr;gap:6px}
          .photo-slot{min-height:auto;page-break-inside:avoid}
          .slot-thumb-img{max-height:130px}
        }
      </style>

      <section class="doc-section" id="photo-doc-section">
        <h2 class="doc-section-title">Photo Documentation
          <span class="badge badge-${job.photo_status || 'red'}" style="font-size:.65rem;margin-left:.5rem;vertical-align:middle">${(job.photo_status || 'red').toUpperCase()}</span>
        </h2>

        <div class="photo-layer-section" style="margin-bottom:20px">
          <p class="photo-layer-title-sub">Layer 1 &mdash; Vehicle Overview &amp; Zone Establishment</p>
          ${layer1Html}
        </div>

        ${layer2Html ? '<div class="photo-layer-section"><p class="photo-layer-title-sub">Layer 2 &mdash; Damage Documentation'
          + (layer1Locked ? ' <span style="font-size:.7rem;background:#FFF9CC;color:#7A6000;padding:1px 7px;border-radius:10px;font-weight:600">REQUIRES LAYER 1 COMPLETE</span>' : '')
          + '</p>' + layer2Html + '</div>' : ''}
      </section>

      <script>
        function triggerUpload(id){var i=document.getElementById('slot-input-'+id);if(i)i.click();}
        function uploadSlot(id,input){
          if(!input.files[0])return;
          var fd=new FormData();
          fd.append('photo',input.files[0]);
          fd.append('tech_name','${techNameJs}');
          fetch('/api/jobs/${jobIdJs}/photos/'+id,{method:'POST',body:fd})
            .then(function(r){return r.json();})
            .then(function(d){if(d.success)location.reload();else alert(d.error||'Upload failed');})
            .catch(function(){alert('Upload failed — check connection');});
        }
        function removeSlot(e,id){
          e.stopPropagation();
          if(!confirm('Remove this photo?'))return;
          fetch('/api/jobs/${jobIdJs}/photos/'+id+'/file',{method:'DELETE'})
            .then(function(r){return r.json();})
            .then(function(d){if(d.success)location.reload();else alert(d.error||'Remove failed');})
            .catch(function(){alert('Remove failed');});
        }
      </script>`;
    }
  }

  // ── Assigned Team section ─────────────────────────────────────────────────
  const assignedRows = db.prepare(`
    SELECT u.id, u.full_name, u.role
    FROM job_assignments ja
    JOIN users u ON u.id = ja.user_id
    WHERE ja.job_id=?
    ORDER BY ja.assigned_at
  `).all(job.jobId);

  const canAssign = ['platform_admin', 'shop_admin', 'qc_manager'].includes(user.role);
  let shopUsersForAssign = [];
  if (canAssign) {
    shopUsersForAssign = req.shopId
      ? db.prepare(`SELECT id, full_name, role FROM users WHERE shop_id=? AND active=1 ORDER BY full_name`).all(req.shopId)
      : db.prepare(`SELECT id, full_name, role FROM users WHERE active=1 ORDER BY full_name`).all();
  }

  const assignedSection = `
      <section class="doc-section no-print">
        <h2 class="doc-section-title">Assigned Team</h2>
        ${assignedRows.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:1rem">
               ${assignedRows.map(u => {
                 const parts    = (u.full_name || '').trim().split(/\s+/);
                 const initials = parts.length >= 2
                   ? parts[0][0] + parts[parts.length - 1][0]
                   : (parts[0] || '?')[0];
                 return `<div style="display:flex;align-items:center;gap:6px;background:#f4f6f9;border-radius:20px;padding:4px 12px 4px 6px">
                   <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#1B3A6B;color:#fff;font-size:11px;font-weight:700">${escapeHtml(initials.toUpperCase())}</span>
                   <span style="font-size:.85rem;color:#333">${escapeHtml(u.full_name)}</span>
                   <span style="font-size:.75rem;color:#888">[${escapeHtml(u.role)}]</span>
                 </div>`;
               }).join('')}
             </div>`
          : `<p style="color:#888;font-size:.85rem;margin-bottom:1rem">No team members assigned.</p>`
        }
        ${canAssign ? `
        <details>
          <summary style="cursor:pointer;display:inline-block;padding:.35rem .75rem;background:#f4f6f9;border:1px solid #dde2ea;border-radius:5px;font-size:.85rem;font-weight:600;color:#1B3A6B;list-style:none;user-select:none">&#128101; Manage Assignment</summary>
          <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/assign" style="margin-top:.75rem">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.5rem;margin-bottom:.75rem">
              ${shopUsersForAssign.map(u => `
                <label style="display:flex;align-items:center;gap:.5rem;font-size:.85rem;cursor:pointer">
                  <input type="checkbox" name="user_ids" value="${u.id}"${assignedRows.some(a => a.id === u.id) ? ' checked' : ''}>
                  <span>${escapeHtml(u.full_name)} <span style="color:#888">[${escapeHtml(u.role)}]</span></span>
                </label>`).join('')}
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Save Assignment</button>
          </form>
        </details>` : ''}
      </section>`;

  // ── Share link section ─────────────────────────────────────────────────────
  const activeToken = db.prepare(
    `SELECT token FROM share_tokens WHERE job_id=? AND revoked=0 ORDER BY id DESC LIMIT 1`
  ).get(job.jobId);

  const shareSection = `
      <section class="doc-section no-print">
        <h2 class="doc-section-title">Insurer Link</h2>
        ${activeToken
          ? `<div class="share-url-row">
               <span class="field-hint hint-ok">Active share link:</span>
               <code class="share-url" id="shareUrlDisplay">${escapeHtml(req.protocol + '://' + req.get('host') + '/share/' + activeToken.token)}</code>
               <button onclick="navigator.clipboard.writeText(document.getElementById('shareUrlDisplay').textContent)" class="btn btn-sm">Copy</button>
               <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share/revoke" class="inline-form" style="margin-left:.5rem">
                 <button type="submit" class="btn btn-sm" style="border-color:#c0392b;color:#c0392b">Revoke</button>
               </form>
             </div>`
          : `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/share" class="inline-form">
               <button type="submit" class="btn btn-primary btn-sm">Generate Insurer Link</button>
             </form>`}
      </section>`;

  // ── Tech view link ─────────────────────────────────────────────────────────
  const techViewLink = `
      <section class="doc-section no-print" style="padding:.75rem 1.25rem">
        <a href="/jobs/${encodeURIComponent(job.jobId)}/tech" class="btn btn-sm">Tech View</a>
        ${job.status === 'Closed'
          ? `<a href="/jobs/${encodeURIComponent(job.jobId)}/export/tech-pdf" class="btn btn-sm" style="margin-left:.5rem">Save My Work Record</a>`
          : ''}
      </section>`;

  // ── Existing collision sections ───────────────────────────────────────────
  const adasList      = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];
  const rationaleList = job.rationale   ? job.rationale.split('\n').filter(Boolean)   : [];
  const isHV =
    (job.make || '').toLowerCase().includes('tesla') ||
    (job.repairsPerformed || '').toLowerCase().includes('ev / hybrid vehicle') ||
    (job.repairsPerformed || '').toLowerCase().includes('ev/hybrid');

  const adasItems = adasList.length > 0
    ? adasList.map(s => `
        <li class="adas-item">
          <span class="adas-flag">&#9888;</span>
          <span>${escapeHtml(s)}</span>
        </li>`).join('')
    : `<li class="adas-item adas-none">
         <span class="adas-flag adas-ok">&#10003;</span>
         <span>No ADAS calibration flagged for the reported repairs on this vehicle.</span>
       </li>`;

  const rationaleItems = rationaleList.length > 0
    ? rationaleList.map(r => `<li>${escapeHtml(r)}</li>`).join('')
    : '<li>No rationale generated.</li>';

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          <div><span class="meta-label">Track</span>
            <span class="badge badge-${isGM ? 'blue' : 'orange'}">${isGM ? 'General Maintenance' : 'Post-Collision'}</span>
          </div>
          ${job.collision_grade ? `<div><span class="meta-label">Damage Grade</span>
            <span class="badge badge-${job.collision_grade === 'MINOR' ? 'green' : job.collision_grade === 'MODERATE' ? 'orange' : 'red'}">${escapeHtml(job.collision_grade)}</span>
          </div>` : ''}
          <div><span class="meta-label">Status</span>
            <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span>
          </div>
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print / Save PDF</button>
          ${['platform_admin','shop_admin','service_writer'].includes(user.role) && job.status !== 'Closed'
            ? `<a href="/jobs/${encodeURIComponent(job.jobId)}/edit" class="btn btn-white">&#9998; Edit Job</a>`
            : ''}
          ${['platform_admin','shop_admin','qc_manager'].includes(user.role) && job.status !== 'Closed'
            ? `<form id="closeDirectForm" method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/close" style="display:inline">
                 <button type="${(job.photo_status||'red') === 'red' ? 'button' : 'submit'}"
                         class="btn btn-white" style="border-color:#c0392b;color:#c0392b"
                         ${(job.photo_status||'red') === 'red' ? `onclick="document.getElementById('closeJobModal').style.display='flex'"` : ''}>
                   Close Job
                 </button>
               </form>`
            : ''}
          <a href="/" class="btn btn-ghost-white">Back to Jobs</a>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle Information</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">RO Number</span><span class="info-val">${escapeHtml(job.ro) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Year</span><span class="info-val">${escapeHtml(job.year) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Make</span><span class="info-val">${escapeHtml(job.make) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Model</span><span class="info-val">${escapeHtml(job.model) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Trim</span><span class="info-val">${escapeHtml(job.trim) || '&mdash;'}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName || job.assigned_tech) || '&mdash;'}</span></div>
          ${isGM && job.service_date ? `<div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date)}</span></div>` : ''}
          ${isGM && job.mileage     ? `<div class="info-row"><span class="info-label">Mileage</span><span class="info-val">${escapeHtml(job.mileage)}</span></div>` : ''}
          ${isCollision ? `<div class="info-row info-row-full"><span class="info-label">Repairs Performed</span><span class="info-val">${escapeHtml(job.repairsPerformed) || '&mdash;'}</span></div>` : ''}
        </div>
      </section>

      ${serviceItemsSection}

      ${isCollision ? `
      <section class="doc-section scan-req-section">
        <h2 class="doc-section-title">Scan Requirements</h2>
        <div class="scan-req-grid">
          <div class="scan-req-row">
            <span class="scan-req-label">Pre-Repair Scan</span>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(job.preScanRequired)}">${escapeHtml(scanBadgeLabel(job.preScanRequired))}</span>
            <span class="scan-req-detail">${escapeHtml(job.preScanRequired || 'RECOMMENDED')}</span>
          </div>
          <div class="scan-req-row">
            <span class="scan-req-label">Post-Repair Scan</span>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(job.postScanRequired)}">${escapeHtml(scanBadgeLabel(job.postScanRequired))}</span>
            <span class="scan-req-detail">${escapeHtml(job.postScanRequired || 'RECOMMENDED')}</span>
          </div>
          <div class="scan-req-row scan-req-tool-row">
            <span class="scan-req-label">&#128295; Approved Scan Tool</span>
            <span class="scan-tool-value">${escapeHtml(job.approvedScanTool || 'Consult OEM service information')}</span>
          </div>
        </div>
      </section>

      ${isHV ? `
      <div class="hv-banner">
        <span class="hv-banner-icon">&#9889;</span>
        <p>HIGH VOLTAGE / EV VEHICLE &mdash; Review HV isolation and safety procedures before beginning repair. See ADAS Systems section for full requirements.</p>
      </div>` : ''}

      <section class="doc-section adas-section">
        <h2 class="doc-section-title">ADAS Systems &mdash; Calibration Required</h2>
        <ul class="adas-list">${adasItems}</ul>
      </section>

      <section class="doc-section">
        <h2 class="doc-section-title">Rationale</h2>
        <ul class="rationale-list">${rationaleItems}</ul>
      </section>

      <section class="doc-section warning-section">
        <h2 class="doc-section-title">Liability Warning</h2>
        <div class="warning-box">
          <span class="warning-icon">&#9888;</span>
          <p>${escapeHtml(job.liabilityWarning) || '&mdash;'}</p>
        </div>
      </section>

      <section class="doc-section">
        <h2 class="doc-section-title">Make-Specific Notes</h2>
        <div class="notes-box"><p>${escapeHtml(job.makeSpecificNotes) || '&mdash;'}</p></div>
      </section>` : ''}

      ${checkpointsSection}
      ${photosSection}
      ${assignedSection}
      ${shareSection}
      ${techViewLink}

      <div class="doc-footer">
        <p>Generated by CollisionIQ &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC</p>
      </div>
    </div>

    ${flash ? `<div style="position:fixed;top:1rem;right:1rem;z-index:999;background:${flash.type==='success'?'#D6F0D6':'#FFD6D6'};color:${flash.type==='success'?'#1A6B1A':'#8B0000'};padding:.65rem 1.25rem;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:.9rem;max-width:340px">${escapeHtml(flash.msg)}</div>` : ''}

    ${['platform_admin','shop_admin','qc_manager'].includes(user.role) && job.status !== 'Closed' && (job.photo_status||'red') === 'red' ? `
    <div id="closeJobModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:10px;padding:2rem;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2)">
        <h3 style="color:#8B0000;margin-bottom:.75rem">&#9888; Photo Documentation Incomplete</h3>
        <p style="color:#555;font-size:.9rem;margin-bottom:1rem">Photo status is <strong>RED</strong>. Required photos have not been fully uploaded. Provide a reason to close this job anyway.</p>
        <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/close">
          <textarea name="override_reason" required placeholder="Reason for overriding photo requirement&hellip;"
                    style="width:100%;border:1px solid #ccc;border-radius:6px;padding:.6rem;font-size:.9rem;min-height:80px;margin-bottom:1rem;box-sizing:border-box;resize:vertical"></textarea>
          <div style="display:flex;gap:.5rem">
            <button type="submit" class="btn btn-primary" style="flex:1">Confirm &mdash; Close Job</button>
            <button type="button" class="btn" onclick="document.getElementById('closeJobModal').style.display='none'" style="flex:1">Cancel</button>
          </div>
        </form>
      </div>
    </div>` : ''}`;

  res.send(layout(`Job ${job.jobId}`, content, '', req.session.user, req.session.shopFilter));
});

// ─── POST /jobs/:jobId/close — Close job with photo-status soft-lock ──────────

app.post('/jobs/:jobId/close', requireAuth, requireQC, shopScope, (req, res) => {
  const jobId = req.params.jobId;
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(jobId);
  }
  if (!job) return res.status(404).send('Job not found.');
  if (job.status === 'Closed') return res.redirect(`/jobs/${encodeURIComponent(jobId)}`);

  const photoStatus    = job.photo_status || 'red';
  const overrideReason = (req.body.override_reason || '').trim();

  if (photoStatus === 'red' && !overrideReason) {
    setFlash(req, 'error', 'Photo documentation is incomplete (RED). Provide an override reason to close anyway.');
    return res.redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE jobs SET status='Closed', photo_status_override=?, closed_by=?, closed_at=?, last_changed=?, updatedAt=?
    WHERE jobId=?
  `).run(photoStatus === 'red' ? 1 : 0, req.session.user.id, now, now, now, jobId);

  setFlash(req, 'success', 'Job closed successfully.');
  res.redirect(`/jobs/${encodeURIComponent(jobId)}`);
});

// ─── POST /jobs/:jobId/assign — Replace team assignment ───────────────────────

app.post('/jobs/:jobId/assign', requireAuth, requireQC, shopScope, (req, res) => {
  const jobId = req.params.jobId;
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT jobId FROM jobs WHERE jobId=? AND shop_id=?`).get(jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT jobId FROM jobs WHERE jobId=?`).get(jobId);
  }
  if (!job) return res.status(404).send('Job not found.');

  const userIds = [].concat(req.body.user_ids || []).map(Number).filter(n => n > 0);
  const now     = new Date().toISOString();
  const assigner = req.session.user.id;

  db.prepare(`DELETE FROM job_assignments WHERE job_id=?`).run(jobId);
  const insertAssign = db.prepare(`INSERT OR IGNORE INTO job_assignments (job_id, user_id, assigned_by, assigned_at) VALUES (?,?,?,?)`);
  for (const uid of userIds) insertAssign.run(jobId, uid, assigner, now);

  setFlash(req, 'success', 'Team assignment updated.');
  res.redirect(`/jobs/${encodeURIComponent(jobId)}`);
});

// ─── GET /jobs/:jobId/edit — Edit job form ────────────────────────────────────

app.get('/jobs/:jobId/edit', requireAuth, requireEdit, shopScope, (req, res) => {
  const user = req.session.user;
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).send(layout('Not Found', '<p>Job not found.</p>', '', user));
  if (job.status === 'Closed') {
    setFlash(req, 'error', 'Closed jobs cannot be edited.');
    return res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
  }

  const isGM = job.track === 'general-maintenance';

  const repairOptions = [
    'Windshield','Front Camera Area','Front Bumper','Rear Bumper','Radar',
    'Structural Body Repair','Airbag / SRS Deployment','Rear Structural',
    'Wheel Alignment','Suspension','Door / Mirror Repair','EV / Hybrid Vehicle','Other',
  ];
  const impactAreaOptions = [
    ['front_end','Front End'],['rear_end','Rear End'],['driver_side','Driver Side'],
    ['passenger_side','Passenger Side'],['roof','Roof / Rollover'],['undercarriage','Undercarriage'],
  ];

  const existingRepairs = (job.repairsPerformed || '').split(',').map(s => s.trim()).filter(Boolean);
  let existingImpact = [];
  try { existingImpact = JSON.parse(job.impact_areas || '[]'); } catch (e) { existingImpact = []; }

  const repairCheckboxes = repairOptions.map(r => `
    <label class="checkbox-label">
      <input type="checkbox" name="repairs" value="${escapeHtml(r)}"${existingRepairs.includes(r) ? ' checked' : ''}>
      <span>${escapeHtml(r)}</span>
    </label>`).join('');

  const impactCheckboxes = impactAreaOptions.map(([val, label]) => `
    <label class="checkbox-label">
      <input type="checkbox" name="impact_areas" value="${val}"${existingImpact.includes(val) ? ' checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`).join('');

  const content = `
    <div style="max-width:720px;margin:0 auto">
      <div class="page-header">
        <h1>Edit Job &mdash; <span style="font-family:monospace">${escapeHtml(job.jobId)}</span></h1>
        <a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a>
      </div>
      <div class="card" style="padding:1.5rem">
        <form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/edit">
          <div class="form-section">
            <h3 class="form-section-title">Vehicle Information</h3>
            <div class="form-row-2">
              <div class="form-group">
                <label for="ro">RO Number</label>
                <input type="text" id="ro" name="ro" value="${escapeHtml(job.ro||'')}" placeholder="RO-1234">
              </div>
              <div class="form-group">
                <label for="vin">VIN</label>
                <input type="text" id="vin" name="vin" value="${escapeHtml(job.vin||'')}" maxlength="17" placeholder="17-char VIN">
              </div>
            </div>
            <div class="form-row-4">
              <div class="form-group">
                <label for="year">Year</label>
                <input type="text" id="year" name="year" value="${escapeHtml(job.year||'')}" placeholder="2022">
              </div>
              <div class="form-group">
                <label for="make">Make</label>
                <input type="text" id="make" name="make" value="${escapeHtml(job.make||'')}" placeholder="Toyota">
              </div>
              <div class="form-group">
                <label for="model">Model</label>
                <input type="text" id="model" name="model" value="${escapeHtml(job.model||'')}" placeholder="Camry">
              </div>
              <div class="form-group">
                <label for="trim">Trim</label>
                <input type="text" id="trim" name="trim" value="${escapeHtml(job.trim||'')}" placeholder="XSE">
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-group">
                <label for="technicianName">Technician Name</label>
                <input type="text" id="technicianName" name="technicianName" value="${escapeHtml(job.technicianName||'')}" placeholder="Jane Smith">
              </div>
              ${isGM ? `
              <div class="form-group">
                <label for="mileage">Mileage</label>
                <input type="text" id="mileage" name="mileage" value="${escapeHtml(job.mileage||'')}" placeholder="45000">
              </div>` : ''}
              ${isGM ? `
              <div class="form-group">
                <label for="service_date">Service Date</label>
                <input type="date" id="service_date" name="service_date" value="${escapeHtml(job.service_date||'')}">
              </div>` : ''}
            </div>
          </div>
          ${!isGM ? `
          <div class="form-section">
            <h3 class="form-section-title">Repairs Performed <span style="font-size:.8rem;color:#888;font-weight:400">(used to recalculate ADAS requirements)</span></h3>
            <div class="checkbox-grid">${repairCheckboxes}</div>
          </div>
          <div class="form-section">
            <h3 class="form-section-title">Impact Areas</h3>
            <div class="checkbox-grid">${impactCheckboxes}</div>
          </div>
          <div class="form-section">
            <h3 class="form-section-title">Damage Grade</h3>
            <select name="collision_grade" class="form-control" style="max-width:200px">
              <option value="">— Select —</option>
              ${['MINOR','MODERATE','MAJOR'].map(g => `<option value="${g}"${job.collision_grade===g?' selected':''}>${g}</option>`).join('')}
            </select>
          </div>` : ''}
          <div style="margin-top:1.5rem;display:flex;gap:.75rem">
            <button type="submit" class="btn btn-primary">&#10003; Save Changes</button>
            <a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;

  res.send(layout(`Edit Job ${job.jobId}`, content, '', user, req.session.shopFilter));
});

// ─── POST /jobs/:jobId/edit — Save edited job ─────────────────────────────────

app.post('/jobs/:jobId/edit', requireAuth, requireEdit, shopScope, async (req, res) => {
  const user = req.session.user;
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).send('Job not found.');
  if (job.status === 'Closed') {
    setFlash(req, 'error', 'Closed jobs cannot be edited.');
    return res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
  }

  const isGM  = job.track === 'general-maintenance';
  const { ro, vin, year, make, model, trim, technicianName, mileage, service_date, collision_grade } = req.body;
  const now   = new Date().toISOString();

  if (isGM) {
    db.prepare(`
      UPDATE jobs SET ro=?, vin=?, year=?, make=?, model=?, trim=?, technicianName=?,
        mileage=?, service_date=?, last_edited_by=?, last_edited_at=?, last_changed=?, updatedAt=?
      WHERE jobId=?
    `).run(ro||'', (vin||'').toUpperCase(), year||'', make||'', model||'', trim||'', technicianName||'',
           mileage||'', service_date||'', user.id, now, now, now, job.jobId);
  } else {
    let repairs = req.body.repairs || [];
    if (!Array.isArray(repairs)) repairs = [repairs];
    const repairsStr = repairs.join(', ');

    let impactAreas = req.body.impact_areas || [];
    if (!Array.isArray(impactAreas)) impactAreas = [impactAreas];
    const impactAreasJson = JSON.stringify(impactAreas);

    const {
      adasSystems, rationale, liabilityWarning, makeSpecificNotes,
      preScanRequired, postScanRequired, approvedScanTool,
    } = runADASEngine(make || job.make, model || job.model, year || job.year, repairs);

    db.prepare(`
      UPDATE jobs SET ro=?, vin=?, year=?, make=?, model=?, trim=?, technicianName=?,
        repairsPerformed=?, collision_grade=?, impact_areas=?,
        adasSystems=?, rationale=?, liabilityWarning=?, makeSpecificNotes=?,
        preScanRequired=?, postScanRequired=?, approvedScanTool=?,
        last_edited_by=?, last_edited_at=?, last_changed=?, updatedAt=?
      WHERE jobId=?
    `).run(ro||'', (vin||'').toUpperCase(), year||'', make||'', model||'', trim||'', technicianName||'',
           repairsStr, collision_grade||'', impactAreasJson,
           adasSystems, rationale, liabilityWarning, makeSpecificNotes,
           preScanRequired, postScanRequired, approvedScanTool,
           user.id, now, now, now, job.jobId);
  }

  setFlash(req, 'success', 'Job updated successfully.');
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// GET /admin — Admin panel
app.get('/admin', requireAdmin, shopScope, (req, res) => {
  const jobs = req.shopId
    ? db.prepare(`SELECT * FROM jobs WHERE shop_id=? ORDER BY createdAt DESC`).all(req.shopId)
    : db.prepare(`SELECT * FROM jobs ORDER BY createdAt DESC`).all();

  const statusOptions = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];

  const rows = jobs.map(j => {
    const options = statusOptions.map(s =>
      `<option value="${s}"${j.status === s ? ' selected' : ''}>${s}</option>`
    ).join('');

    return `
    <tr>
      <td><span class="job-id">${escapeHtml(j.jobId)}</span></td>
      <td>${escapeHtml(j.ro) || '&mdash;'}</td>
      <td class="mono">${j.vin ? escapeHtml(j.vin.slice(-6)) : '&mdash;'}</td>
      <td>${escapeHtml(j.year)} ${escapeHtml(j.make)} ${escapeHtml(j.model)}</td>
      <td>${escapeHtml(j.technicianName) || '&mdash;'}</td>
      <td>
        <form method="POST" action="/jobs/${encodeURIComponent(j.jobId)}/status" class="inline-form">
          <select name="status" onchange="this.form.submit()" class="status-select status-${statusClass(j.status)}">
            ${options}
          </select>
        </form>
      </td>
      <td>${formatDate(j.createdAt)}</td>
      <td><a href="/jobs/${encodeURIComponent(j.jobId)}" class="btn btn-sm">View</a></td>
    </tr>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Admin &mdash; Job Management <span class="count-badge">${jobs.length}</span></h1>
    </div>

    <div class="admin-hint">
      <p>Change a job's status using the dropdown. The page will update automatically.</p>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>RO #</th>
            <th>VIN (last 6)</th>
            <th>Vehicle</th>
            <th>Technician</th>
            <th>Status</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="8" class="empty">No jobs found.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  res.send(layout('Admin', content, 'admin', req.session.user, req.session.shopFilter));
});

// POST /jobs/:jobId/status — Update status
app.post('/jobs/:jobId/status', requireAdmin, (req, res) => {
  const validStatuses = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];
  const { status } = req.body;

  if (!validStatuses.includes(status)) {
    return res.status(400).send('Invalid status value.');
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE jobs SET status = ?, updatedAt = ?, last_changed = ? WHERE jobId = ?`)
    .run(status, now, now, req.params.jobId);

  res.redirect('/admin');
});

// ─── Step 4: VIN Flag API ─────────────────────────────────────────────────────

app.get('/api/vin/:vin/flags', requireAuth, shopScope, (req, res) => {
  const vin = (req.params.vin || '').toUpperCase();
  const shopId = req.shopId || DEFAULT_SHOP_ID;
  const flags = db.prepare(`
    SELECT * FROM vin_flags
    WHERE vin=? AND shop_id=? AND status IN ('OPEN','ESCALATED')
    ORDER BY date_flagged ASC
  `).all(vin, shopId);
  res.json(flags);
});

// ─── Step 6: GM Flag Dashboard ────────────────────────────────────────────────

app.get('/dashboard/flags', requireAuth, requireQC, shopScope, (req, res) => {
  const shopId = req.shopId || DEFAULT_SHOP_ID;
  const flags = req.shopId
    ? db.prepare(`SELECT * FROM vin_flags WHERE shop_id=? AND status IN ('OPEN','ESCALATED') ORDER BY date_flagged ASC`).all(shopId)
    : db.prepare(`SELECT * FROM vin_flags WHERE status IN ('OPEN','ESCALATED') ORDER BY date_flagged ASC`).all();

  const gradeClass = g => g === 'YELLOW' || g === 'ESCALATED' ? 'yellow' : 'red';

  const rows = flags.length === 0
    ? '<tr><td colspan="6" class="empty">No open flags.</td></tr>'
    : flags.map(f => `
      <tr>
        <td class="mono">${escapeHtml(f.vin)}</td>
        <td>${escapeHtml(f.item_type)}</td>
        <td>${escapeHtml(f.sub_item || '—')}</td>
        <td><span class="grade-badge grade-badge-${gradeClass(f.grade)}">${escapeHtml(f.status === 'ESCALATED' ? 'ESCALATED' : f.grade)}</span></td>
        <td>${escapeHtml(f.date_flagged)}</td>
        <td><a href="/jobs/${encodeURIComponent(f.origin_job_id)}" class="btn btn-sm">${escapeHtml(f.origin_job_id)}</a></td>
      </tr>`).join('');

  const content = `
    <div class="page-header">
      <h1>Open Vehicle Flags <span class="count-badge">${flags.length}</span></h1>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>VIN</th><th>Item Type</th><th>Sub-Item</th>
            <th>Status / Grade</th><th>First Flagged</th><th>Origin Job</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  res.send(layout('Open Vehicle Flags', content, 'flags', req.session.user, req.session.shopFilter));
});

// ─── Step 7: Tech Job View ────────────────────────────────────────────────────

app.get('/jobs/:jobId/tech', requireAuth, shopScope, (req, res) => {
  const user = req.session.user;
  const isTech = user.role === 'technician';
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId = ? AND shop_id = ?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).send(layout('Not Found', '<p>Job not found.</p>', '', user));
  if (isTech && job.assigned_tech !== user.full_name && job.technicianName !== user.full_name) {
    return res.status(403).send(layout('Access Denied', '<div class="error-page"><h1>Access Denied</h1></div>', '', user));
  }

  // Open flag warning
  const shopId = req.shopId || DEFAULT_SHOP_ID;
  const openFlags = job.vin
    ? db.prepare(`SELECT * FROM vin_flags WHERE vin=? AND shop_id=? AND status IN ('OPEN','ESCALATED') ORDER BY date_flagged`).all(job.vin, shopId)
    : [];

  const flagPanel = openFlags.length > 0
    ? `<div class="vin-flag-panel" style="margin-bottom:1.5rem">
        <strong>&#9888; OPEN FLAGS ON VIN ${escapeHtml(job.vin)}</strong>
        ${openFlags.map(f => `
        <div class="vin-flag-item">&#9888; OPEN FLAG &mdash; ${escapeHtml(f.item_type)}${f.sub_item ? ' &mdash; ' + escapeHtml(f.sub_item) : ''}
          &mdash; <strong>${escapeHtml(f.grade)}</strong>
          &mdash; First flagged: ${escapeHtml(f.date_flagged)}
          &mdash; Job: <a href="/jobs/${encodeURIComponent(f.origin_job_id)}">${escapeHtml(f.origin_job_id)}</a>
        </div>`).join('')}
       </div>`
    : '';

  // Service items
  const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);

  // Group items by type for editing
  const itemTypes = [...new Set(items.map(i => i.item_type))];
  const itemForms = itemTypes.map(type => {
    const typeItems = items.filter(i => i.item_type === type);
    return `
      <div class="form-section">
        <h3 class="section-heading">${escapeHtml(type)}</h3>
        ${typeItems.map(item => `
        <div class="service-sub-items">
          <div class="sub-item-row">
            <span class="sub-item-label">${escapeHtml(item.sub_item || 'Reading')}</span>
            ${gradeButtonHtml(`grade_${item.id}`, item.grade)}
            <input type="text" name="measurement_${item.id}" value="${escapeHtml(item.measurement || '')}"
                   placeholder="Measurement" class="measurement-input">
            <input type="text" name="note_${item.id}" value="${escapeHtml(item.note || '')}"
                   placeholder="Note" style="flex:1;min-width:120px">
            <input type="hidden" name="item_id_${item.id}" value="${item.id}">
          </div>
        </div>`).join('')}
      </div>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Tech View &mdash; ${escapeHtml(job.jobId)}</h1>
      <span class="badge badge-${statusClass(job.status)}">${escapeHtml(job.status)}</span>
    </div>

    ${flagPanel}

    <div class="job-doc" style="padding:1.5rem">
      <div class="info-grid" style="margin-bottom:1rem">
        <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
        <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}${job.trim ? ' ' + escapeHtml(job.trim) : ''}</span></div>
        <div class="info-row"><span class="info-label">RO</span><span class="info-val">${escapeHtml(job.ro) || '—'}</span></div>
        <div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date || formatDate(job.createdAt))}</span></div>
      </div>

      ${items.length > 0
        ? `<form method="POST" action="/jobs/${encodeURIComponent(job.jobId)}/tech/update" class="job-form">
            <input type="hidden" name="tech_name" value="${escapeHtml(job.technicianName || job.assigned_tech || '')}">
            ${itemForms}
            <div class="form-actions">
              <a href="/jobs/${encodeURIComponent(job.jobId)}" class="btn btn-ghost">Back to Job</a>
              <button type="submit" class="btn btn-primary">Save Updates</button>
            </div>
           </form>`
        : '<p style="color:#888">No service items on this job.</p>'}

      ${job.status === 'Closed'
        ? `<div style="margin-top:1.5rem">
             <a href="/jobs/${encodeURIComponent(job.jobId)}/export/tech-pdf" class="btn btn-primary">Save My Work Record</a>
           </div>`
        : ''}
    </div>`;

  res.send(layout(`Tech View — ${job.jobId}`, content, '', req.session.user, req.session.shopFilter));
});

app.post('/jobs/:jobId/tech/update', requireAuth, (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const techName = req.body.tech_name || '';
  const now = new Date().toISOString();

  // Collect item IDs from hidden fields
  const itemIds = Object.keys(req.body)
    .filter(k => k.startsWith('item_id_'))
    .map(k => parseInt(req.body[k]));

  for (const id of itemIds) {
    const existing = db.prepare(`SELECT * FROM job_service_items WHERE id=?`).get(id);
    if (!existing || existing.job_id !== job.jobId) continue;

    const newGrade   = req.body[`grade_${id}`]       || existing.grade;
    const newMeas    = req.body[`measurement_${id}`]  ?? existing.measurement;
    const newNote    = req.body[`note_${id}`]         ?? existing.note;
    const prevGrade  = existing.grade;

    db.prepare(`UPDATE job_service_items SET grade=?, measurement=?, note=?, tech_name=?, updated_at=? WHERE id=?`)
      .run(newGrade, newMeas, newNote, techName, now, id);

    // Audit + flag logic
    if (newGrade !== prevGrade) {
      db.prepare(`
        INSERT INTO grade_audit (job_id, shop_id, tech_name, item_type, sub_item, grade, previous_grade, timestamp, note)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(job.jobId, DEFAULT_SHOP_ID, techName, existing.item_type, existing.sub_item,
             newGrade, prevGrade, now, newNote || null);

      // Re-apply flag logic on grade change
      const vinUpper = (job.vin || '').toUpperCase();
      const sub = existing.sub_item || null;
      const findOpen = db.prepare(`
        SELECT id, grade FROM vin_flags
        WHERE vin=? AND shop_id=? AND item_type=? AND (sub_item IS ? OR sub_item=?)
          AND status IN ('OPEN','ESCALATED') ORDER BY id DESC LIMIT 1
      `);
      if (newGrade === 'GREEN') {
        const flag = findOpen.get(vinUpper, DEFAULT_SHOP_ID, existing.item_type, sub, sub);
        if (flag) db.prepare(`UPDATE vin_flags SET status='RESOLVED', resolved_job_id=?, date_resolved=? WHERE id=?`)
          .run(job.jobId, now.slice(0,10), flag.id);
      } else if (newGrade === 'YELLOW') {
        db.prepare(`INSERT INTO vin_flags (shop_id,vin,item_type,sub_item,grade,origin_job_id,date_flagged) VALUES (?,?,?,?,?,?,?)`)
          .run(DEFAULT_SHOP_ID, vinUpper, existing.item_type, sub, 'YELLOW', job.jobId, now.slice(0,10));
      } else if (newGrade === 'RED') {
        const flag = findOpen.get(vinUpper, DEFAULT_SHOP_ID, existing.item_type, sub, sub);
        if (flag && flag.grade === 'YELLOW') db.prepare(`UPDATE vin_flags SET status='ESCALATED' WHERE id=?`).run(flag.id);
        db.prepare(`INSERT INTO vin_flags (shop_id,vin,item_type,sub_item,grade,origin_job_id,date_flagged) VALUES (?,?,?,?,?,?,?)`)
          .run(DEFAULT_SHOP_ID, vinUpper, existing.item_type, sub, 'RED', job.jobId, now.slice(0,10));
      }
    }
  }

  db.prepare(`UPDATE jobs SET last_changed = ? WHERE jobId = ?`).run(now, job.jobId);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}/tech`);
});

// ─── Step 8: Tech PDF Export (server-side PII scrub) ─────────────────────────

app.get('/jobs/:jobId/export/tech-pdf', requireAuth, (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  // Scrub: never pass customer name / contact / plate to client
  // (those fields don't exist yet but this route will never expose them when they do)
  const items = db.prepare(`SELECT * FROM job_service_items WHERE job_id = ? ORDER BY id`).all(job.jobId);

  const itemRows = items.map(i => `
    <tr>
      <td>${escapeHtml(i.item_type)}</td>
      <td>${escapeHtml(i.sub_item || '—')}</td>
      <td><span class="grade-badge grade-badge-${(i.grade||'').toLowerCase()}">${escapeHtml(i.grade || '—')}</span></td>
      <td>${escapeHtml(i.measurement || '—')}</td>
      <td>${escapeHtml(i.note || '—')}</td>
    </tr>`).join('');

  const adasList = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="tech-pdf-notice">
        <strong>Personal Work Record</strong><br>
        This record is for your personal professional documentation. Customer identifying information has been removed.
        This PDF is your record of work performed &mdash; it is not a shop document and should be stored privately.
      </div>

      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ &mdash; Tech Work Record</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.service_date || job.createdAt)}</div>
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Save PDF</button>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
          <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}${job.trim ? ' ' + escapeHtml(job.trim) : ''}</span></div>
          <div class="info-row"><span class="info-label">Mileage</span><span class="info-val">${escapeHtml(job.mileage || '—')}</span></div>
          <div class="info-row"><span class="info-label">Service Date</span><span class="info-val">${escapeHtml(job.service_date || formatDate(job.createdAt))}</span></div>
          <div class="info-row"><span class="info-label">Technician</span><span class="info-val">${escapeHtml(job.technicianName || job.assigned_tech || '—')}</span></div>
        </div>
      </section>

      ${items.length > 0 ? `
      <section class="doc-section">
        <h2 class="doc-section-title">Service Items &amp; Findings</h2>
        <table class="data-table">
          <thead><tr><th>Item</th><th>Sub-Item</th><th>Grade</th><th>Measurement</th><th>Note</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </section>` : ''}

      ${adasList.length > 0 ? `
      <section class="doc-section">
        <h2 class="doc-section-title">ADAS Findings</h2>
        <ul class="adas-list">
          ${adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      <div class="doc-footer">
        <p>CollisionIQ Tech Work Record &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC</p>
      </div>
    </div>`;

  res.send(layout(`Work Record — ${job.jobId}`, content, '', req.session.user, req.session.shopFilter));
});

// ─── Step 10: Photo Upload ────────────────────────────────────────────────────

app.post('/jobs/:jobId/photos', requireAuth, upload.single('photo'), (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job || !req.file) return res.redirect(`/jobs/${encodeURIComponent(req.params.jobId)}`);

  const layer       = parseInt(req.body.layer) || 1;
  const category    = req.body.category   || '';
  const techName    = req.body.tech_name  || '';
  const damageGrade = req.body.damage_grade || null;

  // Gate: Layer 2 requires at least one Layer 1 photo
  if (layer === 2) {
    const l1count = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE job_id=? AND layer=1`).get(job.jobId);
    if (!l1count || l1count.c === 0) {
      return res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
    }
  }

  db.prepare(`
    INSERT INTO photos (job_id, layer, category, filename, tech_name, damage_grade)
    VALUES (?,?,?,?,?,?)
  `).run(job.jobId, layer, category, req.file.filename, techName, damageGrade);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// ─── Photo Label API ─────────────────────────────────────────────────────────

const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

// GET /jobs/:jobId/photos/:photoId/file — auth-gated photo serve
// Verifies session + shop scope before serving. Replaces public /uploads static route.
app.get('/jobs/:jobId/photos/:photoId/file', requireAuth, shopScope, (req, res) => {
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const photoRow = db.prepare(`SELECT * FROM job_photos WHERE id=? AND job_id=?`)
    .get(req.params.photoId, job.jobId);
  if (!photoRow || !photoRow.file_path) return res.status(404).json({ error: 'Photo not found' });

  const filePath = path.join(uploadsDir, photoRow.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  res.sendFile(filePath);
});

// GET /api/jobs/:jobId/photos — labeled slot manifest
app.get('/api/jobs/:jobId/photos', requireAuth, shopScope, (req, res) => {
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const rows  = db.prepare(`SELECT * FROM job_photos WHERE job_id=? ORDER BY layer, id`).all(job.jobId);
  const layer1 = rows.filter(r => r.layer === 1);
  const layer2 = {};
  for (const r of rows.filter(r => r.layer === 2)) {
    const z = r.zone || 'other';
    if (!layer2[z]) layer2[z] = [];
    layer2[z].push(r);
  }
  res.json({ layer1, layer2 });
});

// POST /api/jobs/:jobId/photos/:photoId — upload file to labeled slot
app.post('/api/jobs/:jobId/photos/:photoId', requireAuth, shopScope, upload.single('photo'), (req, res) => {
  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Job not found' });
  }

  const user = req.session.user;

  // service_writer cannot upload photos
  if (user.role === 'service_writer') {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Service writers cannot upload photos.' });
  }

  // Closed job lock — only platform_admin may upload to a closed job
  if (job.status === 'Closed' && user.role !== 'platform_admin') {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'This job is closed. Photos cannot be added.' });
  }

  // Tech scope check
  if (user.role === 'technician' &&
      job.assigned_tech !== user.full_name && job.technicianName !== user.full_name) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Access denied' });
  }

  const photoRow = db.prepare(`SELECT * FROM job_photos WHERE id=? AND job_id=?`)
    .get(req.params.photoId, job.jobId);
  if (!photoRow) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Photo slot not found' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  if (!ALLOWED_PHOTO_MIME.includes(req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'File type not allowed. Use JPEG, PNG, HEIC, or WebP.' });
  }

  // Layer 2 gate
  if (photoRow.layer === 2) {
    const pending = db.prepare(
      `SELECT COUNT(*) as c FROM job_photos WHERE job_id=? AND layer=1 AND is_recommended=0 AND file_path IS NULL`
    ).get(job.jobId);
    if (pending.c > 0) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Complete all required Layer 1 photos before uploading Layer 2.' });
    }
  }

  // Delete existing file if replacing
  if (photoRow.file_path) {
    const oldPath = path.join(uploadsDir, photoRow.file_path);
    if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch (e) {}
  }

  const techName   = req.body.tech_name || user.full_name || '';
  const fileSizeKb = Math.ceil(req.file.size / 1024);
  const now        = new Date().toISOString();

  db.prepare(`UPDATE job_photos SET file_path=?, mime_type=?, file_size_kb=?, tech_name=?, uploaded_at=?, notes=? WHERE id=?`)
    .run(req.file.filename, req.file.mimetype, fileSizeKb, techName, now, req.body.notes || null, photoRow.id);

  db.prepare(`UPDATE jobs SET last_changed=? WHERE jobId=?`).run(now, job.jobId);
  updateJobPhotoStatus(db, job.jobId);

  res.json({ success: true, file_path: req.file.filename, uploaded_at: now });
});

// DELETE /api/jobs/:jobId/photos/:photoId/file — clear file from slot
app.delete('/api/jobs/:jobId/photos/:photoId/file', requireAuth, shopScope, (req, res) => {
  const user = req.session.user;

  // service_writer cannot delete photos
  if (user.role === 'service_writer') {
    return res.status(403).json({ error: 'Service writers cannot delete photos.' });
  }

  let job;
  if (req.shopId) {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=? AND shop_id=?`).get(req.params.jobId, req.shopId);
  } else {
    job = db.prepare(`SELECT * FROM jobs WHERE jobId=?`).get(req.params.jobId);
  }
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Closed job lock — only platform_admin may delete from a closed job
  if (job.status === 'Closed' && user.role !== 'platform_admin') {
    return res.status(403).json({ error: 'This job is closed. Photos cannot be removed.' });
  }

  const photoRow = db.prepare(`SELECT * FROM job_photos WHERE id=? AND job_id=?`)
    .get(req.params.photoId, job.jobId);
  if (!photoRow) return res.status(404).json({ error: 'Photo slot not found' });

  // Technician restriction: own photo only, within 24 hours of upload
  if (user.role === 'technician') {
    if (photoRow.tech_name !== user.full_name) {
      return res.status(403).json({ error: 'You can only remove your own photos.' });
    }
    if (photoRow.uploaded_at) {
      const ageMs = Date.now() - new Date(photoRow.uploaded_at).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        return res.status(403).json({ error: 'Photos can only be removed within 24 hours of upload.' });
      }
    }
  }

  if (photoRow.file_path) {
    const filePath = path.join(uploadsDir, photoRow.file_path);
    if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch (e) {}
  }

  db.prepare(`UPDATE job_photos SET file_path=NULL, mime_type=NULL, file_size_kb=NULL, tech_name='', uploaded_at=NULL, notes=NULL WHERE id=?`)
    .run(photoRow.id);
  updateJobPhotoStatus(db, job.jobId);

  res.json({ success: true });
});

// ─── Step 11: Checkpoint Sign-Off ────────────────────────────────────────────

app.post('/jobs/:jobId/checkpoints/:idx/complete', requireAuth, requireQC, (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const idx         = parseInt(req.params.idx);
  const completedBy = req.body.completed_by || 'Unknown';
  const now         = new Date().toISOString();

  db.prepare(`
    UPDATE job_checkpoints SET completed=1, completed_by=?, completed_at=?
    WHERE job_id=? AND checkpoint_index=?
  `).run(completedBy, now, job.jobId, idx);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

// ─── Step 12: Shareable Insurer Link ─────────────────────────────────────────

app.post('/jobs/:jobId/share', requireAuth, (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  const token = crypto.randomUUID();
  const now   = new Date().toISOString();
  db.prepare(`INSERT INTO share_tokens (job_id, token, created_at) VALUES (?,?,?)`).run(job.jobId, token, now);

  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

app.post('/jobs/:jobId/share/revoke', requireAuth, (req, res) => {
  const job = db.prepare(`SELECT jobId FROM jobs WHERE jobId = ?`).get(req.params.jobId);
  if (!job) return res.status(404).send('Job not found.');

  db.prepare(`UPDATE share_tokens SET revoked=1 WHERE job_id=? AND revoked=0`).run(job.jobId);
  res.redirect(`/jobs/${encodeURIComponent(job.jobId)}`);
});

app.get('/share/:token', (req, res) => {
  const row = db.prepare(`SELECT * FROM share_tokens WHERE token=? AND revoked=0`).get(req.params.token);
  if (!row) {
    return res.status(404).send(layout('Link Expired', `
      <div class="error-page">
        <div class="error-icon">&#x26A0;</div>
        <h1>Link Not Found or Revoked</h1>
        <p>This insurer link is invalid, expired, or has been revoked.</p>
      </div>`));
  }

  const job = db.prepare(`SELECT * FROM jobs WHERE jobId = ?`).get(row.job_id);
  if (!job) return res.status(404).send('Job not found.');

  const photos      = db.prepare(`SELECT * FROM photos WHERE job_id=? ORDER BY layer,uploaded_at`).all(job.jobId);
  const checkpoints = db.prepare(`SELECT * FROM job_checkpoints WHERE job_id=? ORDER BY checkpoint_index`).all(job.jobId);
  const adasList    = job.adasSystems ? job.adasSystems.split('\n').filter(Boolean) : [];

  const photoGrid = photos.length > 0
    ? `<div class="photo-grid">${photos.map(p => `
        <div class="photo-thumb">
          <img src="/uploads/${encodeURIComponent(p.filename)}" alt="${escapeHtml(p.category)}" loading="lazy">
          <div class="photo-caption">${escapeHtml(p.category)}${p.damage_grade ? ' — ' + escapeHtml(p.damage_grade) : ''}</div>
        </div>`).join('')}</div>`
    : '<p class="empty">No photos on file.</p>';

  const cpList = checkpoints.length > 0
    ? checkpoints.map(cp => `
       <div class="checkpoint-row ${cp.completed ? 'checkpoint-done' : ''}">
         <span class="checkpoint-num">${cp.checkpoint_index + 1}</span>
         <span class="checkpoint-label">${escapeHtml(cp.label)}</span>
         <span class="checkpoint-status">${cp.completed ? '&#10003; Complete' : 'Pending'}</span>
       </div>`).join('')
    : '';

  const content = `
    <div class="job-doc" id="jobDoc">
      <div class="job-doc-header">
        <div>
          <div class="doc-brand">CollisionIQ &mdash; Insurer Documentation</div>
          <div class="doc-owner">Cueljuris LLC</div>
        </div>
        <div class="doc-meta">
          <div><span class="meta-label">Job ID</span> ${escapeHtml(job.jobId)}</div>
          <div><span class="meta-label">Date</span> ${formatDate(job.createdAt)}</div>
          ${job.collision_grade ? `<div><span class="meta-label">Damage Grade</span> ${escapeHtml(job.collision_grade)}</div>` : ''}
        </div>
        <div class="doc-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print</button>
        </div>
      </div>

      <section class="doc-section">
        <h2 class="doc-section-title">Vehicle</h2>
        <div class="info-grid">
          <div class="info-row"><span class="info-label">Job ID</span><span class="info-val">${escapeHtml(job.jobId)}</span></div>
          <div class="info-row"><span class="info-label">VIN</span><span class="info-val mono">${escapeHtml(job.vin) || '—'}</span></div>
          <div class="info-row"><span class="info-label">Vehicle</span><span class="info-val">${escapeHtml(job.year)} ${escapeHtml(job.make)} ${escapeHtml(job.model)}</span></div>
          <div class="info-row"><span class="info-label">Date</span><span class="info-val">${formatDate(job.createdAt)}</span></div>
        </div>
      </section>

      ${adasList.length > 0 ? `
      <section class="doc-section adas-section">
        <h2 class="doc-section-title">ADAS Calibration Requirements</h2>
        <ul class="adas-list">
          ${adasList.map(s => `<li class="adas-item"><span class="adas-flag">&#9888;</span><span>${escapeHtml(s)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      ${cpList ? `
      <section class="doc-section">
        <h2 class="doc-section-title">Verification Checkpoints</h2>
        <div class="checkpoint-list">${cpList}</div>
      </section>` : ''}

      <section class="doc-section">
        <h2 class="doc-section-title">Photo Documentation</h2>
        ${photoGrid}
      </section>

      <div class="doc-footer">
        <p>CollisionIQ &mdash; Job ID: ${escapeHtml(job.jobId)} &mdash; &copy; 2026 Cueljuris LLC &mdash; Read-only insurer view</p>
      </div>
    </div>`;

  res.send(layout(`Insurer View — ${job.jobId}`, content, '', req.session.user, req.session.shopFilter));
});

// ─── ADAS Reference ───────────────────────────────────────────────────────────

function getOEMPortal(make) {
  const m = (make || '').toLowerCase();
  if (m.includes('toyota') || m.includes('lexus') || m.includes('scion'))
    return 'Toyota Technical Information System (TIS) — Techstream / Techstream Lite';
  if (m.includes('ford') || m.includes('lincoln'))
    return 'Ford IDS or FDRS (Ford Diagnosis and Repair System)';
  if (m.includes('chev') || m.includes('gmc') || m.includes('buick') || m.includes('cadillac'))
    return 'GM GDS2';
  if (m.includes('chrysler') || m.includes('dodge') || m.includes('ram') || m.includes('jeep') || m.includes('fiat'))
    return 'Mopar wiTECH — techauthority.com';
  if (m.includes('honda') || m.includes('acura'))
    return 'Honda i-HDS with Denso DST-i VCI — techinfo.honda.com';
  if (m.includes('nissan') || m.includes('infiniti'))
    return 'Nissan/Infiniti CONSULT — nissan-techinfo.com';
  if (m.includes('kia') || m.includes('hyundai') || m.includes('genesis'))
    return 'Kia/Hyundai GDS (Global Diagnostic System)';
  if (m.includes('subaru'))
    return 'Subaru SSM4 / asTech remote — techinfo.subaru.com (STIS)';
  if (m.includes('mazda'))
    return 'Mazda diagnostic tool — oem1stop.com';
  if (m.includes('mercedes'))
    return 'Mercedes-Benz XENTRY — Startime for labor times';
  if (m.includes('jaguar'))
    return 'JLR Pathfinder — topix.jaguar.com';
  if (m.includes('land rover'))
    return 'JLR Pathfinder — topix.landrover.com';
  if (m.includes('volvo'))
    return 'Volvo VIDA (Vehicle Information and Diagnostics for Aftersales)';
  return 'Consult OEM service information for this vehicle make';
}

// GET /reference — ADAS Reference lookup page
app.get('/reference', requireAuth, (req, res) => {
  const makes = [
    'Toyota', 'Lexus', 'Scion',
    'Ford', 'Lincoln',
    'Chevrolet', 'GMC', 'Buick', 'Cadillac',
    'Chrysler', 'Dodge', 'Ram', 'Jeep', 'Fiat',
    'Honda', 'Acura',
    'Nissan', 'Infiniti',
    'Kia', 'Hyundai', 'Genesis',
    'Subaru', 'Mazda', 'Mercedes-Benz',
    'Jaguar', 'Land Rover', 'Volvo',
    'Tesla',
  ];

  const makeOptions = makes
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join('');

  const years = [];
  for (let y = 2026; y >= 2010; y--) years.push(y);
  const yearOptions = years.map(y => `<option value="${y}">${y}</option>`).join('');

  const content = `
    <div class="page-header">
      <div>
        <h1>ADAS OEM Reference</h1>
        <p class="ref-subtitle">OEM calibration standards by make, model, and year</p>
      </div>
    </div>

    <div class="ref-lookup-card">
      <form method="GET" action="/reference/lookup" class="ref-form">
        <div class="ref-form-steps">
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">1</span> Select Make</div>
            <select name="make" required class="ref-select">
              <option value="">&#8212; Select Make &#8212;</option>
              ${makeOptions}
            </select>
          </div>
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">2</span> Model</div>
            <input type="text" name="model" placeholder="e.g. Camry, Civic, F-150" class="ref-input">
          </div>
          <div class="ref-step">
            <div class="ref-step-label"><span class="ref-step-num">3</span> Year</div>
            <select name="year" class="ref-select">
              ${yearOptions}
            </select>
          </div>
          <div class="ref-step ref-step-submit">
            <button type="submit" class="btn btn-primary btn-lg">Look Up ADAS Requirements</button>
          </div>
        </div>
      </form>
    </div>

    <div class="ref-note">
      <span class="ref-note-icon">&#9432;</span>
      Calibration requirements shown are based on OEM position statements for the selected make.
      Always verify model-specific procedures in OEM service information.
    </div>`;

  res.send(layout('ADAS Reference', content, 'reference', req.session.user, req.session.shopFilter));
});

// GET /reference/lookup — Reference results
app.get('/reference/lookup', requireAuth, (req, res) => {
  const make  = (req.query.make  || '').trim();
  const model = (req.query.model || '').trim();
  const year  = (req.query.year  || '').trim();

  if (!make) return res.redirect('/reference');

  // Full data: all repairs checked to get every possible system for this make
  const allRepairs = [
    'Windshield', 'Front Camera Area', 'Front Bumper', 'Rear Bumper',
    'Radar', 'Wheel Alignment', 'Suspension', 'Side Mirror', 'Door', 'Mirror',
    'Airbag Deployment', 'Battery Disconnect', 'Air Bag', 'SRS', 'Disassembly',
    'Glass', 'Parking Sensor',
  ];
  const full = runADASEngine(make, model, year, allRepairs);

  // Per-category triggers for the triggers table
  const categories = [
    { label: 'Windshield / Front Camera Area',           repairs: ['Windshield', 'Front Camera Area', 'Glass'] },
    { label: 'Front Bumper / Radar',                     repairs: ['Front Bumper', 'Radar'] },
    { label: 'Rear Bumper',                              repairs: ['Rear Bumper', 'Parking Sensor'] },
    { label: 'Side Mirror / Door',                       repairs: ['Side Mirror', 'Door', 'Mirror'] },
    { label: 'Wheel Alignment / Suspension',             repairs: ['Wheel Alignment', 'Suspension'] },
    { label: 'Airbag Deployment / Battery Disconnect',   repairs: ['Airbag Deployment', 'Battery Disconnect', 'Air Bag', 'SRS', 'Disassembly'] },
  ];

  const triggerRows = categories.map(cat => {
    const catResult = runADASEngine(make, model, year, cat.repairs);
    const systems   = catResult.adasSystems
      ? catResult.adasSystems.split('\n').filter(Boolean)
      : [];

    if (systems.length === 0) {
      const isAirbagCat = cat.label.toLowerCase().includes('airbag') || cat.label.toLowerCase().includes('battery');
      if (isAirbagCat) {
        return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems">
          <div class="trigger-system-item">
            <span class="cal-type-badge cal-type-oem">SCAN</span>
            <span>Pre and post-repair scan required per OEM position statement &mdash; run full DTC/alert check</span>
          </div>
        </td>
      </tr>`;
      }
      return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems"><span class="trigger-none">&#10003; No calibration required for this make</span></td>
      </tr>`;
    }

    const systemsHtml = systems.map(s => {
      const isStatic  = /static/i.test(s);
      const isDynamic = /dynamic/i.test(s);
      const badge = isStatic
        ? '<span class="cal-type-badge cal-type-static">Static</span>'
        : isDynamic
          ? '<span class="cal-type-badge cal-type-dynamic">Dynamic</span>'
          : '<span class="cal-type-badge cal-type-oem">Per OEM</span>';
      return `<div class="trigger-system-item">${badge}<span>${escapeHtml(s)}</span></div>`;
    }).join('');

    return `
      <tr>
        <td class="trigger-type">${escapeHtml(cat.label)}</td>
        <td class="trigger-systems">${systemsHtml}</td>
      </tr>`;
  }).join('');

  const sourceCitation = full.sourceCitation || 'OEM Position Statement';

  const oemPortal = getOEMPortal(make);

  const vehicleDisplay = [year, make, model].filter(Boolean).join(' ');

  const content = `
    <div class="ref-back-bar no-print">
      <a href="/reference" class="btn btn-ghost">&larr; New Lookup</a>
      <span class="ref-vehicle-label">${escapeHtml(vehicleDisplay)}</span>
    </div>

    <div class="ref-card" id="refCard">

      <div class="ref-card-header">
        <div>
          <div class="ref-card-brand">CollisionIQ &mdash; ADAS OEM Reference</div>
          <div class="ref-card-vehicle">${escapeHtml(vehicleDisplay) || '&mdash;'}</div>
        </div>
        <div class="ref-card-actions no-print">
          <button onclick="window.print()" class="btn btn-white">&#128438; Print Reference Card</button>
        </div>
      </div>

      <!-- SECTION 1: OEM SCAN STANDARD -->
      <section class="ref-section">
        <h2 class="ref-section-title">&#9654; Section 1 &mdash; OEM Scan Standard</h2>
        <div class="ref-scan-grid">
          <div class="ref-scan-item">
            <div class="ref-scan-item-label">Pre-Repair Scan</div>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(full.preScanRequired)}">${escapeHtml(scanBadgeLabel(full.preScanRequired))}</span>
            <div class="ref-scan-detail">${escapeHtml(full.preScanRequired || 'RECOMMENDED')}</div>
          </div>
          <div class="ref-scan-item">
            <div class="ref-scan-item-label">Post-Repair Scan</div>
            <span class="badge scan-badge scan-badge-${scanBadgeClass(full.postScanRequired)}">${escapeHtml(scanBadgeLabel(full.postScanRequired))}</span>
            <div class="ref-scan-detail">${escapeHtml(full.postScanRequired || 'RECOMMENDED')}</div>
          </div>
        </div>
        <div class="ref-tool-row">
          <span class="ref-tool-icon">&#128295;</span>
          <span class="ref-tool-label">Approved Scan Tool</span>
          <span class="ref-tool-value">${escapeHtml(full.approvedScanTool)}</span>
        </div>
        <div class="ref-source-row">
          <span class="ref-source-label">Source</span>
          <span class="ref-source-value">${escapeHtml(sourceCitation)}</span>
        </div>
        ${make.toLowerCase().includes('tesla') ? `
        <div class="ref-tesla-note">
          <strong>Note:</strong> Tesla does not use standard DTCs. Tesla uses an alert-based diagnostic system.
          Toolbox 3 software required &mdash; not standard OBDII compatible.
        </div>` : ''}
      </section>

      <!-- SECTION 2: CALIBRATION TRIGGERS -->
      <section class="ref-section">
        <h2 class="ref-section-title">&#9654; Section 2 &mdash; Calibration Triggers by Repair Type</h2>
        <div class="ref-trigger-wrap">
          <table class="ref-trigger-table">
            <thead>
              <tr>
                <th>Repair Type</th>
                <th>Systems Requiring Calibration</th>
              </tr>
            </thead>
            <tbody>
              ${triggerRows}
            </tbody>
          </table>
        </div>
      </section>

      <!-- SECTION 3: LIABILITY & COMPLIANCE -->
      <section class="ref-section ref-liability-section">
        <h2 class="ref-section-title">&#9654; Section 3 &mdash; Liability &amp; Compliance Summary</h2>
        <div class="warning-box ref-liability-box">
          <span class="warning-icon">&#9888;</span>
          <p>${escapeHtml(full.liabilityWarning)}</p>
        </div>
        <div class="ref-notes-block">
          <div class="ref-notes-heading">${escapeHtml(make)}-Specific Notes</div>
          <div class="notes-box">
            <p>${escapeHtml(full.makeSpecificNotes)}</p>
          </div>
        </div>
        <div class="ref-oem-source-row">
          <span class="ref-oem-label">&#128196; OEM Repair Information</span>
          <span class="ref-oem-value">${escapeHtml(oemPortal)}</span>
        </div>
      </section>

      <!-- SECTION 4: QUICK ACTIONS -->
      <section class="ref-section ref-actions-section no-print">
        <h2 class="ref-section-title">&#9654; Section 4 &mdash; Quick Actions</h2>
        <div class="ref-action-buttons">
          <a href="/new?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${encodeURIComponent(year)}"
             class="btn btn-primary btn-lg">
            + Start New Job &mdash; ${escapeHtml(make)} ${escapeHtml(model)} ${escapeHtml(year)}
          </a>
          <button onclick="window.print()" class="btn btn-lg">
            &#128438; Print Reference Card
          </button>
        </div>
      </section>

      <div class="ref-watermark">
        SOURCE: OEM Position Statement &mdash; Calibration requirements are make-based.
        Always verify model-specific procedures in OEM service information.
      </div>

    </div>

    <div class="ref-note no-print" style="margin-top:1rem">
      <span class="ref-note-icon">&#9432;</span>
      Calibration requirements shown are based on OEM position statements for this make.
      Always verify model-specific procedures in OEM service information.
    </div>`;

  res.send(layout(`ADAS Reference \u2014 ${make}`, content, 'reference', req.session.user, req.session.shopFilter));
});

// ─── User Management (Shop Admin) ────────────────────────────────────────────

app.get('/admin/users', requireAdmin, shopScope, (req, res) => {
  const users = req.shopId
    ? db.prepare(`SELECT id, full_name, username, role, active, created_at FROM users WHERE shop_id=? ORDER BY created_at DESC`).all(req.shopId)
    : db.prepare(`SELECT id, full_name, username, role, active, created_at FROM users ORDER BY created_at DESC`).all();

  const roleOptions = ['shop_admin', 'qc_manager', 'technician', 'service_writer'];
  const roleSelect = roleOptions.map(r => `<option value="${r}">${r}</option>`).join('');

  const rows = users.map(u => `
    <tr>
      <td>${escapeHtml(u.full_name || '—')}</td>
      <td class="mono">${escapeHtml(u.username)}</td>
      <td><span class="badge badge-blue">${escapeHtml(u.role)}</span></td>
      <td><span class="badge badge-${u.active ? 'green' : 'gray'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <form method="POST" action="/admin/users/${u.id}/role" class="inline-form" style="display:inline">
          <select name="role" onchange="this.form.submit()" class="status-select">
            ${roleOptions.map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </form>
        ${u.active
          ? `<form method="POST" action="/admin/users/${u.id}/deactivate" class="inline-form" style="display:inline;margin-left:0.5rem">
               <button type="submit" class="btn btn-sm btn-ghost" onclick="return confirm('Deactivate ${escapeHtml(u.username)}?')">Deactivate</button>
             </form>`
          : ''}
      </td>
    </tr>`).join('');

  const content = `
    <div class="page-header">
      <h1>User Management <span class="count-badge">${users.length}</span></h1>
    </div>

    <div class="doc-section" style="margin-bottom:2rem">
      <h2 class="doc-section-title">Add New User</h2>
      <form method="POST" action="/admin/users/create" style="display:grid;gap:1rem;max-width:520px">
        <div class="form-group">
          <label>Full Name</label>
          <input type="text" name="full_name" placeholder="Jane Smith" required>
        </div>
        <div class="form-group">
          <label>Username</label>
          <input type="text" name="username" placeholder="jsmith" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>Temporary Password</label>
          <input type="password" name="password" placeholder="Temporary password" required autocomplete="new-password">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select name="role">${roleSelect}</select>
        </div>
        <button type="submit" class="btn btn-primary">Create User</button>
      </form>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Full Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows.length > 0 ? rows : '<tr><td colspan="5" class="empty">No users found.</td></tr>'}</tbody>
      </table>
    </div>`;

  res.send(layout('User Management', content, 'users', req.session.user, req.session.shopFilter));
});

app.post('/admin/users/create', requireAdmin, async (req, res) => {
  const { full_name, username, password, role } = req.body;
  const allowedRoles = ['shop_admin', 'qc_manager', 'technician', 'service_writer'];
  if (!allowedRoles.includes(role)) return res.status(400).send('Invalid role.');
  try {
    const hash = await bcrypt.hash(password, 10);
    db.prepare(`INSERT INTO users (shop_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)`)
      .run(req.session.user.shop_id, username, hash, role, full_name || '');
  } catch (e) {
    return res.redirect('/admin/users?error=Username+already+exists.');
  }
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/role', requireAdmin, (req, res) => {
  const allowedRoles = ['shop_admin', 'qc_manager', 'technician', 'service_writer'];
  const { role } = req.body;
  if (!allowedRoles.includes(role)) return res.status(400).send('Invalid role.');
  db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role, req.params.id);
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/deactivate', requireAdmin, (req, res) => {
  db.prepare(`UPDATE users SET active=0 WHERE id=?`).run(req.params.id);
  res.redirect('/admin/users');
});

// ─── Platform Admin — Shop Management ────────────────────────────────────────

app.get('/platform/shops', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare(`SELECT * FROM shops ORDER BY created_at DESC`).all();
  const rows = shops.map(s => {
    const userCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE shop_id=?`).get(s.id);
    const jobCount  = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE shop_id=?`).get(s.id);
    return `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.address || '—')}</td>
        <td>${escapeHtml(s.phone || '—')}</td>
        <td>${userCount.c}</td>
        <td>${jobCount.c}</td>
        <td>${formatDate(s.created_at)}</td>
      </tr>`;
  }).join('');

  const content = `
    <div class="page-header"><h1>Shops <span class="count-badge">${shops.length}</span></h1></div>

    <div class="doc-section" style="margin-bottom:2rem">
      <h2 class="doc-section-title">Onboard New Shop</h2>
      <form method="POST" action="/platform/shops/create" style="display:grid;gap:1rem;max-width:520px">
        <div class="form-group">
          <label>Shop Name <span class="req">*</span></label>
          <input type="text" name="shop_name" placeholder="Acme Collision Center" required>
        </div>
        <div class="form-group">
          <label>Address</label>
          <input type="text" name="address" placeholder="123 Main St, City, ST 00000">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="text" name="phone" placeholder="555-555-5555">
        </div>
        <hr>
        <h3 style="margin:0;font-size:0.95rem">Shop Admin Account</h3>
        <div class="form-group">
          <label>Admin Full Name <span class="req">*</span></label>
          <input type="text" name="admin_full_name" placeholder="John Doe" required>
        </div>
        <div class="form-group">
          <label>Admin Username <span class="req">*</span></label>
          <input type="text" name="admin_username" placeholder="jdoe" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>Temporary Password <span class="req">*</span></label>
          <input type="password" name="admin_password" placeholder="Temporary password" required autocomplete="new-password">
        </div>
        <button type="submit" class="btn btn-primary">Create Shop &amp; Admin Account</button>
      </form>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Shop Name</th><th>Address</th><th>Phone</th><th>Users</th><th>Jobs</th><th>Created</th></tr>
        </thead>
        <tbody>${rows.length > 0 ? rows : '<tr><td colspan="6" class="empty">No shops yet.</td></tr>'}</tbody>
      </table>
    </div>`;

  res.send(layout('Shops', content, 'shops', req.session.user, req.session.shopFilter));
});

app.post('/platform/shops/create', requirePlatformAdmin, async (req, res) => {
  const { shop_name, address, phone, admin_full_name, admin_username, admin_password } = req.body;
  if (!shop_name || !admin_username || !admin_password) {
    return res.status(400).send('Shop name, admin username, and password are required.');
  }
  const hash = await bcrypt.hash(admin_password, 10);
  const shopId = db.prepare(`INSERT INTO shops (name, address, phone) VALUES (?,?,?)`)
    .run(shop_name, address || '', phone || '').lastInsertRowid;
  db.prepare(`INSERT INTO users (shop_id, username, password_hash, role, full_name) VALUES (?,?,?,?,?)`)
    .run(shopId, admin_username, hash, 'shop_admin', admin_full_name || '');
  res.redirect('/platform/shops');
});

// GET /platform/billing — Billing overview for platform admin
app.get('/platform/billing', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare(`
    SELECT id, name, city, state,
           subscription_status, stripe_customer_id, stripe_subscription_id,
           subscription_current_period_end, grace_period_end, trial_end, created_at
    FROM shops ORDER BY name ASC
  `).all();

  const now = Math.floor(Date.now() / 1000);

  function statusBadgeB(s) {
    const cfg = {
      active:   ['#D6F0D6','#1A6B1A'],
      past_due: ['#FFF9CC','#7A6000'],
      grace:    ['#FFE8CC','#7A4000'],
      trial:    ['#E8EEF7','#1B3A6B'],
      inactive: ['#F0F0F0','#555555'],
    };
    const [bg, fg] = cfg[s] || cfg.inactive;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${bg};color:${fg}">${escapeHtml(s || 'inactive').toUpperCase()}</span>`;
  }

  function fmtUnix(ts) {
    if (!ts) return '—';
    return new Date(Number(ts) * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  }

  function maskId(id) {
    if (!id) return '—';
    return id.slice(0, 8) + '…' + id.slice(-4);
  }

  // Summary counts
  const counts = { active: 0, past_due: 0, grace: 0, inactive: 0, trial: 0 };
  for (const s of shops) {
    const st = s.subscription_status || 'inactive';
    counts[st] = (counts[st] || 0) + 1;
  }
  const atRisk = (counts.past_due || 0) + (counts.grace || 0);

  const summaryCards = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:1rem;margin-bottom:2rem">
      ${[
        ['Total Shops',  shops.length,          '#1B3A6B', '#fff'],
        ['Active',       counts.active || 0,     '#1A6B1A', '#D6F0D6'],
        ['At Risk',      atRisk,                 '#7A4000', '#FFE8CC'],
        ['Inactive',     counts.inactive || 0,   '#555555', '#F0F0F0'],
        ['Trial',        counts.trial || 0,      '#1B3A6B', '#E8EEF7'],
      ].map(([label, val, fg, bg]) => `
        <div style="background:${bg};border-radius:8px;padding:1rem;text-align:center">
          <div style="font-size:1.75rem;font-weight:700;color:${fg}">${val}</div>
          <div style="font-size:.8rem;color:${fg};opacity:.8;font-weight:600;margin-top:.25rem">${label}</div>
        </div>`).join('')}
    </div>`;

  const rows = shops.map(s => {
    const st      = s.subscription_status || 'inactive';
    const expired = s.subscription_current_period_end && Number(s.subscription_current_period_end) < now;
    const graceExpired = s.grace_period_end && Number(s.grace_period_end) < now;
    return `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong>${s.city ? `<br><span style="font-size:.8rem;color:#888">${escapeHtml(s.city)}${s.state ? ', '+escapeHtml(s.state) : ''}</span>` : ''}</td>
        <td>${statusBadgeB(st)}</td>
        <td style="font-family:monospace;font-size:.8rem">${maskId(s.stripe_customer_id)}</td>
        <td style="${expired ? 'color:#8B0000;font-weight:600' : ''}">${fmtUnix(s.subscription_current_period_end)}</td>
        <td style="${graceExpired ? 'color:#8B0000;font-weight:600' : s.grace_period_end ? 'color:#7A4000' : ''}">${fmtUnix(s.grace_period_end)}</td>
        <td>${formatDate(s.created_at)}</td>
      </tr>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Billing Overview <span class="count-badge">${shops.length}</span></h1>
      <a href="/register" class="btn btn-primary">+ New Shop Signup</a>
    </div>

    ${summaryCards}

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Shop</th>
            <th>Status</th>
            <th>Stripe Customer</th>
            <th>Period Ends</th>
            <th>Grace Ends</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length > 0 ? rows : '<tr><td colspan="6" class="empty">No shops yet.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  res.send(layout('Billing Overview', content, 'billing', req.session.user, req.session.shopFilter));
});

// POST /platform/shop-filter — Set shop switcher for platform_admin
app.post('/platform/shop-filter', requirePlatformAdmin, (req, res) => {
  const shopId = req.body.shop_id ? parseInt(req.body.shop_id) : null;
  req.session.shopFilter = shopId || null;
  res.redirect('back');
});

// GET /platform/demo-credentials — Platform admin only
app.get('/platform/demo-credentials', requirePlatformAdmin, (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY name').all();

  const shopBlocks = shops.map(shop => {
    const users = db.prepare(
      `SELECT username, role, full_name FROM users WHERE shop_id=? AND role != 'platform_admin' ORDER BY role, username`
    ).all(shop.id);
    const userRows = users.map(u =>
      `<tr><td class="mono">${escapeHtml(u.username)}</td><td><span class="badge badge-blue">${escapeHtml(u.role)}</span></td><td>${escapeHtml(u.full_name || '—')}</td></tr>`
    ).join('');
    return `
      <div class="doc-section" style="margin-bottom:1.5rem">
        <h2 class="doc-section-title">${escapeHtml(shop.name)}</h2>
        <table class="data-table" style="max-width:600px">
          <thead><tr><th>Username</th><th>Role</th><th>Full Name</th></tr></thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>`;
  }).join('');

  const content = `
    <div class="page-header">
      <h1>Demo Credentials</h1>
    </div>

    <div class="doc-section" style="background:#fffbea;border:1px solid #f0c040;border-radius:6px;padding:1rem 1.25rem;margin-bottom:2rem;max-width:600px">
      <p style="margin:0 0 0.5rem"><strong>All demo account password:</strong> <code>demo1234</code></p>
      <p style="margin:0 0 0.5rem"><strong>Platform admin password:</strong> <code>changeme123</code> &mdash; change this</p>
      <p style="margin:0;font-size:0.85rem;color:#666">These accounts are for development and testing only. Remove or deactivate before any production deployment.</p>
    </div>

    <form method="POST" action="/platform/reset-demo" style="margin-bottom:2rem"
          onsubmit="return confirm('Reset all demo jobs? This cannot be undone.')">
      <button type="submit" class="btn btn-ghost">&#8635; Reset Demo Jobs</button>
      <span style="font-size:0.8rem;color:#888;margin-left:0.75rem">Deletes demo jobs (RO-M, RO-N, RO-P, RO-S, RO-G) and re-seeds fresh ones</span>
    </form>

    ${shopBlocks}`;

  res.send(layout('Demo Credentials', content, 'demo', req.session.user, req.session.shopFilter));
});

// POST /platform/reset-demo — Delete and re-seed demo jobs
app.post('/platform/reset-demo', requirePlatformAdmin, async (req, res) => {
  // Delete demo jobs by RO prefix pattern
  db.prepare(`DELETE FROM jobs WHERE ro LIKE 'RO-M%' OR ro LIKE 'RO-N%' OR ro LIKE 'RO-P%' OR ro LIKE 'RO-S%' OR ro LIKE 'RO-G%'`).run();

  // Re-run the job seed inline
  const { DatabaseSync } = require('node:sqlite');
  const seedDb = new DatabaseSync('./collisioniq.db');
  const crypto = require('crypto');
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const demoJobs = [
    { shop: 'Metro Collision Center',   techUsername: 'metro_tech1',    track: 'general-maintenance', collision_grade: null,       ro: 'RO-M001', vin: '1HGCV1F3XLA025410', year: '2020', make: 'Honda',     model: 'Accord',        trim: 'Sport',   mileage: '45200', status: 'In Progress',         repairsPerformed: 'Customer reports rough idle. Oil change due.' },
    { shop: 'Metro Collision Center',   techUsername: 'metro_tech2',    track: 'general-maintenance', collision_grade: null,       ro: 'RO-M002', vin: '2T1BURHE0JC034301', year: '2018', make: 'Toyota',    model: 'Corolla',       trim: 'LE',      mileage: '62000', status: 'Calibration Complete', repairsPerformed: 'Full inspection. Rear brakes yellow.' },
    { shop: 'Metro Collision Center',   techUsername: 'metro_tech1',    track: 'post-collision',      collision_grade: 'MODERATE', ro: 'RO-M003', vin: '1G1ZD5ST4JF246849', year: '2018', make: 'Chevrolet', model: 'Malibu',        trim: 'LT',      mileage: '38900', status: 'In Progress',         repairsPerformed: 'Windshield' },
    { shop: 'Northside Auto Repair',    techUsername: 'north_tech1',    track: 'post-collision',      collision_grade: 'MINOR',    ro: 'RO-N001', vin: '1N4AL3AP7JC231503', year: '2018', make: 'Nissan',    model: 'Altima',        trim: 'S',       mileage: '51000', status: 'Created',             repairsPerformed: 'Rear Bumper' },
    { shop: 'Northside Auto Repair',    techUsername: 'north_tech1',    track: 'general-maintenance', collision_grade: null,       ro: 'RO-N002', vin: '1FTFW1ET5DFC10312', year: '2013', make: 'Ford',      model: 'F-150',         trim: 'XLT',     mileage: '97500', status: 'Calibration Complete', repairsPerformed: 'Oil change and tire rotation complete.' },
    { shop: 'Premier ADAS & Collision', techUsername: 'premier_tech1',  track: 'post-collision',      collision_grade: 'MAJOR',    ro: 'RO-P001', vin: '1C4RJFBG8FC198072', year: '2015', make: 'Jeep',      model: 'Grand Cherokee', trim: 'Limited', mileage: '89000', status: 'In Progress',         repairsPerformed: 'Structural Body Repair, Airbag / SRS Deployment' },
    { shop: 'Premier ADAS & Collision', techUsername: 'premier_tech2',  track: 'post-collision',      collision_grade: 'MODERATE', ro: 'RO-P002', vin: 'WBAJB0C51BC613615', year: '2011', make: 'BMW',       model: '535i',          trim: 'Base',    mileage: '74000', status: 'Created',             repairsPerformed: 'Front Bumper, Front Camera Area' },
    { shop: 'Southbelt Body Works',     techUsername: 'south_tech1',    track: 'general-maintenance', collision_grade: null,       ro: 'RO-S001', vin: '4T1BF1FK5CU147227', year: '2012', make: 'Toyota',    model: 'Camry',         trim: 'XLE',     mileage: '112000',status: 'Calibration Complete', repairsPerformed: 'Tire rotation. Battery test. All green.' },
    { shop: 'Southbelt Body Works',     techUsername: 'south_tech1',    track: 'post-collision',      collision_grade: 'MINOR',    ro: 'RO-S002', vin: '1FADP3F24EL381528', year: '2014', make: 'Ford',      model: 'Focus',         trim: 'SE',      mileage: '66000', status: 'In Progress',         repairsPerformed: 'Door / Mirror Repair' },
    { shop: 'Gulf Coast Auto Service',  techUsername: 'gulf_tech1',     track: 'post-collision',      collision_grade: 'MAJOR',    ro: 'RO-G001', vin: '5NPE24AF8FH089298', year: '2015', make: 'Hyundai',   model: 'Sonata',        trim: 'SE',      mileage: '94000', status: 'Closed',             repairsPerformed: 'Structural Body Repair, Airbag / SRS Deployment' },
    { shop: 'Gulf Coast Auto Service',  techUsername: 'gulf_tech1',     track: 'general-maintenance', collision_grade: null,       ro: 'RO-G002', vin: '1GNSKCKC8FR672786', year: '2015', make: 'Chevrolet', model: 'Tahoe',         trim: 'LT',      mileage: '58000', status: 'Created',             repairsPerformed: 'Oil change due. AC check requested.' },
  ];

  const validStatuses = ['Created', 'In Progress', 'Calibration Complete', 'Closed'];
  let seeded = 0;
  for (const job of demoJobs) {
    const shop = seedDb.prepare('SELECT id FROM shops WHERE name=?').get(job.shop);
    const tech = seedDb.prepare('SELECT id, full_name FROM users WHERE username=?').get(job.techUsername);
    if (!shop || !tech) continue;
    const jobId      = `CIQ-${today.replace(/-/g,'')}-${Math.floor(1000+Math.random()*9000)}`;
    const shareToken = crypto.randomBytes(16).toString('hex');
    const status     = validStatuses.includes(job.status) ? job.status : 'Created';
    seedDb.prepare(`INSERT INTO jobs (jobId,ro,vin,year,make,model,trim,technicianName,assigned_tech,track,collision_grade,mileage,service_date,repairsPerformed,status,shareToken,shareUrl,createdAt,updatedAt,shop_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(jobId,job.ro,job.vin,job.year,job.make,job.model,job.trim||'',tech.full_name,tech.full_name,job.track,job.collision_grade||null,job.mileage||'',today,job.repairsPerformed||'',status,shareToken,`/share/${shareToken}`,now,now,shop.id,tech.id);
    seeded++;
  }

  console.log(`Demo reset: seeded ${seeded} jobs`);
  res.redirect('/platform/demo-credentials');
});

// ─── Seed Platform Admin ──────────────────────────────────────────────────────

async function seedPlatformAdmin() {
  const existing = db.prepare(`SELECT id FROM users WHERE role='platform_admin'`).get();
  if (!existing) {
    const hash = await bcrypt.hash('changeme123', 10);
    db.prepare(`INSERT INTO users (shop_id, username, password_hash, role, full_name) VALUES (NULL,'platform_admin',?,'platform_admin','Cueljuris LLC')`)
      .run(hash);
    console.log('Platform admin created. Username: platform_admin / Password: changeme123');
    console.log('CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.');
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────

seedPlatformAdmin().then(() => {
  app.listen(PORT, () => {
    console.log(`CollisionIQ running on http://localhost:${PORT}`);
  });
});
