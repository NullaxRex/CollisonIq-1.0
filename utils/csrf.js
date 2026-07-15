'use strict';

const crypto = require('crypto');

// Paths exempt from CSRF checks — the Stripe webhook is verified by its own
// signature (see server.js) and never carries a session or form token.
const CSRF_EXEMPT_PATHS = new Set(['/api/billing/webhook']);

/**
 * Returns the current session's CSRF token, generating one if it doesn't
 * exist yet. Call this whenever you need the value (e.g. to render a form).
 */
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/**
 * Renders a hidden <input> carrying the current session's CSRF token.
 * Drop this immediately inside every <form method="POST"> (or PUT/PATCH/DELETE).
 *   `<form method="POST" action="/jobs">${csrfField(req)}...`
 */
function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${ensureCsrfToken(req)}">`;
}

/**
 * Express middleware: rejects state-changing requests whose submitted
 * `_csrf` field doesn't match the token stored in the requester's own
 * session. Mount this AFTER the session middleware and AFTER body parsers.
 */
function verifyCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const sessionToken = req.session && req.session.csrfToken;
  const submitted = req.body && req.body._csrf;

  if (!sessionToken || !submitted || submitted !== sessionToken) {
    return res.status(403).send('Invalid or expired form token. Please go back, refresh the page, and try again.');
  }
  next();
}

module.exports = { csrfField, verifyCsrf, ensureCsrfToken };
