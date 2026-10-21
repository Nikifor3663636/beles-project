'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const factory = require('./repository.cjs');
async function main() {
  const { PGlite } = require('./dist/db-tools/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  // PGlite is a single-process PostgreSQL engine. It does NOT test network/TLS/pool contention.
  const adapter = {
    query: (sql, params) =>
      /pg_advisory_xact_lock/.test(sql) ? Promise.resolve({ rows: [] }) : db.query(sql, params),
    release() {},
    async connect() {
      return this;
    },
    async end() {
      await db.close();
    },
  };
  const repository = factory('', { pool: adapter });
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db/001-initial.sql'), 'utf8');
    await db.exec(schema);
    await db.exec(schema);
    await repository.ready();
    const rows = JSON.parse(fs.readFileSync('data/catalog.json'));
    const admin = {
      id: 'original',
      username: 'original',
      role: 'owner',
      enabled: true,
      salt: 'preserved',
      password: crypto.scryptSync('legacy-password-2026', 'preserved', 64).toString('hex'),
    };
    const documents = {
      'catalog.json': rows,
      'admin.json': { version: 3, users: [admin] },
      'feedback.json': [
        { id: 'second', createdAt: '2026-01-01T00:00:00Z', name: 'Two' },
        { id: 'first', createdAt: '2026-01-01T00:00:00Z', name: 'One' },
      ],
      'integrations.json': { gaMeasurementId: 'G-EXAMPLE' },
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(documents)).digest('hex');
    assert.equal((await repository.importSnapshot(hash, documents)).alreadyImported, false);
    assert.equal((await repository.importSnapshot(hash, documents)).alreadyImported, true);
    for (const [name, expected] of Object.entries(documents))
      assert.deepEqual(await repository.read(name), expected);
    await assert.rejects(
      repository.importSnapshot('changed-source', documents),
      /different snapshot/,
    );
    assert.equal(await repository.initialized(), true);
    await db.exec(schema);
    assert.deepEqual(await repository.read('catalog.json'), rows);
    await assert.rejects(
      adapter.query(
        'INSERT INTO beles_catalog(record_id,kind,item_key,position,brand_key,payload) VALUES($1,$2,$3,$4,$5,$6)',
        ['fk-test', 'product', 'fk-test', 999999, 'missing-key', '{}'],
      ),
      (error) => error.code === '23503',
    );
    const accounts = require('./accounts.cjs')('unused', repository);
    assert.equal(await accounts.verify((await accounts.users())[0], 'legacy-password-2026'), true);
    const sessions = require('./sessions.cjs')(repository, accounts);
    const created = await sessions.create(admin.id, {
      headers: { 'user-agent': 'PostgreSQL test' },
    });
    const loggedIn = await sessions.get({ headers: { cookie: 'beles_session=' + created.token } });
    assert.equal(loggedIn.user.role, 'owner');
    await sessions.revoke(loggedIn.id, admin.id);
    assert.equal(
      await sessions.get({ headers: { cookie: 'beles_session=' + created.token } }),
      null,
    );
    await assert.rejects(
      repository.mutate('catalog.json', (value) => ({
        value: [...value, { kind: 'product', itemKey: 'bad', brand: 'missing' }],
      })),
      /unknown brand/,
    );
    assert.deepEqual(await repository.read('catalog.json'), rows);
    await assert.rejects(
      repository.write('admin.json', { users: [admin, { ...admin, id: 'other' }] }),
    );
    assert.equal((await repository.read('admin.json')).users.length, 1);
    const options = factory.poolOptions(
      'postgres://user:secret@example.test/db?sslmode=no-verify&sslrootcert=bad',
      {},
    );
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.ok(!options.connectionString.includes('sslmode'));
    assert.ok(options.max <= 10);
    console.log(
      'PASS: PostgreSQL SQL engine: repeat schema/import, exact catalogue order and IDs, unchanged password hashes, transaction rollback, FK/unique checks, TLS configuration. Network PostgreSQL not tested.',
    );
  } finally {
    await repository.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
