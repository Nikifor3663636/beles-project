'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { fail } = require('./security.cjs');

module.exports = (directory, repository) => {
  const cache = path.join(directory, '.cache');
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  const driver = process.env.MEDIA_DRIVER || 'volume';
  if (!['volume', 's3'].includes(driver)) throw Error('MEDIA_DRIVER must be volume or s3.');
  let s3;
  if (driver === 's3') {
    const sdk = require('@aws-sdk/client-s3');
    if (!process.env.S3_BUCKET || !process.env.MEDIA_PUBLIC_URL?.startsWith('https://'))
      throw Error('S3_BUCKET and HTTPS MEDIA_PUBLIC_URL are required.');
    if (process.env.S3_ENDPOINT && !process.env.S3_ENDPOINT.startsWith('https://'))
      throw Error('S3_ENDPOINT must use HTTPS.');
    s3 = {
      ...sdk,
      client: new sdk.S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      }),
    };
  }
  const budget = Math.max(1, Number(process.env.MEDIA_BUDGET_BYTES) || 1000000000);
  let active = 0;
  const publications = new Map();
  const busy = (key) => (publications.get(key) || 0) > Date.now();
  const maximum = Math.max(1, Math.min(2, Number(process.env.UPLOAD_CONCURRENCY) || 1));
  async function stats() {
    const result = {
      driver,
      budgetBytes: budget,
      images: 0,
      pdf: 0,
      fonts: 0,
      other: 0,
      cache: 0,
      files: 0,
      usedBytes: 0,
    };
    const files = await fsp.readdir(directory, { withFileTypes: true });
    for (const file of files)
      if (file.isFile()) {
        const size = (await fsp.stat(path.join(directory, file.name))).size;
        const group = /\.(avif|png|jpe?g|gif|webp|svg)$/i.test(file.name)
          ? 'images'
          : /\.pdf$/i.test(file.name)
            ? 'pdf'
            : /\.(woff2?|ttf)$/i.test(file.name)
              ? 'fonts'
              : 'other';
        result[group] += size;
        result.files++;
        result.usedBytes += size;
      }
    for (const file of await fsp.readdir(cache, { withFileTypes: true }))
      if (file.isFile()) result.cache += (await fsp.stat(path.join(cache, file.name))).size;
    const disk = await fsp.statfs(directory);
    result.filesystemBytes = disk.bsize * disk.blocks;
    result.filesystemFreeBytes = disk.bsize * disk.bavail;
    result.budgetFreeBytes = Math.max(0, budget - result.usedBytes);
    result.warning =
      result.filesystemFreeBytes < 100 * 1024 * 1024 || result.usedBytes > budget * 0.85;
    // S3 bucket quota cannot be inferred from local filesystem statistics.
    result.localStagingOnly = driver !== 'volume';
    return result;
  }
  async function available(reserve) {
    const disk = await fsp.statfs(directory);
    if (disk.bavail * disk.bsize < reserve + 8 * 1024 * 1024)
      fail(507, 'Недостатньо місця у сховищі. Звільніть кеш або зверніться до власника.');
    if (driver === 'volume' && (await stats()).budgetFreeBytes < reserve)
      fail(507, 'Досягнуто бюджету медіасховища.');
  }
  async function upload(req, userId) {
    if (active >= maximum) fail(429, 'Інше завантаження вже виконується. Спробуйте пізніше.');
    if ((req.headers['content-type'] || '').startsWith('application/json'))
      fail(415, 'Надсилайте файл як двійковий потік.');
    const limit = 60 * 1024 * 1024,
      declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) fail(413, 'Максимум: 60 МБ PDF або 20 МБ зображення.');
    active++;
    const token = crypto.randomUUID(),
      source = path.join(cache, token + '.source'),
      output = path.join(cache, token + '.webp');
    let publication;
    try {
      await available(declared || 4 * 1024 * 1024);
      let size = 0,
        checked = 0;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          if (size > limit)
            return callback(Object.assign(Error('File exceeds 60 MB'), { status: 413 }));
          if (size - checked > 4 * 1024 * 1024) {
            checked = size;
            available(8 * 1024 * 1024).then(() => callback(null, chunk), callback);
          } else callback(null, chunk);
        },
      });
      await pipeline(req, counter, fs.createWriteStream(source, { flags: 'wx', mode: 0o600 }));
      const handle = await fsp.open(source, 'r'),
        header = Buffer.alloc(16);
      await handle.read(header);
      await handle.close();
      let type,
        ext,
        resultFile = source,
        width,
        height;
      if (header.subarray(0, 5).toString() === '%PDF-') {
        // Leave PDFs byte-for-byte unchanged. Never claim a compression result without a decoder.
        const handle = await fsp.open(source, 'r'),
          tail = Buffer.alloc(Math.min(size, 2048));
        await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length));
        await handle.close();
        if (!tail.includes(Buffer.from('%%EOF'))) fail(415, 'PDF не завершений або пошкоджений.');
        const optimized = await require('./pdf-optimize.cjs')(source, output);
        resultFile = optimized.file;
        ext = 'pdf';
        type = 'application/pdf';
      } else {
        if (size > 20 * 1024 * 1024) fail(413, 'Максимальний розмір зображення — 20 МБ.');
        const raster =
          header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          (header[0] === 255 && header[1] === 216 && header[2] === 255) ||
          ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString()) ||
          (header.subarray(0, 4).toString() === 'RIFF' &&
            header.subarray(8, 12).toString() === 'WEBP') ||
          (header.subarray(4, 8).toString() === 'ftyp' &&
            ['avif', 'avis'].includes(header.subarray(8, 12).toString()));
        if (!raster)
          fail(415, 'Непідтримуваний тип файла. SVG та виконувані файли не приймаються.');
        const sharp = require('sharp');
        sharp.concurrency(1);
        sharp.cache({ memory: 16, files: 0, items: 16 });
        const image = sharp(source, {
          limitInputPixels: 40000000,
          failOn: 'warning',
          animated: false,
        });
        const metadata = await image.metadata();
        if (!['png', 'jpeg', 'webp', 'gif', 'avif', 'heif'].includes(metadata.format))
          fail(415, 'Використовуйте PNG, JPG, WebP, GIF або AVIF. SVG не приймаються.');
        if ((metadata.pages || 1) > 1) fail(415, 'Анімовані зображення не підтримуються.');
        const info = await image
          .rotate()
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88, alphaQuality: 100, effort: 4 })
          .toFile(output);
        resultFile = output;
        width = info.width;
        height = info.height;
        ext = 'webp';
        type = 'image/webp';
      }
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(resultFile)) hash.update(chunk);
      const sha256 = hash.digest('hex'),
        key = sha256 + '.' + ext,
        bytes = (await fsp.stat(resultFile)).size;
      publication = key;
      publications.set(key, Infinity);
      if (driver === 's3') {
        await s3.client.send(
          new s3.PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: fs.createReadStream(resultFile),
            ContentLength: bytes,
            ContentType: type,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } else {
        await available(bytes);
        try {
          await fsp.copyFile(resultFile, path.join(directory, key), fs.constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      await repository.mutate(
        'media.json',
        (entries) => {
          const existing = entries.find((item) => item.key === key);
          if (existing) existing.lastUploadedAt = new Date().toISOString();
          else
            entries.push({
              key,
              sha256,
              bytes,
              originalBytes: size,
              width,
              height,
              type,
              driver,
              userId,
              createdAt: new Date().toISOString(),
              lastUploadedAt: new Date().toISOString(),
            });
          return { value: entries };
        },
        [],
      );
      return {
        ok: true,
        url:
          driver === 's3'
            ? process.env.MEDIA_PUBLIC_URL.replace(/\/$/, '') + '/' + key
            : '/uploads/' + key,
        bytes,
        originalBytes: size,
        sha256,
      };
    } catch (error) {
      if (error.code === 'ENOSPC') fail(507, 'Сховище заповнене. Файл не додано.');
      if (error.message?.match(/unsupported image|corrupt|Input buffer|Input file/i))
        fail(415, 'Зображення пошкоджене або формат не підтримується.');
      throw error;
    } finally {
      active--;
      if (publication) publications.set(publication, Date.now() + 60000);
      if (publications.size > 1000)
        for (const [key, until] of publications) if (until < Date.now()) publications.delete(key);
      await Promise.all([fsp.unlink(source).catch(() => {}), fsp.unlink(output).catch(() => {})]);
    }
  }
  async function cleanup() {
    let freedBytes = 0,
      files = 0;
    for (const file of await fsp.readdir(cache, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9-]+\.(source|webp)$/.test(file.name)) continue;
      const target = path.join(cache, file.name),
        stat = await fsp.stat(target);
      if (Date.now() - stat.mtimeMs < 86400000) continue;
      await fsp.unlink(target);
      freedBytes += stat.size;
      files++;
    }
    return { freedBytes, files };
  }
  return {
    upload,
    stats,
    cleanup,
    driver,
    busy,
    async ready() {
      if (process.env.MEDIA_READ_REMOTE === 'true') {
        const proof = await repository.read('media-migration.json', null);
        if (
          driver !== 's3' ||
          !proof?.complete ||
          proof.publicURL !== process.env.MEDIA_PUBLIC_URL.replace(/\/$/, '') ||
          proof.bucket !== process.env.S3_BUCKET
        )
          fail(503, 'Спочатку скопіюйте медіа та перевірте контрольні суми.');
      }
    },
  };
};
