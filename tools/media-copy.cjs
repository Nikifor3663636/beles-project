'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sdk = require('@aws-sdk/client-s3');
const root = path.resolve(__dirname, '..'),
  storage = process.env.BELES_STORAGE_DIR || root;
const directory = path.join(storage, 'uploads');
const repository = require('../repository.cjs')(path.join(storage, 'data'));
async function digest(stream) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
async function main() {
  try {
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (f) =>
          f.isFile() && /^[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)$/.test(f.name),
      );
    if (!process.argv.includes('--copy')) {
      console.log({
        dryRun: true,
        files: files.length,
        bytes: files.reduce((sum, f) => sum + fs.statSync(path.join(directory, f.name)).size, 0),
      });
      return;
    }
    if (
      !process.env.S3_BUCKET ||
      !process.env.S3_ENDPOINT?.startsWith('https://') ||
      !process.env.MEDIA_PUBLIC_URL?.startsWith('https://')
    )
      throw Error('Configure HTTPS S3_ENDPOINT, MEDIA_PUBLIC_URL and S3_BUCKET first.');
    if (
      !process.env.BELES_VERIFIED_BACKUP ||
      !JSON.parse(fs.readFileSync(process.env.BELES_VERIFIED_BACKUP, 'utf8')).verifiedAt
    )
      throw Error('A verified off-volume backup manifest is required.');
    await repository.ready();
    const client = new sdk.S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
    const verified = [];
    for (const file of files) {
      const source = path.join(directory, file.name),
        stat = fs.statSync(source),
        hash = await digest(fs.createReadStream(source));
      const mime = {
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp',
        avif: 'image/avif',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        pdf: 'application/pdf',
        woff2: 'font/woff2',
        woff: 'font/woff',
        ttf: 'font/ttf',
      }[path.extname(file.name).slice(1)];
      // Existing remote keys are verified rather than overwritten.
      try {
        const existing = await client.send(
          new sdk.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.name }),
        );
        if ((await digest(existing.Body)) !== hash)
          throw Error('Remote key contains different bytes; copy stopped.');
      } catch (error) {
        if (
          !['NoSuchKey', 'NotFound'].includes(error.name) &&
          error.$metadata?.httpStatusCode !== 404
        )
          throw error;
        await client.send(
          new sdk.PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: file.name,
            Body: fs.createReadStream(source),
            ContentLength: stat.size,
            ContentType: mime,
            IfNoneMatch: '*',
            Metadata: { sha256: hash },
          }),
        );
      }
      const check = await client.send(
        new sdk.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: file.name }),
      );
      if ((await digest(check.Body)) !== hash) throw Error('Checksum mismatch; nothing switched.');
      if (fs.statSync(source).mtimeMs !== stat.mtimeMs)
        throw Error('Source changed during copying; nothing switched.');
      verified.push({ key: file.name, bytes: stat.size, sha256: hash });
    }
    await repository.write('media-migration.json', {
      complete: true,
      driver: 's3',
      at: new Date().toISOString(),
      endpoint: new URL(process.env.MEDIA_PUBLIC_URL).origin,
      publicURL: process.env.MEDIA_PUBLIC_URL.replace(/\/$/, ''),
      bucket: process.env.S3_BUCKET,
      files: verified,
    });
    console.log({ verified: verified.length, switched: false, originalsDeleted: false });
    client.destroy();
  } finally {
    await repository.close();
  }
}
main().catch((error) => {
  console.error(
    error.$metadata || error.code
      ? 'Media copy failed; sources and active driver are unchanged. Check endpoint permissions and connectivity.'
      : error.message,
  );
  process.exitCode = 1;
});
