'use strict';
// Private, encrypted off-volume backup requested in Beles_TZ.pdf, section 1.
// No account records, contact messages, media contents or encryption keys go to stdout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'dist', 'backups');
  const keyDirectory = path.join(directory, 'keys');
  fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const name = 'beles-before-tz-' + new Date().toISOString().replace(/[:.]/g, '-');
  const key = crypto.randomBytes(32),
    iv = crypto.randomBytes(12);
  const file = path.join(directory, name + '.tar.gz.enc');
  fs.writeFileSync(path.join(keyDirectory, name + '.key'), key, { flag: 'wx', mode: 0o600 });
  const output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([Buffer.from('BELES-BACKUP-1\n'), iv]));
  const child = spawn(
    path.join(
      root,
      'dist/npm-cache/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway.exe',
    ),
    [
      'ssh',
      '--service',
      '6c99fbf2-ab4d-46dc-af4d-037d703e2efe',
      '-i',
      'C:/Users/vampw/.ssh/id_ed25519_beles_railway',
      '--',
      'sh',
      '-c',
      'tar --exclude=*.tmp -C /beles-storage -czf - data uploads',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let errorOutput = '';
  child.stderr.on('data', (chunk) => {
    errorOutput = (errorOutput + chunk).slice(-2000);
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(Error('Backup transport failed: ' + code)),
    );
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  await Promise.all([pipeline(child.stdout, cipher, output), exit]);
  fs.appendFileSync(file, cipher.getAuthTag());
  console.log(
    JSON.stringify({
      encryptedBackup: path.relative(root, file),
      bytes: fs.statSync(file).size,
      status: 'created; verification required',
    }),
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
