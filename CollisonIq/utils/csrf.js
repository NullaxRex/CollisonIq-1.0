'use strict';

const crypto = require('crypto');

// Paths exempt from CSRF checks — the Stripe webhook is verified by its own
// signature (see server.js) and never carries a session or form token.
const CSRF_EXEMPT_PATHS = new Set(['/api/billing/webhook']);

// Multipart (file upload) routes can't be checked by the global middleware,
// because the _csrf field only becomes readable after multer parses the
// body — which happens inside the route itself, after this middleware has
// already run. Routes matching these patterns are expected to call
// csrfTokenValid(req) manually, immediately after their upload middleware.
const CSRF_EXEMPT_PATTERNS = [
  /^\/jobs\/[^/]+\/photos\/[^/]+$/,
];

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
 * Standalone boolean check — for routes exempted from the global middleware
 * (multipart uploads) that must verify CSRF manually after their own
 * body-parsing middleware (e.g. multer) has run.
 */
function csrfTokenValid(req) {
  const sessionToken = req.session && req.session.csrfToken;
  const submitted = req.body && req.body._csrf;
  return !!(sessionToken && submitted && submitted === sessionToken);
}

/**
 * Express middleware: rejects state-changing requests whose submitted
 * `_csrf` field doesn't match the token stored in the requester's own
 * session. Mount this AFTER the session middleware and AFTER body parsers.
 */
function verifyCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  if (CSRF_EXEMPT_PATTERNS.some(p => p.test(req.path))) return next();

  if (!csrfTokenValid(req)) {
    return res.status(403).send('Invalid or expired form token. Please go back, refresh the page, and try again.');
  }
  next();
}

module.exports = { csrfField, verifyCsrf, ensureCsrfToken, csrfTokenValid };
