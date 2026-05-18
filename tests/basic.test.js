const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('project scaffold exposes required runtime files', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['server.js', 'package.json', 'public/index.html', 'public/demo-fintech.html']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  }
});

test('package scripts include demo start commands', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.start, 'node server.js');
  assert.equal(pkg.scripts.dev, 'node server.js');
  assert.ok(pkg.dependencies.express);
  assert.ok(pkg.dependencies['@playwright/test']);
});
