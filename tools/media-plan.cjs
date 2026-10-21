'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(process.env.BELES_STORAGE_DIR || root, 'uploads');
const output = path.join(root, 'dist/media-proposal');
async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function main() {
  if (
    !process.env.BELES_VERIFIED_BACKUP ||
    !JSON.parse(fs.readFileSync(process.env.BELES_VERIFIED_BACKUP)).verifiedAt
  )
    throw Error('Set BELES_VERIFIED_BACKUP to the verified off-volume backup manifest.');
  await fsp.mkdir(output, { recursive: true });
  sharp.concurrency(1);
  sharp.cache({ memory: 16, files: 0, items: 8 });
  const items = [],
    keep = process.argv.includes('--keep-proposals');
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(source, entry.name),
      before = await fsp.stat(file),
      item = { key: entry.name, bytes: before.size, sha256: await hash(file) };
    if (/\.(avif|webp|png|jpg|gif)$/i.test(entry.name)) {
      const temporary = path.join(output, crypto.randomUUID() + '.webp');
      try {
        const image = sharp(file, { limitInputPixels: 40000000, failOn: 'warning' }),
          metadata = await image.metadata();
        if ((metadata.pages || 1) > 1) {
          item.skipped = 'animation_preserved';
        } else {
          await image
            .rotate()
            .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 88, alphaQuality: 100, effort: 4 })
            .toFile(temporary);
          item.proposedBytes = (await fsp.stat(temporary)).size;
          item.savingBytes = Math.max(0, item.bytes - item.proposedBytes);
          item.proposedSha256 = await hash(temporary);
          if (keep && item.savingBytes) {
            item.proposal = item.proposedSha256 + '.webp';
            await fsp.copyFile(temporary, path.join(output, item.proposal));
          }
        }
      } catch {
        item.skipped = 'decoder_or_resource_limit';
      } finally {
        await fsp.unlink(temporary).catch(() => {});
      }
    } else if (/\.pdf$/i.test(entry.name))
      item.skipped = 'PDF requires a separate readability comparison; no estimated savings claimed';
    items.push(item);
    if (items.length % 50 === 0) console.log('Analysed files:', items.length);
    if (before.mtimeMs !== (await fsp.stat(file)).mtimeMs)
      throw Error('Source changed during analysis; do not use this report.');
  }
  const report = {
    at: new Date().toISOString(),
    activeFilesChanged: false,
    originalsDeleted: false,
    files: items.length,
    currentBytes: items.reduce((s, x) => s + x.bytes, 0),
    possibleSavingBytes: items.reduce((s, x) => s + (x.savingBytes || 0), 0),
    items,
  };
  await fsp.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log({ ...report, items: undefined });
}
main().catch((error) => {
  console.error(error.code ? 'Analysis failed; originals were not modified.' : error.message);
  process.exitCode = 1;
});
