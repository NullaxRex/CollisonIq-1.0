'use strict';
// Shared helpers for the test scripts. Everything is relative to the repo, and
// every test gets its own throwaway folder under the OS temp directory.
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const REPO_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.join(REPO_DIR, 'CollisonIq');

// Fresh, empty temp folder for one test run's databases and uploads.
function makeTempDir(prefix = 'ciq-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Ask the OS for a free TCP port.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

// Simple PASS/FAIL recorder shared by the non-HTTP suites.
function reporter() {
  let failures = 0;
  const check = (name, ok, info = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
    if (!ok) failures++;
  };
  return { check, get failures() { return failures; } };
}

module.exports = { REPO_DIR, APP_DIR, makeTempDir, freePort, reporter };
