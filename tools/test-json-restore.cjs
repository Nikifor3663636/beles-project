'use strict';
// Exercise a real encrypted snapshot in a private temporary directory, never the live Volume.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  zlib = require('node:zlib');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn, spawnSync } = require('node:child_process');
async function main() {
  const root = path.resolve(__dirname, '..'),
    archive = path.resolve(process.argv[2] || ''),
    name = path.basename(archive, '.tar.gz.enc');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(path.dirname(archive), name + '.manifest.json'), 'utf8'),
  );
  if (!manifest.verifiedAt) throw Error('Verify the encrypted archive first.');
  const key = fs.readFileSync(path.join(path.dirname(archive), 'keys', name + '.key'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-restore-proof-'));
  let child;
  try {
    fs.chmodSync(directory, 0o700);
    if (process.platform === 'win32') {
      const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const sid = identity.stdout?.match(/S-1-5-[\d-]+/)?.[0];
      if (!sid) throw Error('Cannot identify the private restore owner.');
      const acl = spawnSync(
        'icacls.exe',
        [directory, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'],
        { encoding: 'utf8', windowsHide: true },
      );
      if (acl.status !== 0)
        throw Error('Private NTFS permissions could not be set; no plaintext restored.');
    }
    const size = fs.statSync(archive).size,
      handle = fs.openSync(archive, 'r'),
      header = Buffer.alloc(27),
      tag = Buffer.alloc(16);
    fs.readSync(handle, header, 0, 27, 0);
    fs.readSync(handle, tag, 0, 16, size - 16);
    fs.closeSync(handle);
    if (header.subarray(0, 15).toString() !== 'BELES-BACKUP-1\n' || key.length !== 32)
      throw Error('Invalid archive/key.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(15));
    decipher.setAuthTag(tag);
    let pending = Buffer.alloc(0),
      remaining = 0,
      padding = 0,
      entry = null;
    const restored = [];
    const parser = new Writable({
      write(chunk, encoding, done) {
        try {
          pending = Buffer.concat([pending, chunk]);
          while (pending.length) {
            if (remaining) {
              const count = Math.min(remaining, pending.length),
                bytes = pending.subarray(0, count);
              fs.writeSync(entry.fd, bytes);
              entry.hash.update(bytes);
              remaining -= count;
              pending = pending.subarray(count);
              if (!remaining) {
                fs.closeSync(entry.fd);
                restored.push({
                  path: entry.name,
                  bytes: entry.bytes,
                  sha256: entry.hash.digest('hex'),
                });
                entry = null;
              }
            } else if (padding) {
              const count = Math.min(padding, pending.length);
              padding -= count;
              pending = pending.subarray(count);
            } else {
              if (pending.length < 512) break;
              const block = pending.subarray(0, 512);
              pending = pending.subarray(512);
              if (block.every((b) => b === 0)) continue;
              const name = block.subarray(0, 100).toString().replace(/\0.*$/s, ''),
                kind = block[156],
                bytes = parseInt(
                  block.subarray(124, 136).toString().replace(/\0.*$/s, '').trim() || '0',
                  8,
                );
              if (
                !/^(data|uploads)\//.test(name) ||
                name.includes('..') ||
                path.isAbsolute(name) ||
                name.includes('\\')
              )
                throw Error('Unsafe archive path.');
              const target = path.resolve(directory, name);
              if (!target.startsWith(directory + path.sep))
                throw Error('Restore path escaped the private directory.');
              if (kind === 53) {
                fs.mkdirSync(target, { recursive: true, mode: 0o700 });
                continue;
              }
              if (![0, 48].includes(kind) || !Number.isSafeInteger(bytes) || bytes < 0)
                throw Error('Unsupported archive entry. Links are never restored.');
              fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
              entry = {
                name,
                bytes,
                fd: fs.openSync(target, 'wx', 0o600),
                hash: crypto.createHash('sha256'),
              };
              remaining = bytes;
              padding = (512 - (bytes % 512)) % 512;
              if (!remaining) {
                fs.closeSync(entry.fd);
                restored.push({ path: name, bytes, sha256: entry.hash.digest('hex') });
                entry = null;
              }
            }
          }
          done();
        } catch (error) {
          if (entry?.fd !== undefined)
            try {
              fs.closeSync(entry.fd);
            } catch {}
          done(error);
        }
      },
    });
    await pipeline(
      fs.createReadStream(archive, { start: 27, end: size - 17 }),
      decipher,
      zlib.createGunzip(),
      parser,
    );
    if (remaining || padding || pending.length) throw Error('Incomplete restore.');
    const expected = new Map(manifest.entries.map((e) => [e.path, e]));
    if (restored.length !== expected.size) throw Error('Restored file count differs.');
    for (const item of restored) {
      const original = expected.get(item.path);
      if (!original || original.bytes !== item.bytes || original.sha256 !== item.sha256)
        throw Error('Restored file checksum differs.');
    }
    const catalogue = fs.readFileSync(path.join(directory, 'data/catalog.json')),
      admin = fs.readFileSync(path.join(directory, 'data/admin.json'));
    child = spawn(process.execPath, ['server.cjs'], {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        BELES_STORAGE_DIR: directory,
        DATABASE_URL: '',
        MEDIA_DRIVER: 'volume',
        MEDIA_READ_REMOTE: 'false',
        PORT: '34307',
        HOST: '127.0.0.1',
        PUBLIC_URL: 'http://127.0.0.1:34307',
        COOKIE_SECURE: 'false',
        COOPERATION_APPROVED: 'false',
      },
    });
    let started = false;
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Beles:')) started = true;
    });
    child.stderr.resume();
    for (let i = 0; i < 100 && !started; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (!started) throw Error('Restored application did not start; private logs are not printed.');
    if (
      !(await fetch('http://127.0.0.1:34307/health')).ok ||
      !(await fetch('http://127.0.0.1:34307/')).ok
    )
      throw Error('Restored application HTTP check failed.');
    const status = await (await fetch('http://127.0.0.1:34307/api/status')).json();
    if (!status.configured || status.authenticated)
      throw Error('Restore unexpectedly reopened setup.');
    if (
      !catalogue.equals(fs.readFileSync(path.join(directory, 'data/catalog.json'))) ||
      !admin.equals(fs.readFileSync(path.join(directory, 'data/admin.json')))
    )
      throw Error('Startup changed account or catalogue bytes.');
    const report = {
      at: new Date().toISOString(),
      archive: path.basename(archive),
      files: restored.length,
      mediaFiles: manifest.mediaFiles,
      catalogRecords: manifest.catalogRecords,
      accountAndCatalogueBytesUnchanged: true,
      allChecksumsMatched: true,
      http200: true,
      setupClosed: true,
      privateTemporaryRestore: true,
    };
    fs.writeFileSync(
      path.join(root, 'dist/backups/restore-test.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(report);
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
    const actual = fs.realpathSync(directory),
      temporary = fs.realpathSync(os.tmpdir());
    if (
      path.dirname(actual) !== temporary ||
      !path.basename(actual).startsWith('beles-restore-proof-')
    )
      throw Error('Refusing cleanup outside the verified temporary restore directory.');
    fs.rmSync(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch((error) => {
  console.error(
    error.code ? 'Isolated restore test failed. No private contents are printed.' : error.message,
  );
  process.exitCode = 1;
});
