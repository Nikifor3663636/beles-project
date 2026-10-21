'use strict';
// Never targets the running database. Authenticate the entire archive before SQL starts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
async function main() {
  if (process.env.RESTORE_CONFIRM !== 'ISOLATED_EMPTY_DATABASE')
    throw Error('Set RESTORE_CONFIRM=ISOLATED_EMPTY_DATABASE after reviewing the isolated target.');
  const file = path.resolve(process.argv[2] || ''),
    keyFile = path.resolve(process.argv[3] || '');
  let target, production;
  try {
    target = new URL(process.env.RESTORE_DATABASE_URL);
    if (process.env.DATABASE_URL) production = new URL(process.env.DATABASE_URL);
  } catch {
    throw Error('Configure an isolated RESTORE_DATABASE_URL through your secret manager.');
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol))
    throw Error('PostgreSQL target required.');
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(databaseName))
    throw Error('Use a simple isolated database name; DSNs are not accepted as database names.');
  const address = (u) => u.hostname + ':' + (u.port || '5432') + u.pathname;
  if (production && address(target) === address(production))
    throw Error('Refusing to restore into the production database.');
  const stat = fs.statSync(file),
    key = fs.readFileSync(keyFile),
    handle = fs.openSync(file, 'r'),
    header = Buffer.alloc(27),
    tag = Buffer.alloc(16);
  fs.readSync(handle, header, 0, 27, 0);
  fs.readSync(handle, tag, 0, 16, stat.size - 16);
  fs.closeSync(handle);
  if (
    header.subarray(0, 15).toString() !== 'BELES-BACKUP-1\n' ||
    key.length !== 32 ||
    stat.size < 44
  )
    throw Error('Invalid encrypted archive/key.');
  function decrypt() {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(15));
    decipher.setAuthTag(tag);
    return decipher;
  }
  const input = () => fs.createReadStream(file, { start: 27, end: stat.size - 17 });
  let prefix = Buffer.alloc(0);
  await pipeline(
    input(),
    decrypt(),
    new Writable({
      write(chunk, encoding, done) {
        if (prefix.length < 5)
          prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
        done();
      },
    }),
  );
  if (prefix.toString() !== 'PGDMP')
    throw Error(
      'This is not a PostgreSQL custom-format dump. Use the separate media/JSON recovery workflow.',
    );
  const ca = process.env.RESTORE_CA_PEM || process.env.DATABASE_CA_PEM;
  const pool = new (require('pg').Pool)(
    require('../repository.cjs').poolOptions(target.href, {
      ...process.env,
      DATABASE_CA_PEM: ca,
      PGSSL_DISABLE: 'false',
    }),
  );
  let certificate;
  try {
    const result = await pool.query(
      "SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')",
    );
    if (result.rows[0].count !== 0)
      throw Error('Target database is not empty. No restoration performed.');
    const current = fs.statSync(file);
    if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs)
      throw Error('Archive changed after verification.');
    if (ca) {
      certificate = path.join(os.tmpdir(), 'beles-restore-ca-' + crypto.randomUUID() + '.pem');
      fs.writeFileSync(certificate, ca, { flag: 'wx', mode: 0o600 });
    }
    const child = spawn(
      'pg_restore',
      [
        '--dbname',
        databaseName,
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PGHOST: target.hostname,
          PGPORT: target.port || '5432',
          PGUSER: decodeURIComponent(target.username),
          PGPASSWORD: decodeURIComponent(target.password),
          PGDATABASE: databaseName,
          PGSSLMODE: 'verify-full',
          PGCONNECT_TIMEOUT: '5',
          ...(certificate ? { PGSSLROOTCERT: certificate } : {}),
        },
      },
    );
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 180000);
    timer.unref();
    const exited = new Promise((resolve, reject) => {
      child.once('error', () => reject(Error('pg_restore could not start.')));
      child.once('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              Error('Restore failed and was not marked verified. Check the isolated database.'),
            ),
      );
    });
    try {
      await Promise.all([pipeline(input(), decrypt(), child.stdin), exited]);
    } catch (error) {
      child.kill();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    console.log(
      'Archive authenticated and restored to an isolated empty database. Now compare counts, IDs, hashes, roles and media before switching traffic.',
    );
  } finally {
    await pool.end();
    if (certificate) fs.unlinkSync(certificate);
  }
}
main().catch((error) => {
  console.error(
    error.code
      ? 'Restore failed. Production database was not targeted; credentials are not printed.'
      : error.message,
  );
  process.exitCode = 1;
});
