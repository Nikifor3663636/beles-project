'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { encodeCBOR } = require('@levischuck/tiny-cbor');
const visual = require('./visual-elements.cjs');
const b64 = (value) => Buffer.from(value).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(value).digest();
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-improvements-'));
  const previousURL = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = 'https://beles.test';
  try {
    const repository = require('./repository.cjs')(directory, { databaseURL: '' });
    const accounts = require('./accounts.cjs')(path.join(directory, 'admin.json'), repository);
    const owner = await accounts.create('owner', 'owner-password-2026');
    const service = require('./passkeys.cjs')(accounts);
    const session = { id: 'session-a', user: owner };
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const jwk = publicKey.export({ format: 'jwk' }),
      id = crypto.randomBytes(32);
    const cose = encodeCBOR(
      new Map([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
      ]),
    );
    const setup = await service.beginRegistration({}, session);
    const client = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: setup.options.challenge,
        origin: 'https://beles.test',
        crossOrigin: false,
      }),
    );
    const length = Buffer.alloc(2);
    length.writeUInt16BE(id.length);
    const auth = Buffer.concat([
      hash('beles.test'),
      Buffer.from([0x45]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      length,
      id,
      Buffer.from(cose),
    ]);
    const response = {
      id: b64(id),
      rawId: b64(id),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(client),
        attestationObject: b64(
          encodeCBOR(
            new Map([
              ['fmt', 'none'],
              ['attStmt', new Map()],
              ['authData', new Uint8Array(auth)],
            ]),
          ),
        ),
        transports: ['internal'],
      },
    };
    const saved = await service.finishRegistration(session, {
      ticket: setup.ticket,
      response,
      name: 'Test device',
    });
    assert.equal(saved.recovery.length, 8);
    await assert.rejects(service.finishRegistration(session, { ticket: setup.ticket, response }));
    let user = (await accounts.users())[0];
    assert.equal(accounts.publicUser(user).twoFactorEnabled, true);
    assert.equal(accounts.publicUser(user).passkeys[0].publicKey, undefined);
    async function assertion(counter = 1, tamper = false, badOrigin = false) {
      const login = await service.beginLogin({}, user);
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: login.options.challenge,
          origin: badOrigin ? 'https://evil.test' : 'https://beles.test',
          crossOrigin: false,
        }),
      );
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const data = Buffer.concat([hash('beles.test'), Buffer.from([0x05]), count]);
      const signature = crypto.sign('sha256', Buffer.concat([data, hash(client)]), privateKey);
      if (tamper) signature[signature.length - 1] ^= 1;
      return {
        ticket: login.ticket,
        response: {
          id: b64(id),
          rawId: b64(id),
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: b64(client),
            authenticatorData: b64(data),
            signature: b64(signature),
            userHandle: b64(Buffer.from(owner.id)),
          },
        },
      };
    }
    const valid = await assertion();
    assert.equal((await service.finishLogin(valid)).id, owner.id);
    await assert.rejects(service.finishLogin(valid));
    user = (await accounts.users())[0];
    await assert.rejects(service.finishLogin(await assertion(2, true)));
    await assert.rejects(service.finishLogin(await assertion(2, false, true)));
    await assert.rejects(service.finishLogin(await assertion(1)), 'Reject a replayed counter');
    await assert.rejects(accounts.factor(owner.id, ''));
    await accounts.factor(owner.id, saved.recovery[0]);
    await assert.rejects(accounts.factor(owner.id, saved.recovery[0]));
    await accounts.removePasskey(owner.id, b64(id));
    assert.equal(accounts.publicUser((await accounts.users())[0]).twoFactorEnabled, false);
    const html =
      '<!doctype html><html><head></head><body><section id="hero"><h2>Hello <span>World</span></h2><a id="cta" href="/old">Go</a><img src="/logo.png" alt="Logo"></section><script>const untouched="ok";</script></body></html>';
    const link = visual.elements(html).find((node) => node.attrs.id === 'cta');
    const changed = visual.edit(html, link.id, {
      text: '<b>Safe & readable</b>',
      href: 'https://example.com',
      color: '#123456',
    });
    assert.match(changed, /&lt;b&gt;Safe &amp; readable&lt;\/b&gt;/);
    assert.match(changed, /const untouched="ok"/);
    assert.equal(visual.elements(changed).find((node) => node.attrs.id === 'cta').id, link.id);
    assert.throws(() => visual.edit(html, link.id, { href: 'javascript:alert(1)' }));
    assert.throws(() => visual.edit(html, link.id, { background: 'url(https://evil.test)' }));
    const heading = visual.elements(html).find((node) => node.tag === 'h2');
    assert.throws(() => visual.edit(html, heading.id, { text: 'Do not erase children' }));
    const base = path.join(directory, 'base.html');
    fs.writeFileSync(base, html);
    const design = require('./site-design.cjs')(directory, base, repository);
    await design.ready();
    const before = design.view();
    const draft = design.edit({
      revision: before.revision,
      part: link.id,
      element: { text: 'Visual title' },
    });
    await design.save(draft);
    assert.match(design.template(), /Visual title/);
    const preview = require('./design-preview.cjs')(design.template(), link.id);
    assert.match(preview, /data-design-element="element-/);
    assert.match(preview, /data-design-block="section-hero"/);
    await design.save(design.edit({ revision: design.view().revision, undo: true }));
    assert.equal(design.read().html, html);
    const selector = 'body [id="dynamic-card"] > h2:nth-of-type(1)';
    const liveId = 'live-' + hash(selector).toString('hex').slice(0, 20);
    const runtime = {
      selector,
      tag: 'h2',
      label: 'Dynamic heading',
      defaults: {
        text: 'Catalog title',
        textEN: '',
        color: '',
        background: '',
        fontSize: '',
        padding: '',
        borderRadius: '',
        title: '',
        hidden: false,
      },
      baseline: '<h2>Catalog title</h2>',
    };
    await design.save(
      design.edit({
        revision: design.view().revision,
        part: liveId,
        runtime,
        element: { color: '#123456' },
      }),
    );
    assert.match(design.template(), /beles-element-overrides/);
    assert.equal(
      design.view().elements.find((node) => node.id === liveId).fields.text,
      'Catalog title',
    );
    await design.save(design.edit({ revision: design.view().revision, part: liveId, value: '{}' }));
    assert.deepEqual(design.read().elementOverrides[0].fields, {});
    let now = Date.parse('2026-10-21T12:00:00Z');
    const analytics = require('./analytics.cjs')(
      directory,
      () => [],
      () => now,
    );
    const event = {
      type: 'pageview',
      visitor: 'visitor-1234567890',
      session: 'session-1234567890',
      id: 'event-id-12345678',
    };
    analytics.ingest(event, {
      headers: { 'user-agent': 'Windows Chrome/120', 'x-real-ip': '198.51.100.7' },
      socket: { remoteAddress: '203.0.113.9' },
    });
    const report = analytics.report();
    assert.equal(report.recentVisitors[0].ip, '203.0.113.9', 'Untrusted headers cannot spoof IP');
    now += 7 * 86400000;
    analytics.flush();
    assert.equal(analytics.report('2026-10-21', '2026-10-28').recentVisitors.length, 0);
    const persisted = JSON.parse(
      require('node:zlib').gunzipSync(fs.readFileSync(path.join(directory, 'analytics.json.gz'))),
    );
    assert.ok(
      Object.values(persisted.days).every((day) =>
        Object.values(day.sessions).every((session) => !session.ip),
      ),
    );
    analytics.close();
    await repository.close?.();
    console.log(
      'PASS: actual WebAuthn signatures/origin/counter/replay/recovery, safe visual edits/undo, spoof-resistant IP and retention',
    );
  } finally {
    if (previousURL === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previousURL;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
