'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(root, process.argv[2] || '');
if (!directory.startsWith(path.join(root, 'dist') + path.sep))
  throw Error('Expected prepared package in dist');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json')));
for (const entry of manifest.files) {
  const file = path.resolve(directory, entry.path);
  if (!file.startsWith(directory + path.sep) || fs.lstatSync(file).isSymbolicLink())
    throw Error('Unsafe package path');
  if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256)
    throw Error('Package changed: ' + entry.path);
}
const cli = path.join(
  root,
  'dist/npm-cache/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway.exe',
);
const result = spawnSync(
  cli,
  [
    'up',
    directory,
    '--path-as-root',
    '--no-gitignore',
    '--project',
    'ee1e2642-d110-4109-86c4-7a2890a14bac',
    '--service',
    '6c99fbf2-ab4d-46dc-af4d-037d703e2efe',
    '--environment',
    '05cfe2ad-8310-4fab-ba28-34be9c7605a4',
    '--detach',
    '--json',
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
