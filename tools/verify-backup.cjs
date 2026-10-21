'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

(async () => {
  const root = path.resolve(__dirname, '..');
  const file = path.resolve(process.argv[2] || '');
  const directory = path.join(root, 'dist', 'backups');
  if (!file.startsWith(directory + path.sep) || !file.endsWith('.tar.gz.enc'))
    throw Error('Select an encrypted backup inside dist/backups.');
  const size = fs.statSync(file).size,
    header = Buffer.alloc(27),
    tag = Buffer.alloc(16);
  const handle = fs.openSync(file, 'r');
  fs.readSync(handle, header, 0, header.length, 0);
  fs.readSync(handle, tag, 0, 16, size - 16);
  fs.closeSync(handle);
  const marker = Buffer.from('BELES-BACKUP-1\n');
  if (!header.subarray(0, marker.length).equals(marker)) throw Error('Unsupported backup.');
  const name = path.basename(file).replace('.tar.gz.enc', '');
  const key = fs.readFileSync(path.join(directory, 'keys', name + '.key'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(marker.length));
  decipher.setAuthTag(tag);
  let pending = Buffer.alloc(0),
    entry = null,
    remaining = 0,
    padding = 0;
  const entries = [],
    documents = {};
  const parser = new Writable({
    write(chunk, _encoding, callback) {
      try {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length) {
          if (remaining) {
            const count = Math.min(remaining, pending.length),
              bytes = pending.subarray(0, count);
            entry.hash.update(bytes);
            if (entry.document) entry.parts.push(bytes);
            pending = pending.subarray(count);
            remaining -= count;
            if (!remaining) {
              entries.push({
                path: entry.path,
                bytes: entry.bytes,
                sha256: entry.hash.digest('hex'),
              });
              if (entry.document)
                documents[entry.path] = JSON.parse(Buffer.concat(entry.parts).toString('utf8'));
              entry = null;
            }
          } else if (padding) {
            const count = Math.min(padding, pending.length);
            pending = pending.subarray(count);
            padding -= count;
          } else {
            if (pending.length < 512) break;
            const block = pending.subarray(0, 512);
            pending = pending.subarray(512);
            if (block.every((b) => b === 0)) continue;
            const filename = block.subarray(0, 100).toString().replace(/\0.*$/s, '');
            const bytes = parseInt(
              block.subarray(124, 136).toString().replace(/\0.*$/s, '').trim() || '0',
              8,
            );
            const type = block[156];
            if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('Invalid tar size.');
            padding = (512 - (bytes % 512)) % 512;
            remaining = bytes;
            const document =
              ['data/admin.json', 'data/catalog.json', 'data/feedback.json'].includes(filename) &&
              bytes < 3 * 1024 * 1024;
            entry = {
              path: filename,
              bytes,
              hash: crypto.createHash('sha256'),
              document,
              parts: [],
            };
            if (!bytes) {
              if (type !== 53)
                entries.push({ path: filename, bytes: 0, sha256: entry.hash.digest('hex') });
              entry = null;
            }
          }
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
  await pipeline(
    fs.createReadStream(file, { start: header.length, end: size - 17 }),
    decipher,
    zlib.createGunzip(),
    parser,
  );
  if (remaining || padding || pending.length) throw Error('Incomplete archive.');
  if (!documents['data/admin.json'] || !Array.isArray(documents['data/catalog.json']))
    throw Error('Required records missing.');
  const summary = {
    encryptedArchive: path.basename(file),
    verifiedAt: new Date().toISOString(),
    mediaFiles: entries.filter((e) => e.path.startsWith('uploads/')).length,
    catalogRecords: documents['data/catalog.json'].length,
    administrators: (documents['data/admin.json'].users || [documents['data/admin.json']]).length,
    files: entries.length,
    authenticatedEncryption: 'AES-256-GCM verified',
    entries,
  };
  fs.writeFileSync(
    path.join(directory, name + '.manifest.json'),
    JSON.stringify(summary, null, 2),
    { mode: 0o600 },
  );
  delete summary.entries;
  console.log(JSON.stringify(summary));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
