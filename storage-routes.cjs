'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { body, json } = require('./http-utils.cjs');
const { fail } = require('./security.cjs');
module.exports = ({ media, repository, directory, root, design, audit }) => {
  const reports = new Map();
  async function references() {
    const values = [
      await repository.read('catalog.json', []),
      await repository.read('admin.json', {}),
      await repository.read('site-design.json', design.read()),
      design.original(),
    ];
    for (const name of [
      'site-design.history.json',
      'site-design.previous.json',
      'catalog.previous.json',
    ])
      values.push(await repository.read(name, null));
    // Static scripts contain fallback images, fonts and high-resolution mappings as well.
    async function staticFiles(folder) {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) await staticFiles(file);
        else if (/\.(js|css|html|svg)$/.test(entry.name))
          values.push(await fs.readFile(file, 'utf8'));
      }
    }
    await staticFiles(path.join(root, 'public'));
    values.push(await fs.readFile(path.join(root, 'data/base.html'), 'utf8'));
    const text = JSON.stringify(values).replace(/\\\//g, '/');
    const result = new Set(
      text.match(/[a-f0-9-]+\.(?:png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)\b/g) || [],
    );
    // A recent upload can still be waiting for the user's Save action.
    for (const item of await repository.read('media.json', []))
      if (Date.parse(item.lastUploadedAt || item.createdAt) > Date.now() - 7 * 86400000)
        result.add(item.key);
    return result;
  }
  async function orphans() {
    if (media.driver !== 'volume') fail(409, 'Перевірка сиріт доступна лише для активного Volume.');
    const refs = await references(),
      items = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        !/^[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)$/.test(entry.name) ||
        refs.has(entry.name) ||
        media.busy(entry.name)
      )
        continue;
      const stat = await fs.stat(path.join(directory, entry.name));
      // Age is only an extra safeguard after checking every known reference source.
      if (Date.now() - stat.mtimeMs > 7 * 86400000)
        items.push({ key: entry.name, bytes: stat.size, modified: stat.mtimeMs });
    }
    return items;
  }
  return async (req, res, route, s) => {
    if (!route.startsWith('/api/storage')) return false;
    const send = (value) => {
      json(res, 200, value);
      return true;
    };
    if (route === '/api/storage' && req.method === 'GET') return send(await media.stats());
    if (route === '/api/storage/cache' && req.method === 'DELETE') {
      const result = await media.cleanup();
      await audit.record('storage.cache', s.userId);
      return send(result);
    }
    if (route === '/api/storage/orphans' && req.method === 'GET') {
      for (const [key, report] of reports) if (report.until < Date.now()) reports.delete(key);
      const items = await orphans(),
        id = crypto.randomUUID();
      reports.set(id, { items, user: s.userId, until: Date.now() + 600000 });
      return send({
        id,
        items,
        bytes: items.reduce((n, item) => n + item.bytes, 0),
        expiresInSeconds: 600,
      });
    }
    if (route === '/api/storage/orphans' && req.method === 'DELETE') {
      if (repository.mode !== 'json')
        fail(
          409,
          'Видалення у PostgreSQL виконується під час зупинки записів після резервного копіювання. Онлайн доступний лише звіт.',
        );
      const b = await body(req, 8192),
        report = reports.get(b.reportId);
      if (
        !report ||
        report.user !== s.userId ||
        report.until < Date.now() ||
        b.confirm !== 'DELETE REVIEWED ORPHANS'
      )
        fail(409, 'Спочатку перегляньте свіжий звіт і підтвердіть видалення.');
      const freedBytes = await repository.exclusive(async () => {
        const current = new Map((await orphans()).map((item) => [item.key, item]));
        for (const item of report.items)
          if (JSON.stringify(current.get(item.key)) !== JSON.stringify(item))
            fail(409, 'Файли або посилання змінилися. Повторіть перевірку.');
        const finalReferences = await references();
        if (report.items.some((item) => finalReferences.has(item.key) || media.busy(item.key)))
          fail(409, 'З’явилися нові посилання. Повторіть перевірку.');
        // No awaited application writes between the final reference scan and synchronous unlink.
        let freedBytes = 0;
        for (const item of report.items) {
          require('node:fs').unlinkSync(path.join(directory, item.key));
          freedBytes += item.bytes;
        }
        return freedBytes;
      });
      reports.delete(b.reportId);
      await audit.record('storage.orphans', s.userId);
      return send({ files: report.items.length, freedBytes });
    }
    fail(405, 'Method not allowed');
  };
};
