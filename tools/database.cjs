'use strict';
// Explicit operations only. Nothing imports JSON during application startup.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const factory = require('../repository.cjs');
const root = path.resolve(__dirname, '..');
const command = process.argv[2];
const directory = path.resolve(
  process.env.BELES_STORAGE_DIR
    ? path.join(process.env.BELES_STORAGE_DIR, 'data')
    : path.join(root, 'data'),
);
async function main() {
  if (!process.env.DATABASE_URL)
    throw Error('Set DATABASE_URL through your secret manager; do not pass it as a CLI argument.');
  const pool = new Pool(factory.poolOptions(process.env.DATABASE_URL));
  const repository = factory(directory, { pool });
  try {
    if (command === 'migrate') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('beles:schema'))");
        await client.query(fs.readFileSync(path.join(root, 'db/001-initial.sql'), 'utf8'));
        await client.query('COMMIT');
        console.log('Schema v1 ready; existing rows preserved.');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return;
    }
    await repository.ready();
    if (command === 'import' || command === 'verify') {
      const names = [
        'catalog.json',
        'admin.json',
        'feedback.json',
        'integrations.json',
        'media.json',
        'audit.json',
        'media-migration.json',
        'site-design.json',
        'site-design.previous.json',
        'site-design.history.json',
      ];
      const documents = {},
        digest = crypto.createHash('sha256');
      for (const name of names) {
        const file = path.join(directory, name);
        if (!fs.existsSync(file)) continue;
        const bytes = fs.readFileSync(file);
        digest.update(name).update(bytes);
        documents[name] = JSON.parse(bytes);
      }
      if (!documents['admin.json'] || !Array.isArray(documents['catalog.json']))
        throw Error('An existing admin and catalogue snapshot are required.');
      documents['media.json'] = await require('../media-index.cjs')(
        path.join(path.dirname(directory), 'uploads'),
        documents['media.json'] || [],
      );
      digest.update('derived-media-v1').update(JSON.stringify(documents['media.json']));
      const accounts = require('../accounts.cjs')(path.join(directory, 'admin.json'));
      documents['admin.json'] = { version: 3, users: accounts.normalize(documents['admin.json']) };
      if (command === 'import') {
        if (!process.env.BELES_VERIFIED_BACKUP)
          throw Error(
            'Set BELES_VERIFIED_BACKUP to the verified backup manifest path before importing.',
          );
        const manifest = JSON.parse(fs.readFileSync(process.env.BELES_VERIFIED_BACKUP, 'utf8'));
        if (!manifest.verifiedAt) throw Error('The backup manifest is not verified.');
        console.log(await repository.importSnapshot(digest.digest('hex'), documents));
      }
      for (const [name, expected] of Object.entries(documents)) {
        const actual = await repository.read(name, null);
        // PG JSONB order is immaterial; catalogue row order is material.
        require('node:assert/strict').deepEqual(actual, expected);
      }
      console.log(
        'Verified: IDs, catalogue order, complete payloads and password hashes match the source snapshot. No credentials printed.',
      );
      return;
    }
    throw Error('Use: node tools/database.cjs migrate|import|verify');
  } finally {
    await repository.close();
  }
}
main().catch((error) => {
  console.error(
    error.code
      ? 'Database operation failed. Check connectivity, TLS and server logs; connection details are not printed.'
      : error.message,
  );
  process.exitCode = 1;
});
