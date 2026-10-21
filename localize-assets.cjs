// Optional: download external image/PDF assets onto this server.
// Stop the application and back up data/ and uploads/ before running.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
(async () => {
  const file = path.join(__dirname, 'data/catalog.json'),
    rows = JSON.parse(fs.readFileSync(file));
  const done = new Map();
  let failed = 0,
    saved = 0;
  for (const r of rows)
    for (const key of ['image', 'pdfFile']) {
      const url = r[key];
      if (!/^https:\/\//.test(url || '')) continue;
      if (done.has(url)) {
        r[key] = done.get(url);
        continue;
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        const type = res.headers.get('content-type')?.split(';')[0];
        const ext = {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
          'image/gif': 'gif',
          'application/pdf': 'pdf',
        }[type];
        if (!ext) throw Error('Unsupported content type');
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 30 * 1024 * 1024) throw Error('Over 30 MB');
        const name = crypto.randomUUID() + '.' + ext;
        fs.writeFileSync(path.join(__dirname, 'uploads', name), bytes);
        r[key] = '/uploads/' + name;
        done.set(url, r[key]);
        saved++;
      } catch (e) {
        failed++;
        console.error(r.itemKey, key, e.message);
      }
    }
  fs.copyFileSync(file, file + '.before-localize');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log({ saved, failed });
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
