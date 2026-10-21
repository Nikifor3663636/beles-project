'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = async (directory, existing = []) => {
  const entries = new Map(existing.map((item) => [item.key, item]));
  for (const file of await fs.promises.readdir(directory, { withFileTypes: true })) {
    if (
      !file.isFile() ||
      !/^[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)$/.test(file.name)
    )
      continue;
    const source = path.join(directory, file.name),
      before = await fs.promises.stat(source),
      hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
    const after = await fs.promises.stat(source),
      sha256 = hash.digest('hex');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw Error('Media changed during indexing; stop writes and repeat.');
    const old = entries.get(file.name);
    if (old?.sha256 && old.sha256 !== sha256)
      throw Error('Stored media checksum differs from its file; resolve this before migration.');
    const extension = path.extname(file.name).slice(1),
      type = {
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        pdf: 'application/pdf',
        svg: 'image/svg+xml',
        avif: 'image/avif',
        woff: 'font/woff',
        woff2: 'font/woff2',
        ttf: 'font/ttf',
      }[extension];
    entries.set(file.name, {
      ...old,
      key: file.name,
      bytes: before.size,
      sha256,
      type,
      driver: old?.driver || 'volume',
      modifiedAt: before.mtime.toISOString(),
    });
  }
  return [...entries.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
};
