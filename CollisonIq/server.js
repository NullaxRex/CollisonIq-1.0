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

// safe column additions
const addCols = [
  ['jobs','mileage','TEXT'], ['jobs','service_date','TEXT'], ['jobs','assigned_tech','TEXT'],
  ['jobs','impact_areas','TEXT'], ['jobs','photo_status','TEXT'],
];
for (const [tbl, col, def] of addCols) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch(e) {}
}

// ─── Stripe billing migration ─────────────────────────────────────────────────
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
    if (hasWindshield) { systems.push('PCS Static Calibration — TSS Camera (Static, target board required)'); rationale.push('Toyo
