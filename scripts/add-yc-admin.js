'use strict';

const bcrypt = require('bcrypt');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'collisioniq.db');
const db = new DatabaseSync(DB_PATH);

async function main() {
  // Check for existing platform_admin to avoid touching it
  const existing = db.prepare(`SELECT id, username, role FROM users WHERE username = 'platform_admin'`).get();
  if (existing) {
    console.log('Existing platform_admin account (will NOT be modified):');
    console.log(' ', existing);
  }

  // Check if yc_admin already exists
  const alreadyExists = db.prepare(`SELECT id, username, role FROM users WHERE username = 'yc_admin'`).get();
  if (alreadyExists) {
    console.log('\nyc_admin account already exists — aborting to avoid duplicates:');
    console.log(' ', alreadyExists);
    process.exit(0);
  }

  // Hash the password
  const hash = await bcrypt.hash('CollisionIQ2026!', 10);

  // Insert new platform_admin demo account
  db.prepare(
    `INSERT INTO users (shop_id, username, password_hash, role, full_name, active)
     VALUES (NULL, 'yc_admin', ?, 'platform_admin', 'YC Demo Admin', 1)`
  ).run(hash);

  // Verify
  const created = db.prepare(`SELECT id, username, role FROM users WHERE username = 'yc_admin'`).get();
  console.log('\nyc_admin account created successfully:');
  console.log(' ', created);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
