'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { read, write } = require('./json-store.cjs');

function databaseError() {
  const error = Error('База даних недоступна. Спробуйте пізніше.');
  error.status = 503;
  return error;
}
function poolOptions(connectionString, env = process.env) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw Error('Invalid DATABASE_URL configuration.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw Error('DATABASE_URL must be PostgreSQL.');
  // pg connection-string SSL options must not override certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const ssl =
    env.PGSSL_DISABLE === 'true'
      ? false
      : { rejectUnauthorized: true, ...(env.DATABASE_CA_PEM ? { ca: env.DATABASE_CA_PEM } : {}) };
  return {
    connectionString: url.href,
    ssl,
    max: Math.max(1, Math.min(10, Number(env.PG_POOL_MAX) || 5)),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: 'beles',
  };
}

module.exports = function repository(directory, options = {}) {
  const databaseURL = options.databaseURL ?? process.env.DATABASE_URL;
  let queue = Promise.resolve();
  const serialize = (action) => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  };
  if (!databaseURL && !options.pool) {
    return {
      mode: 'json',
      async ready() {},
      async close() {},
      async exclusive(action) {
        return serialize(action);
      },
      async read(name, fallback) {
        return read(path.join(directory, path.basename(name)), fallback);
      },
      async mutate(name, action, fallback) {
        return serialize(async () => {
          const file = path.join(directory, path.basename(name));
          const result = await action(read(file, fallback));
          for (const [key, value] of Object.entries(result.related || {}))
            write(path.join(directory, path.basename(key)), value);
          write(file, result.value);
          return result.result;
        });
      },
      async write(name, value) {
        return serialize(() => write(path.join(directory, path.basename(name)), value));
      },
      async initialized() {
        return (
          fs.existsSync(path.join(directory, 'admin.initialized')) ||
          fs.existsSync(path.join(directory, 'admin.json'))
        );
      },
      async markInitialized() {
        fs.writeFileSync(path.join(directory, 'admin.initialized'), new Date().toISOString(), {
          mode: 0o600,
        });
      },
    };
  }
  const pool = options.pool || new (require('pg').Pool)(poolOptions(databaseURL));
  pool.on?.('error', () => {});
  async function get(client, name, fallback) {
    if (name === 'catalog.json') {
      const result = await client.query('SELECT payload FROM beles_catalog ORDER BY position');
      return result.rows.map((r) => r.payload);
    }
    if (name === 'admin.json') {
      const result = await client.query(
        "SELECT payload FROM beles_users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id",
      );
      return result.rows.length
        ? { version: 3, users: result.rows.map((r) => r.payload) }
        : fallback;
    }
    if (name === 'feedback.json') {
      return (await client.query('SELECT payload FROM beles_feedback ORDER BY position')).rows.map(
        (r) => r.payload,
      );
    }
    if (name === 'media.json') {
      return (
        await client.query('SELECT payload FROM beles_media ORDER BY key COLLATE "C"')
      ).rows.map((r) => r.payload);
    }
    if (name === 'sessions.json') {
      return (
        await client.query('SELECT id,payload FROM beles_sessions WHERE expires_at > now()')
      ).rows.map((r) => [r.id, r.payload]);
    }
    if (name === 'audit.json') {
      return (await client.query('SELECT payload FROM beles_audit ORDER BY id')).rows.map(
        (r) => r.payload,
      );
    }
    const result = await client.query('SELECT payload FROM beles_documents WHERE name=$1', [name]);
    return result.rows[0]?.payload ?? fallback;
  }
  async function set(client, name, value) {
    if (name === 'catalog.json') {
      const brands = value.filter((r) => r.kind === 'brand'),
        names = new Map(brands.map((r) => [r.name, r.itemKey]));
      for (const row of value)
        if (
          ['product', 'presentation'].includes(row.kind) &&
          row.brand &&
          !['—', '-'].includes(row.brand) &&
          !names.has(row.brand)
        )
          throw Error('Catalog has an unknown brand.');
      await client.query('DELETE FROM beles_catalog');
      await client.query('DELETE FROM beles_brands');
      for (const brand of brands)
        await client.query('INSERT INTO beles_brands(item_key,name) VALUES($1,$2)', [
          brand.itemKey,
          brand.name,
        ]);
      const occurrences = new Map();
      for (let i = 0; i < value.length; i++) {
        const row = value[i],
          businessKey = JSON.stringify([row.kind, row.itemKey]),
          occurrence = occurrences.get(businessKey) || 0;
        occurrences.set(businessKey, occurrence + 1);
        await client.query(
          'INSERT INTO beles_catalog(record_id,kind,item_key,position,brand_key,payload) VALUES($1,$2,$3,$4,$5,$6)',
          [
            JSON.stringify([row.kind, row.itemKey, occurrence]),
            row.kind,
            row.itemKey,
            i,
            ['product', 'presentation'].includes(row.kind) ? names.get(row.brand) || null : null,
            JSON.stringify(row),
          ],
        );
      }
      return;
    }
    if (name === 'admin.json') {
      const users = value.users || [];
      const ids = users.map((u) => u.id);
      await client.query('DELETE FROM beles_users WHERE NOT (id = ANY($1::text[]))', [ids]);
      for (const user of users)
        await client.query(
          'INSERT INTO beles_users(id,username,role,enabled,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,role=EXCLUDED.role,enabled=EXCLUDED.enabled,payload=EXCLUDED.payload',
          [user.id, user.username, user.role, user.enabled !== false, JSON.stringify(user)],
        );
      return;
    }
    const tables = {
      'feedback.json': 'beles_feedback',
      'media.json': 'beles_media',
      'sessions.json': 'beles_sessions',
      'audit.json': 'beles_audit',
    };
    if (tables[name]) {
      // Table names come exclusively from this fixed map; values remain bound parameters.
      await client.query('DELETE FROM ' + tables[name]);
      for (const [position, row] of value.entries()) {
        if (name === 'feedback.json')
          await client.query(
            'INSERT INTO beles_feedback(id,created_at,position,payload) VALUES($1,$2,$3,$4)',
            [row.id, row.createdAt, position, JSON.stringify(row)],
          );
        if (name === 'media.json')
          await client.query(
            'INSERT INTO beles_media(key,sha256,bytes,payload) VALUES($1,$2,$3,$4)',
            [row.key, row.sha256 || null, row.bytes || 0, JSON.stringify(row)],
          );
        if (name === 'sessions.json')
          await client.query(
            'INSERT INTO beles_sessions(id,user_id,expires_at,payload) VALUES($1,$2,$3,$4)',
            [row[0], row[1].userId, new Date(row[1].until), JSON.stringify(row[1])],
          );
        if (name === 'audit.json')
          await client.query('INSERT INTO beles_audit(created_at,payload) VALUES($1,$2)', [
            row.at,
            JSON.stringify(row),
          ]);
      }
      return;
    }
    await client.query(
      'INSERT INTO beles_documents(name,payload) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET payload=EXCLUDED.payload',
      [name, JSON.stringify(value)],
    );
  }
  async function transaction(name, action) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['beles:' + name]);
      const value = await action(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      if (error.status || !error.code) throw error;
      throw databaseError();
    } finally {
      client?.release();
    }
  }
  return {
    mode: 'postgres',
    pool,
    async importSnapshot(sourceHash, documents) {
      return transaction('import', async (client) => {
        const prior = await client.query('SELECT source_hash FROM beles_imports WHERE name=$1', [
          'json-v1',
        ]);
        if (prior.rows.length) {
          if (prior.rows[0].source_hash !== sourceHash)
            throw Error(
              'A different snapshot was already imported; refusing to overwrite live data.',
            );
          return { alreadyImported: true };
        }
        if ((await client.query('SELECT id FROM beles_users LIMIT 1')).rows.length)
          throw Error('Database already contains accounts; refusing initial import.');
        for (const [name, value] of Object.entries(documents)) await set(client, name, value);
        await set(client, 'admin.initialized', { at: new Date().toISOString() });
        await client.query('INSERT INTO beles_imports(name,source_hash) VALUES($1,$2)', [
          'json-v1',
          sourceHash,
        ]);
        return { alreadyImported: false };
      });
    },
    async ready() {
      try {
        const result = await pool.query(
          'SELECT version FROM beles_schema_versions WHERE version=1',
        );
        if (!result.rows.length) throw Error('Schema missing');
      } catch {
        throw databaseError();
      }
    },
    async close() {
      await pool.end();
    },
    async read(name, fallback) {
      try {
        return await get(pool, name, fallback);
      } catch {
        throw databaseError();
      }
    },
    async write(name, value) {
      return transaction(name, (client) => set(client, name, value));
    },
    async mutate(name, action, fallback) {
      return transaction(name, async (client) => {
        const result = await action(await get(client, name, fallback));
        for (const [key, value] of Object.entries(result.related || {}))
          await set(client, key, value);
        await set(client, name, result.value);
        return result.result;
      });
    },
    async initialized() {
      const value = await get(pool, 'admin.initialized', null);
      return !!value || !!(await get(pool, 'admin.json', null))?.users?.length;
    },
    async markInitialized() {
      await transaction('admin.initialized', (client) =>
        set(client, 'admin.initialized', { at: new Date().toISOString() }),
      );
    },
  };
};
module.exports.poolOptions = poolOptions;
