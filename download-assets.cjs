const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = __dirname,
  file = path.join(root, 'data/catalog.json'),
  baseFile = path.join(root, 'data/base.html');
const rows = JSON.parse(fs.readFileSync(file)),
  base = fs.readFileSync(baseFile, 'utf8');
const urls = new Set();
for (const r of rows)
  for (const k of ['image', 'pdfFile']) if (/^https?:\/\//.test(r[k] || '')) urls.add(r[k]);
for (const match of base.matchAll(/https?:\/\/[^\s"'<>\\]+/g))
  if (/\.(png|jpe?g|webp|gif|svg|pdf)(?:[?#]|$)/i.test(match[0])) urls.add(match[0]);
const existingFile = path.join(root, 'data/asset-manifest.json');
const previous = fs.existsSync(existingFile) ? JSON.parse(fs.readFileSync(existingFile)) : [];
const map = new Map(
  previous.filter((r) => r.local && fs.existsSync(path.join(root, r.local))).map((r) => [r.url, r]),
);
for (const r of previous) if (!r.local) urls.add(r.url);
const all = [...urls];
let index = 0,
  completed = 0;
const results = [...map.values()];
async function work() {
  while (index < all.length) {
    const url = all[index++];
    if (map.has(url)) {
      results.push(map.get(url));
      continue;
    }
    let result = { url };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(22000),
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Accept: 'image/avif,image/webp,image/*,application/pdf,*/*;q=0.8',
          },
        });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const length = Number(response.headers.get('content-length') || 0);
        if (length > 180 * 1024 * 1024) throw Error('Over 180 MB');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 180 * 1024 * 1024) throw Error('Over 180 MB');
        let ext;
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          ext = 'png';
        else if (bytes[0] === 255 && bytes[1] === 216) ext = 'jpg';
        else if (
          bytes.subarray(0, 4).toString() === 'RIFF' &&
          bytes.subarray(8, 12).toString() === 'WEBP'
        )
          ext = 'webp';
        else if (bytes.subarray(0, 3).toString() === 'GIF') ext = 'gif';
        else if (bytes.subarray(0, 5).toString() === '%PDF-') ext = 'pdf';
        else if (
          bytes.subarray(4, 8).toString() === 'ftyp' &&
          ['avif', 'avis'].includes(bytes.subarray(8, 12).toString())
        )
          ext = 'avif';
        else if (bytes.subarray(0, 2000).toString().includes('<svg')) ext = 'svg';
        else throw Error('Response is not an image/PDF');
        const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.' + ext;
        fs.writeFileSync(path.join(root, 'uploads', name), bytes);
        result = { url, local: '/uploads/' + name, bytes: bytes.length };
        break;
      } catch (e) {
        result.error = e.message;
      }
    }
    results.push(result);
    completed++;
    if (completed % 25 === 0) {
      fs.writeFileSync(existingFile, JSON.stringify(results, null, 2));
      console.log(`${completed}/${all.length}; saved ${results.filter((x) => x.local).length}`);
    }
  }
}
Promise.all(Array.from({ length: 14 }, work)).then(() => {
  for (const r of rows)
    for (const k of ['image', 'pdfFile']) {
      const found = results.find((x) => x.url === r[k]);
      if (found?.local) r[k] = found.local;
    }
  let updated = base;
  for (const r of results.filter((x) => x.local).sort((a, b) => b.url.length - a.url.length))
    updated = updated.split(r.url).join(r.local);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  fs.writeFileSync(baseFile, updated);
  fs.writeFileSync(existingFile, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        total: all.length,
        saved: results.filter((x) => x.local).length,
        failed: results.filter((x) => !x.local),
      },
      null,
      2,
    ),
  );
});
