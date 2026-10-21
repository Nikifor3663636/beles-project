'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-outage-'));
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '34306',
      HOST: '127.0.0.1',
      BELES_STORAGE_DIR: directory,
      DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/beles',
      PUBLIC_URL: 'http://127.0.0.1:34306',
      MEDIA_DRIVER: 'volume',
      MEDIA_READ_REMOTE: 'false',
    },
  });
  let logs = '';
  child.stdout.on('data', (x) => (logs += x));
  child.stderr.on('data', (x) => (logs += x));
  try {
    for (let i = 0; i < 100 && !logs.includes('Beles:'); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.match(logs, /Beles:/);
    assert.ok(!logs.includes('one-time setup code'));
    assert.ok(!logs.includes('invalid:invalid'));
    for (const route of ['/health', '/api/status', '/']) {
      const response = await fetch('http://127.0.0.1:34306' + route);
      assert.equal(response.status, 503, route);
    }
    const setup = await fetch('http://127.0.0.1:34306/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attacker', password: 'attacker-password-2026' }),
    });
    assert.equal(setup.status, 503);
    assert.equal(fs.existsSync(path.join(directory, 'data/admin.json')), false);
    console.log(
      'PASS: unavailable configured PostgreSQL returns 503, never opens setup or silently uses JSON, no credentials in logs.',
    );
  } finally {
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('beles-outage-')
    )
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
