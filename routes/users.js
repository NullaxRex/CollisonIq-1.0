// /routes/users.js
// Shop admin user management — add/deactivate sub-users.
// Mount in server.js: app.use('/', require('./routes/users'));

'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();
const SALT_ROUNDS = 12;

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'shop_admin') {
    return res.redirect('/login');
  }
  next();
}

function usersPage(users, success, error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Manage Users — CollisionIQ</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh;padding:2rem}
    .container{max-width:800px;margin:0 auto}
    h1{font-size:1.5rem;color:#1B3A6B;margin-bottom:.25rem}
    .sub{color:#666;font-size:.85rem;margin-bottom:2rem}
    .card{background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.09);padding:2rem;margin-bottom:2rem}
    h2{font-size:1.1rem;color:#1B3A6B;margin-bottom:1.25rem}
    label{display:block;font-size:.8rem;font-weight:600;color:#444;margin-bottom:.3rem;margin-top:1rem}
    input,select{width:100%;border:1px solid #ccd1d9;border-radius:6px;padding:.6rem .75rem;font-size:.95rem}
    input:focus,select:focus{outline:none;border-color:#1B3A6B}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    .btn{margin-top:1.5rem;padding:.65rem 1.5rem;background:#1B3A6B;color:#fff;border:none;border-radius:6px;font-size:.95rem;font-weight:600;cursor:pointer}
    .btn:hover{background:#14316b}
    .btn-danger{background:#c0392b;font-size:.8rem;padding:.35rem .85rem;margin-top:0}
    .btn-danger:hover{background:#a93226}
    .success{background:#e0f7e9;color:#1a6b3a;border-radius:6px;padding:.6rem .9rem;font-size:.85rem;margin-bottom:1rem}
    .error{background:#ffe0e0;color:#8b0000;border-radius:6px;padding:.6rem .9rem;font-size:.85rem;margin-bottom:1rem}
    table{width:100%;border-collapse:collapse;font-size:.9rem}
    th{text-align:left;padding:.6rem .75rem;border-bottom:2px solid #e8eaf0;color:#666;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em}
    td{padding:.65rem .75rem;border-bottom:1px solid #f0f2f5;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    .badge{display:inline-block;padding:.2rem .6rem;border-radius:20px;font-size:.75rem;font-weight:600}
    .badge-admin{background:#e8f0fe;color:#1B3A6B}
    .badge-tech{background:#e8f7e9;color:#1a6b3a}
    .badge-qc{background:#fff3e0;color:#7a4500}
    .badge-writer{background:#f3e5f5;color:#5c007a}
    .badge-inactive{background:#f0f0f0;color:#999}
    .back{display:inline-block;margin-bottom:1.5rem;color:#1B3A6B;font-size:.85rem;text-decoration:none;font-weight:600}
    .back:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back">&larr; Back to Dashboard</a>
    <h1>Manage Users</h1>
    <p class="sub">Add technicians and staff to your shop account</p>

    ${success ? `<p class="success">${success}</p>` : ''}
    ${error ? `<p class="error">${error}</p>` : ''}

    <!-- Add User Form -->
    <div class="card">
      <h2>Add New User</h2>
      <form method="POST" action="/settings/users">
        <div class="row">
          <div>
            <label for="full_name">Full Name</label>
            <input id="full_name" name="full_name" required placeholder="Jane Smith">
          </div>
          <div>
            <label for="role">Role</label>
            <select id="role" name="role" required>
              <option value="">— Select Role —</option>
              <option value="technician">Technician</option>
              <option value="qc_manager">QC Manager</option>
              <option value="service_writer">Service Writer</option>
            </select>
          </div>
        </div>
        <label for="email">Email Address</label>
        <input id="email" name="email" type="email" required placeholder="jane@acmeautobody.com">
        <div class="row">
          <div>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" required placeholder="Minimum 8 characters">
          </div>
          <div>
            <label for="password_confirm">Confirm Password</label>
            <input id="password_confirm" name="password_confirm" type="password" required placeholder="Repeat password">
          </div>
        </div>
        <button type="submit" class="btn">Add User</button>
      </form>
    </div>

    <!-- Current Users Table -->
    <div class="card">
      <h2>Current Users</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${u.full_name}</td>
              <td>${u.email}</td>
              <td>
                <span class="badge ${
                  u.role === 'shop_admin'   ? 'badge-admin' :
                  u.role === 'technician'   ? 'badge-tech'  :
                  u.role === 'qc_manager'   ? 'badge-qc'    :
                  u.role === 'service_writer'? 'badge-writer': ''
                }">${u.role.replace('_', ' ')}</span>
              </td>
              <td>
                <span class="badge ${u.active ? '' : 'badge-inactive'}">
                  ${u.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td>
                ${u.role !== 'shop_admin' && u.active ? `
                  <form method="POST" action="/settings/users/${u.id}/deactivate" style="display:inline">
                    <button type="submit" class="btn btn-danger">Remove</button>
                  </form>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

// ── GET /settings/users ────────────────────────────────────────────────────
router.get('/settings/users', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT * FROM users WHERE shop_id = ? ORDER BY created_at ASC'
  ).all(req.session.shop.id);

  const successMap = { added: 'User added successfully.', removed: 'User removed.' };
  const errorMap = {
    fields:    'All fields are required.',
    passwords: 'Passwords do not match.',
    short:     'Password must be at least 8 characters.',
    exists:    'A user with that email already exists.',
  };

  const success = successMap[req.query.success] || null;
  const error   = errorMap[req.query.error]     || null;

  res.send(usersPage(users, success, error));
});

// ── POST /settings/users ───────────────────────────────────────────────────
router.post('/settings/users', requireAdmin, async (req, res) => {
  const { full_name, email, role, password, password_confirm } = req.body;

  if (!full_name || !email || !role || !password) {
    return res.redirect('/settings/users?error=fields');
  }
  if (password !== password_confirm) {
    return res.redirect('/settings/users?error=passwords');
  }
  if (password.length < 8) {
    return res.redirect('/settings/users?error=short');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.redirect('/settings/users?error=exists');
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  db.prepare(`
    INSERT INTO users (shop_id, username, full_name, email, password_hash, role, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(req.session.shop.id, email, full_name, email, password_hash, role);

  res.redirect('/settings/users?success=added');
});

// ── POST /settings/users/:id/deactivate ───────────────────────────────────
router.post('/settings/users/:id/deactivate', requireAdmin, (req, res) => {
  db.prepare(`
    UPDATE users SET active = 0 WHERE id = ? AND shop_id = ? AND role != 'shop_admin'
  `).run(req.params.id, req.session.shop.id);

  res.redirect('/settings/users?success=removed');
});

module.exports = router;
