const test = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-test-'));
  for (const f of [
    'server.cjs',
    'passkeys.cjs',
    'render.cjs',
    'page-layout.cjs',
    'storage.cjs',
    'site-design.cjs',
    'visual-elements.cjs',
    'design-preview.cjs',
    'json-store.cjs',
    'catalog.cjs',
    'http-utils.cjs',
    'accounts.cjs',
    'pdf-optimize.cjs',
    'storage-routes.cjs',
    'feedback.cjs',
    'cooperation.cjs',
    'content-migrations.cjs',
    'seo.cjs',
    'media.cjs',
    'account-routes.cjs',
    'repository.cjs',
    'security.cjs',
    'sessions.cjs',
    'audit.cjs',
    'request-security.cjs',
    'permissions.cjs',
    'analytics.cjs',
    'product-import.cjs',
    'package.json',
  ])
    fs.copyFileSync(path.join(__dirname, f), path.join(temp, f));
  fs.cpSync(path.join(__dirname, 'public'), path.join(temp, 'public'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'data'));
  for (const f of ['base.html', 'catalog.json'])
    fs.copyFileSync(path.join(__dirname, 'data', f), path.join(temp, 'data', f));
  const port = 34189;
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: temp,
    env: {
      ...process.env,
      DATABASE_URL: '',
      NODE_PATH: path.join(__dirname, 'node_modules'),
      PORT: String(port),
      BELES_STORAGE_DIR: path.join(temp, 'persistent'),
    },
  });
  let output = '';
  child.stdout.on('data', (x) => (output += x));
  try {
    await new Promise((resolve, reject) => {
      let n = 0;
      const t = setInterval(() => {
        if (output.includes('Beles:')) {
          clearInterval(t);
          resolve();
        } else if (n++ > 100) {
          clearInterval(t);
          reject(Error('Server failed'));
        }
      }, 50);
    });
    const origin = `http://127.0.0.1:${port}`;
    let cookie = '',
      csrf = '';
    async function req(url, method = 'GET', data, auth = true) {
      const r = await fetch(origin + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json() };
    }
    test.equal((await req('/api/catalog')).status, 401);
    const token = output.match(/code: ([a-f0-9]+)/)[1];
    test.equal(
      (
        await req('/api/setup', 'POST', {
          token,
          username: 'tester',
          password: 'test-password-2026',
        })
      ).status,
      200,
    );
    const login = await req('/api/login', 'POST', {
      username: 'tester',
      password: 'test-password-2026',
    });
    test.equal(login.status, 200);
    csrf = login.body.csrf;
    let catalog = (await req('/api/catalog')).body;
    test.equal(
      (
        await req('/api/setup', 'POST', {
          token,
          username: 'second',
          password: 'another-password-2026',
        })
      ).status,
      409,
    );
    test.equal((await req('/api/account')).body.administrators, 1);
    const originalLength = catalog.rows.length;
    test.ok(originalLength > 400);
    for (const row of catalog.rows)
      for (const key of ['image', 'pdfFile']) {
        if (row[key]?.startsWith('/uploads/'))
          test.ok(fs.existsSync(path.join(__dirname, row[key])), row.itemKey + ' ' + key);
        else test.ok(!/^https?:/.test(row[key] || ''), 'External media remains: ' + row.itemKey);
      }
    const record = {
      kind: 'product',
      name: 'Integration test',
      itemKey: 'integration-test',
      brand: 'MaxPlay',
      published: true,
      sort: 999,
      image: '',
      images: ['https://example.com/front.jpg', 'https://example.com/back.jpg'],
    };
    let save = await req('/api/catalog', 'POST', { record, revision: catalog.revision });
    test.equal(save.status, 200);
    test.equal(save.body.rows.length, originalLength + 1);
    test.deepEqual(
      save.body.rows.find((row) => row.itemKey === record.itemKey).images,
      record.images,
    );
    test.deepEqual(
      (await req('/api/catalog')).body.rows.find((row) => row.itemKey === record.itemKey).images,
      record.images,
    );
    for (const asset of [
      '/assets/product-gallery.js',
      '/assets/product-gallery.css',
      '/admin/gallery.js',
    ])
      test.equal((await fetch(origin + asset)).status, 200);
    test.equal(
      (await req('/api/catalog', 'POST', { record, revision: catalog.revision })).status,
      409,
    );
    test.equal(
      (await req('/api/catalog', 'POST', { record, revision: save.body.revision }, false)).status,
      401,
    );
    const html = await (await fetch(origin)).text();
    test.ok(html.includes('Integration test'));
    test.ok(html.includes(origin + '/api/feedback'));
    test.ok(!html.includes('__framer-badge'));
    const upload = await req('/api/upload', 'POST', {
      data: Buffer.from('<script>alert(1)</script>').toString('base64'),
    });
    test.equal(upload.status, 415);
    const bytes = await require('sharp')({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const uploadResponse = await fetch(origin + '/api/upload', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'image/png' },
      body: bytes,
    });
    const image = { status: uploadResponse.status, body: await uploadResponse.json() };
    test.equal(image.status, 200);
    test.equal((await fetch(origin + image.body.url)).status, 200);
    const range = await fetch(origin + image.body.url, { headers: { Range: 'bytes=0-3' } });
    test.equal(range.status, 206);
    test.equal((await range.arrayBuffer()).byteLength, 4);
    const feedback = await req(
      '/api/feedback',
      'POST',
      { name: 'Tester', contact: 'test@example.com', message: 'Integration message' },
      false,
    );
    test.equal(feedback.status, 200);
    test.equal((await req('/api/feedback')).body.items.length, 1);
    const messageId = (await req('/api/feedback')).body.items[0].id;
    test.equal((await req('/api/feedback', 'DELETE', { id: messageId }, false)).status, 401);
    test.equal(
      (
        await fetch(origin + '/api/feedback', {
          method: 'DELETE',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'invalid',
          },
          body: JSON.stringify({ id: messageId }),
        })
      ).status,
      403,
    );
    test.equal((await req('/api/feedback', 'DELETE', { ids: [] })).status, 400);
    test.equal((await req('/api/feedback', 'DELETE', { ids: [messageId] })).body.deleted, 1);
    test.equal((await req('/api/feedback')).body.items.length, 0);
    for (let i = 0; i < 2; i++)
      test.equal(
        (
          await req(
            '/api/feedback',
            'POST',
            { name: 'Batch test', contact: 'test@example.com', message: 'Batch ' + i },
            false,
          )
        ).status,
        200,
      );
    const batchIds = (await req('/api/feedback')).body.items.map((item) => item.id);
    test.equal((await req('/api/feedback', 'DELETE', { ids: batchIds })).body.deleted, 2);
    test.equal((await req('/api/feedback')).body.items.length, 0);
    const logo = require('./public/brand-logos/manifest.json').find((item) => item.src);
    test.equal((await fetch(origin + logo.src)).status, 200);
    const del = await req('/api/catalog', 'DELETE', {
      originalKey: record.itemKey,
      originalKind: 'product',
      revision: save.body.revision,
    });
    test.equal(del.status, 200);
    test.equal(del.body.rows.length, originalLength);
    await req('/api/logout', 'POST', {});
    test.equal((await req('/api/catalog')).status, 401);
    fs.unlinkSync(path.join(temp, 'persistent/data/admin.json'));
    test.equal((await req('/api/status')).body.configured, true);
    test.equal(
      (
        await req('/api/setup', 'POST', {
          token,
          username: 'second',
          password: 'another-password-2026',
        })
      ).status,
      409,
    );
    console.log(
      'PASS: auth, setup, CRUD, conflict, public rendering, upload rejection, HTTP Range, feedback, logout, one-admin registration lock',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
    const cleanupPath = path.resolve(temp);
    if (
      path.dirname(cleanupPath) !== path.resolve(os.tmpdir()) ||
      !path.basename(cleanupPath).startsWith('beles-test-')
    )
      throw Error('Unexpected test cleanup path');
    fs.rmSync(cleanupPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
