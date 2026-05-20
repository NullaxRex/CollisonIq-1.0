'use strict';

require('dotenv').config();

// ─── Redirect to correct entry point ─────────────────────────────────────────
// This file is intentionally empty. The application runs from CollisionIq/server.js
// Railway start command: node CollisionIq/server.js

console.log('Root server.js loaded — this should not happen.');
console.log('Set Railway start command to: node CollisionIq/server.js');
process.exit(1);
