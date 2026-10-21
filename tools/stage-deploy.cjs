'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const destination = path.join(
  root,
  'dist',
  'deploy-' + new Date().toISOString().replace(/[:.]/g, '-'),
);
fs.mkdirSync(destination, { recursive: true });
for (const file of fs
  .readdirSync(root)
  .filter(
    (name) =>
      name.endsWith('.cjs') &&
      !name.startsWith('test') &&
      !['download-assets.cjs', 'localize-assets.cjs'].includes(name),
  ))
  fs.copyFileSync(path.join(root, file), path.join(destination, file));
for (const file of [
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'docker-entrypoint.sh',
  '.dockerignore',
])
  fs.copyFileSync(path.join(root, file), path.join(destination, file));
for (const directory of ['public', 'db', 'tools'])
  fs.cpSync(path.join(root, directory), path.join(destination, directory), { recursive: true });
fs.mkdirSync(path.join(destination, 'data'));
for (const file of ['base.html', 'catalog.json'])
  fs.copyFileSync(path.join(root, 'data', file), path.join(destination, 'data', file));
const files = [];
function inspect(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw Error('Symbolic links are not allowed in a release.');
    if (item.isDirectory()) {
      inspect(file);
      continue;
    }
    if (
      /^\.env(?:\.|$)|\.(?:key|enc)$/.test(item.name) ||
      ['admin.json', 'sessions.json', 'feedback.json', 'audit.json', 'site-design.json'].includes(
        item.name,
      )
    )
      throw Error('Private file detected; release refused.');
    files.push({
      path: path.relative(destination, file).replaceAll('\\', '/'),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    });
  }
}
inspect(destination);
fs.writeFileSync(
  path.join(destination, 'release-manifest.json'),
  JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2),
);
console.log(
  JSON.stringify({
    directory: destination,
    files: files.length,
    privateDataIncluded: false,
    uploadsIncluded: false,
  }),
);
