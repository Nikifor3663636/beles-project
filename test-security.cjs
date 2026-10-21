'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const security = require('./security.cjs');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-security-'));
  const previousKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  try {
    const secret = security.base32(Buffer.from('12345678901234567890'));
    // RFC 6238 Appendix B, SHA1, six-digit truncation of the eight-digit vectors.
    for (const [time, expected] of [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ])
      assert.equal(security.totp(secret, Math.floor(time / 30)), expected);
    const encrypted = security.encrypt(secret);
    assert.ok(!encrypted.includes(secret));
    assert.equal(security.decrypt(encrypted), secret);
    assert.throws(() => security.decrypt(encrypted.slice(0, -4) + 'AAAA'));
    const repository = require('./repository.cjs')(directory, { databaseURL: '' });
    const accounts = require('./accounts.cjs')(path.join(directory, 'admin.json'), repository);
    const owner = await accounts.create('owner', 'owner-password-2026');
    const admin = await accounts.create('second', 'second-password-2026', owner.id);
    assert.equal(owner.role, 'owner');
    assert.equal(admin.role, 'admin');
    await assert.rejects(accounts.create('third', 'third-password-2026', admin.id), {
      status: 403,
    });
    await assert.rejects(accounts.manage(owner.id, owner.id, 'delete'), { status: 409 });
    await assert.rejects(accounts.profile(admin.id, { name: 'Attack', role: 'owner' }), {
      status: 400,
    });
    const pending = await accounts.beginTotp(owner.id),
      code = security.totp(pending.secret, Math.floor(Date.now() / 30000));
    const recovery = await accounts.confirmTotp(owner.id, code);
    await assert.rejects(accounts.factor(owner.id, code), { status: 401 });
    assert.equal(await accounts.factor(owner.id, recovery.recovery[0]), true);
    await assert.rejects(accounts.factor(owner.id, recovery.recovery[0]), { status: 401 });
    assert.ok(
      !fs.readFileSync(path.join(directory, 'admin.json'), 'utf8').includes(pending.secret),
    );
    assert.ok(
      !fs.readFileSync(path.join(directory, 'admin.json'), 'utf8').includes(recovery.recovery[1]),
    );
    const sessions = require('./sessions.cjs')(repository, accounts),
      req = { headers: { 'user-agent': 'test browser' } };
    const created = await sessions.create(admin.id, req);
    req.headers.cookie = 'beles_session=' + created.token;
    const active = await sessions.get(req);
    assert.equal(active.userId, admin.id);
    assert.ok(
      !fs.readFileSync(path.join(directory, 'sessions.json'), 'utf8').includes(created.token),
    );
    const afterRestart = require('./sessions.cjs')(repository, accounts);
    assert.equal((await afterRestart.get(req)).userId, admin.id);
    await assert.rejects(sessions.revoke(active.id, owner.id), { status: 403 });
    await accounts.manage(owner.id, admin.id, 'disable');
    assert.equal(await sessions.get(req), null);
    await accounts.manage(owner.id, admin.id, 'enable');
    await sessions.revoke(active.id, admin.id);
    assert.equal(await sessions.get(req), null);
    const access = require('./request-security.cjs');
    assert.throws(() => access.owner({ user: admin }), { status: 403 });
    assert.doesNotThrow(() => access.owner({ user: owner, reauthUntil: 0 }, true));
    const uploads = path.join(directory, 'uploads');
    fs.mkdirSync(uploads);
    const media = require('./media.cjs')(uploads, repository);
    const request = (bytes) => {
      const stream = require('node:stream').Readable.from([bytes]);
      stream.headers = { 'content-type': 'image/png', 'content-length': String(bytes.length) };
      return stream;
    };
    await assert.rejects(
      media.upload(request(Buffer.from('<svg><script>alert(1)</script></svg>')), admin.id),
      { status: 415 },
    );
    const image = await require('sharp')({
      create: {
        width: 32,
        height: 16,
        channels: 4,
        background: { r: 255, g: 0, b: 128, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();
    const uploaded = await media.upload(request(image), admin.id),
      duplicate = await media.upload(request(image), admin.id);
    assert.equal(uploaded.url, duplicate.url);
    assert.equal((await repository.read('media.json')).length, 1);
    const metadata = await require('sharp')(
      path.join(uploads, path.basename(uploaded.url)),
    ).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.exif, undefined);
    const statfs = fs.promises.statfs;
    try {
      fs.promises.statfs = async () => ({ bsize: 4096, blocks: 100, bavail: 0 });
      await assert.rejects(media.upload(request(image), admin.id), { status: 507 });
    } finally {
      fs.promises.statfs = statfs;
    }
    assert.equal(fs.readdirSync(uploads).filter((f) => f.endsWith('.webp')).length, 1);
    assert.equal(fs.readdirSync(path.join(uploads, '.cache')).length, 0);
    console.log(
      'PASS: RFC TOTP vectors, encrypted secrets, recovery/replay protection, owner protection, profile allowlist, session persistence, revocation, disabled accounts, object ownership and reauthentication.',
    );
    console.log(
      'PASS: raster magic checks, alpha/WebP/metadata stripping, hash deduplication, simulated full disk rejection and temporary-file cleanup.',
    );
  } finally {
    if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousKey;
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('beles-security-')
    )
      fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
