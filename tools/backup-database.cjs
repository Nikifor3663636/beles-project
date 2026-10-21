'use strict';
// Run on an owner's backup host with pg_dump installed. stdout is never used for data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
async function main() {
  const outputDirectory = path.resolve(process.env.BACKUP_OUTPUT_DIR || ''),
    keyDirectory = path.resolve(process.env.BACKUP_KEY_DIR || '');
  if (
    !process.env.BACKUP_OUTPUT_DIR ||
    !process.env.BACKUP_KEY_DIR ||
    outputDirectory === keyDirectory
  )
    throw Error('Set separate BACKUP_OUTPUT_DIR and BACKUP_KEY_DIR outside the working Volume.');
  if (process.env.BELES_STORAGE_DIR)
    for (const directory of [outputDirectory, keyDirectory]) {
      const volume = path.resolve(process.env.BELES_STORAGE_DIR);
      if (directory === volume || directory.startsWith(volume + path.sep))
        throw Error('Backups and keys must be outside the working Volume.');
    }
  let url;
  try {
    url = new URL(process.env.DATABASE_URL);
  } catch {
    throw Error('Configure DATABASE_URL through your secret manager.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('PostgreSQL is required.');
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const name = 'beles-db-' + new Date().toISOString().replace(/[:.]/g, '-'),
    key = crypto.randomBytes(32),
    iv = crypto.randomBytes(12),
    file = path.join(outputDirectory, name + '.pgdump.enc');
  fs.writeFileSync(path.join(keyDirectory, name + '.key'), key, { flag: 'wx', mode: 0o600 });
  let certificate;
  if (process.env.DATABASE_CA_PEM) {
    certificate = path.join(os.tmpdir(), 'beles-ca-' + crypto.randomUUID() + '.pem');
    fs.writeFileSync(certificate, process.env.DATABASE_CA_PEM, { flag: 'wx', mode: 0o600 });
  }
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGSSLMODE: 'verify-full',
      ...(certificate ? { PGSSLROOTCERT: certificate } : {}),
    },
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', () => reject(Error('pg_dump could not start.')));
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(Error('pg_dump failed. Check TLS, connectivity and backup permissions.')),
    );
  });
  // Drain errors without printing a DSN or authentication details.
  child.stderr.resume();
  const output = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([Buffer.from('BELES-BACKUP-1\n'), iv]));
  try {
    await Promise.all([
      pipeline(
        child.stdout,
        crypto.createCipheriv('aes-256-gcm', key, iv).on('finish', function () {
          output.authTag = this.getAuthTag();
        }),
        output,
      ),
      exited,
    ]);
    fs.appendFileSync(file, output.authTag);
    console.log({
      created: file,
      bytes: fs.statSync(file).size,
      verification: 'Restore into an isolated database before marking this backup verified.',
    });
  } finally {
    if (certificate) fs.unlinkSync(certificate);
  }
}
main().catch((error) => {
  console.error(
    error.code
      ? 'Encrypted backup failed. Check the private backup host configuration.'
      : error.message,
  );
  process.exitCode = 1;
});
