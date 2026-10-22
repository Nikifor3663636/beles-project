const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'beles-features-'));
  let child;
  try {
    for (const file of [
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
    ])
      fs.copyFileSync(path.join(__dirname, file), path.join(temp, file));
    fs.cpSync(path.join(__dirname, 'public'), path.join(temp, 'public'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'data'));
    for (const file of ['base.html', 'catalog.json'])
      fs.copyFileSync(path.join(__dirname, 'data', file), path.join(temp, 'data', file));
    const salt = crypto.randomBytes(16).toString('hex');
    const oldPassword = 'original-password-2026';
    fs.writeFileSync(
      path.join(temp, 'data/admin.json'),
      JSON.stringify({
        username: 'original',
        salt,
        password: crypto.scryptSync(oldPassword, salt, 64).toString('hex'),
      }),
    );
    fs.writeFileSync(path.join(temp, 'data/admin.initialized'), 'configured');
    fs.writeFileSync(
      path.join(temp, 'data/integrations.json'),
      JSON.stringify({ clarityProjectId: 'legacy123' }),
    );
    const origin = 'http://127.0.0.1:34291';
    child = spawn(process.execPath, ['server.cjs'], {
      cwd: temp,
      env: {
        ...process.env,
        DATABASE_URL: '',
        NODE_PATH: path.join(__dirname, 'node_modules'),
        HOST: '127.0.0.1',
        PORT: '34291',
        BELES_STORAGE_DIR: '',
        PUBLIC_URL: '',
        COOKIE_SECURE: 'false',
      },
    });
    let output = '';
    child.stdout.on('data', (x) => (output += x));
    child.stderr.on('data', (x) => (output += x));
    await new Promise((resolve, reject) => {
      let tries = 0;
      const timer = setInterval(() => {
        if (output.includes('Beles:')) {
          clearInterval(timer);
          resolve();
        } else if (++tries > 100) {
          clearInterval(timer);
          reject(Error(output));
        }
      }, 50);
    });
    async function request(route, method = 'GET', body, auth, extra = {}) {
      const r = await fetch(origin + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...auth, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: r.status,
        body: await r.json(),
        cookie: r.headers.get('set-cookie')?.split(';')[0],
      };
    }
    const login = await request('/api/login', 'POST', {
      username: 'original',
      password: oldPassword,
    });
    assert.equal(login.status, 200);
    const owner = { Cookie: login.cookie, 'X-CSRF-Token': login.body.csrf };
    assert.equal((await request('/api/site-design')).status, 401);
    assert.equal(
      (await request('/api/site-design', 'POST', {}, { Cookie: login.cookie })).status,
      403,
    );
    const design = (await request('/api/site-design', 'GET', undefined, owner)).body;
    assert.ok(design.parts.some((p) => p.id === 'section-top'));
    assert.ok(design.parts.some((p) => p.id === 'footer-1'));
    const designChange = {
      revision: design.revision,
      part: 'css',
      value: 'body{outline:3px solid red}',
    };
    const previewResponse = await request('/api/site-design/preview', 'POST', designChange, owner);
    assert.equal(previewResponse.status, 200, JSON.stringify(previewResponse.body));
    const preview = previewResponse.body;
    assert.equal((await fetch(origin + preview.url)).status, 404);
    const page = await fetch(origin + preview.url, { headers: owner });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts/);
    const previewHTML = await page.text();
    assert.match(previewHTML, /outline:3px solid red/);
    assert.match(previewHTML, /data-design-block="footer-1"/);
    assert.match(previewHTML, /beles:select-block/);
    assert.equal(
      (await request('/api/site-design', 'GET', undefined, owner)).body.revision,
      design.revision,
    );
    const saved = (await request('/api/site-design', 'POST', designChange, owner)).body;
    assert.ok(saved.canUndo);
    assert.equal((await request('/api/site-design', 'POST', designChange, owner)).status, 409);
    assert.match(await (await fetch(origin)).text(), /outline:3px solid red/);
    const originalDownload = await fetch(
      origin + '/api/site-design/download?original=1&part=html',
      { headers: owner },
    );
    assert.match(originalDownload.headers.get('content-disposition'), /attachment/);
    assert.equal(await originalDownload.text(), design.originals.html);
    const restored = (
      await request('/api/site-design', 'POST', { revision: saved.revision, undo: true }, owner)
    ).body;
    assert.equal(restored.values.css, '');
    assert.equal(
      (await request('/api/import-product', 'POST', { url: 'http://127.0.0.1' })).status,
      401,
    );
    assert.equal(
      (await request('/api/import-product', 'POST', {}, { Cookie: login.cookie })).status,
      403,
    );
    assert.equal(
      (await request('/api/import-product', 'POST', { url: 'http://127.0.0.1' }, owner)).status,
      400,
    );
    const savedHTML =
      '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'Product',
        name: 'Saved toy',
        sku: '889-299',
        brand: { name: 'Beibe Good' },
        image: 'https://chudo-ostriv.com.ua/media/toy.png',
      }) +
      '</script><table><tr><th>Матеріал</th><td>Пластик</td></tr></table>';
    const beforeImport = (await request('/api/catalog', 'GET', undefined, owner)).body.revision;
    const imported = await request(
      '/api/import-product',
      'POST',
      { url: 'https://chudo-ostriv.com.ua/ua/toy.html', html: savedHTML },
      owner,
    );
    assert.equal(imported.status, 200);
    assert.equal(imported.body.draft.sku, '889-299');
    assert.equal(imported.body.draft.material, 'Пластик');
    assert.equal(
      (await request('/api/catalog', 'GET', undefined, owner)).body.revision,
      beforeImport,
    );
    assert.equal(
      (
        await request(
          '/api/import-product',
          'POST',
          { url: 'https://chudo-ostriv.com.ua', html: '<title>Just a moment...</title>' },
          owner,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/import-product',
          'POST',
          { url: 'file:///etc/passwd', html: savedHTML },
          owner,
        )
      ).status,
      400,
    );
    assert.equal((await request('/api/integrations', 'GET')).status, 401);
    assert.equal(
      (
        await request(
          '/api/integrations',
          'POST',
          { gaMeasurementId: 'G-TEST123456' },
          { Cookie: login.cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/api/integrations', 'POST', { gaMeasurementId: '<script>' }, owner)).status,
      400,
    );
    assert.equal(
      (await request('/api/integrations', 'POST', { gaMeasurementId: 'G-TEST123456' }, owner))
        .status,
      200,
    );
    assert.equal((await request('/api/public-integrations')).body.gaMeasurementId, 'G-TEST123456');
    assert.equal(
      (await request('/api/public-integrations', 'GET', undefined, owner)).body.gaMeasurementId,
      '',
    );
    assert.equal(
      (await request('/api/integrations', 'POST', { gaMeasurementId: '' }, owner)).status,
      200,
    );
    assert.equal((await request('/api/public-integrations')).body.clarityProjectId, '');
    assert.equal(
      (await request('/api/integrations', 'POST', { clarityProjectId: 'abc123' }, owner)).status,
      400,
    );
    assert.equal(
      (await request('/api/integrations', 'POST', { gaMeasurementId: 'g-test123456' }, owner)).body
        .gaMeasurementId,
      'G-TEST123456',
    );
    assert.equal(
      (await request('/api/integrations', 'POST', { gaMeasurementId: '' }, owner)).status,
      200,
    );
    assert.equal((await request('/api/account', 'GET', undefined, owner)).body.administrators, 1);
    assert.equal((await request('/api/admins', 'POST', {})).status, 401);
    assert.equal((await request('/api/admins', 'POST', {}, { Cookie: login.cookie })).status, 403);
    assert.equal(
      (
        await request(
          '/api/admins',
          'POST',
          { username: 'second', password: 'second-password-2026', permissions: ['owner'] },
          owner,
        )
      ).status,
      400,
    );
    const results = await Promise.all(
      ['second', 'third'].map((username) =>
        request(
          '/api/admins',
          'POST',
          {
            username,
            password: 'second-password-2026',
            permissions: require('./permissions.cjs').legacy,
          },
          owner,
        ),
      ),
    );
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 201]);
    const added = results.find((x) => x.status === 201).body.user.username;
    const account = await request('/api/account', 'GET', undefined, owner);
    assert.equal(account.body.administrators, 3);
    assert.ok(!JSON.stringify(account.body).includes('salt'));
    assert.equal((await request('/api/setup', 'POST', {})).status, 409);
    const secondLogin = await request('/api/login', 'POST', {
      username: added,
      password: 'second-password-2026',
    });
    assert.equal(secondLogin.status, 200);
    const second = { Cookie: secondLogin.cookie, 'X-CSRF-Token': secondLogin.body.csrf };
    const ownProfile = await request('/api/account', 'GET', undefined, second);
    assert.equal(ownProfile.body.role, 'admin');
    assert.equal(ownProfile.body.users, undefined);
    assert.equal(ownProfile.body.administrators, undefined);
    for (const route of [
      '/api/site-design',
      '/api/site-design/download',
      '/api/backup',
      '/api/admins',
      '/api/audit',
      '/api/storage',
      '/api/storage/orphans',
      '/api/integrations',
    ])
      assert.equal((await request(route, 'GET', undefined, second)).status, 403, route);
    assert.equal((await request('/api/site-design/preview', 'POST', {}, second)).status, 403);
    assert.equal((await request('/api/editorial-preview', 'POST', {}, second)).status, 403);
    assert.equal(
      (await request('/api/profile', 'PATCH', { name: 'Attack', role: 'owner' }, second)).status,
      400,
    );
    const ownerProfile = (await request('/api/account', 'GET', undefined, owner)).body;
    assert.equal(
      (await request('/api/sessions', 'DELETE', { id: ownerProfile.sessions[0].id }, second))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          '/api/admins',
          'PATCH',
          { id: ownerProfile.id, action: 'disable', currentPassword: oldPassword },
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request('/api/profile', 'PATCH', { name: 'Valid', avatar: '' }, second, {
          Origin: 'https://attacker.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request('/api/profile', 'PATCH', { name: 'Valid', avatar: '' }, second)).status,
      200,
    );

    assert.equal(
      (
        await request(
          '/api/password',
          'POST',
          { current: oldPassword, password: 'new-second-password-2026' },
          second,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/password',
          'POST',
          { current: 'second-password-2026', password: 'new-second-password-2026' },
          second,
        )
      ).status,
      200,
    );
    assert.equal((await request('/api/account', 'GET', undefined, second)).status, 401);
    assert.equal((await request('/api/account', 'GET', undefined, owner)).status, 200);
    assert.equal(
      (
        await request('/api/login', 'POST', {
          username: added,
          password: 'new-second-password-2026',
        })
      ).status,
      200,
    );
    assert.equal((await request('/api/analytics')).status, 401);
    const event = {
      type: 'pageview',
      visitor: crypto.randomUUID(),
      session: crypto.randomUUID(),
      id: crypto.randomUUID(),
      language: 'uk',
    };
    assert.equal(
      (
        await request('/api/events', 'POST', event, undefined, {
          Origin: 'https://attacker.example',
        })
      ).status,
      403,
    );
    assert.equal((await request('/api/events', 'POST', event, owner)).body.tracked, false);
    assert.equal((await request('/api/events', 'POST', event)).body.tracked, true);
    assert.equal((await request('/api/events', 'POST', event)).body.tracked, false);
    const report = (await request('/api/analytics', 'GET', undefined, owner)).body;
    assert.equal(report.views, 1);
    assert.equal(report.visitors, 1);
    assert.equal(report.online, 1);
    const oldAccount = JSON.parse(fs.readFileSync(path.join(temp, 'data/admin.json')));
    assert.equal(oldAccount.users[0].username, 'original');
    assert.equal(oldAccount.users.length, 3);

    // An owner can navigate all sections after the previous five-minute prompt window.
    const sessionFile = path.join(temp, 'data/sessions.json');
    const expiredFreshness = JSON.parse(fs.readFileSync(sessionFile));
    for (const [, value] of expiredFreshness) value.reauthUntil = 0;
    fs.writeFileSync(sessionFile, JSON.stringify(expiredFreshness));
    for (const route of [
      '/api/site-design',
      '/api/storage',
      '/api/audit',
      '/api/integrations',
      '/api/backup',
    ])
      assert.equal((await request(route, 'GET', undefined, owner)).status, 200, route);

    const restricted = await request(
      '/api/admins',
      'POST',
      {
        username: 'restricted',
        password: 'restricted-password-2026',
        permissions: ['product.read'],
      },
      owner,
    );
    assert.equal(restricted.status, 201);
    const restrictedLogin = await request('/api/login', 'POST', {
      username: 'restricted',
      password: 'restricted-password-2026',
    });
    const limited = { Cookie: restrictedLogin.cookie, 'X-CSRF-Token': restrictedLogin.body.csrf };
    let limitedCatalog = (await request('/api/catalog', 'GET', undefined, limited)).body;
    assert.ok(limitedCatalog.rows.some((row) => row.kind === 'product'));
    assert.ok(limitedCatalog.rows.every((row) => ['product', 'brand'].includes(row.kind)));
    assert.ok(
      limitedCatalog.rows
        .filter((row) => row.kind === 'brand')
        .every((row) => !row.descriptionUA && !row.image),
    );
    assert.equal(
      (
        await request(
          '/api/catalog',
          'POST',
          { revision: limitedCatalog.revision, record: { kind: 'product' } },
          limited,
        )
      ).status,
      403,
    );
    assert.equal((await request('/api/analytics', 'GET', undefined, limited)).status, 403);
    assert.equal(
      (
        await request(
          '/api/admins',
          'POST',
          {
            username: 'attacker',
            password: 'attacker-password-2026',
            permissions: ['design.write'],
          },
          limited,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/api/profile',
          'PATCH',
          { name: 'Escalation', permissions: ['design.write'] },
          limited,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/admins',
          'PATCH',
          { id: restricted.body.user.id, action: 'permissions', permissions: ['owner'] },
          owner,
        )
      ).status,
      400,
    );

    assert.equal(
      (
        await request(
          '/api/admins',
          'PATCH',
          { id: restricted.body.user.id, action: 'permissions', permissions: ['analytics.read'] },
          owner,
        )
      ).status,
      200,
    );
    assert.equal((await request('/api/analytics', 'GET', undefined, limited)).status, 200);
    assert.deepEqual((await request('/api/catalog', 'GET', undefined, limited)).body.rows, []);

    const granted = await request(
      '/api/admins',
      'PATCH',
      { id: restricted.body.user.id, action: 'permissions', permissions: ['product.write'] },
      owner,
    );
    assert.ok(granted.body.user.permissions.includes('product.read'));
    assert.equal((await request('/api/analytics', 'GET', undefined, limited)).status, 403);
    limitedCatalog = (await request('/api/catalog', 'GET', undefined, limited)).body;
    const ownRecord = {
      kind: 'product',
      itemKey: 'permissions-check',
      name: 'Permissions test',
      published: true,
      sort: 0,
    };
    const savedLimited = await request(
      '/api/catalog',
      'POST',
      { revision: limitedCatalog.revision, record: ownRecord },
      limited,
    );
    assert.equal(savedLimited.status, 200);
    assert.ok(savedLimited.body.rows.every((row) => ['product', 'brand'].includes(row.kind)));
    assert.equal(
      (
        await request(
          '/api/catalog',
          'POST',
          {
            revision: savedLimited.body.revision,
            record: { kind: 'brand', itemKey: 'forbidden', name: 'Forbidden' },
          },
          limited,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/api/catalog',
          'DELETE',
          {
            revision: savedLimited.body.revision,
            originalKey: ownRecord.itemKey,
            originalKind: 'product',
          },
          limited,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          '/api/admins',
          'PATCH',
          { id: ownerProfile.id, action: 'permissions', permissions: [] },
          owner,
        )
      ).status,
      409,
    );

    const oldCookie = owner.Cookie;
    const refreshed = await request('/api/reauth', 'POST', { currentPassword: oldPassword }, owner);
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.cookie, oldCookie);
    assert.notEqual(refreshed.body.csrf, owner['X-CSRF-Token']);
    assert.equal(
      (await request('/api/account', 'GET', undefined, { Cookie: oldCookie })).status,
      401,
    );
    owner.Cookie = refreshed.cookie;
    owner['X-CSRF-Token'] = refreshed.body.csrf;
    assert.equal((await request('/api/account', 'GET', undefined, owner)).status, 200);
    const lead = await request('/api/feedback', 'POST', {
      name: 'Local test',
      contact: 'test@example.com',
      theme: 'delivery',
      shopFormat: 'shop',
      message: '',
    });
    assert.equal(lead.status, 200);
    const leadList = (await request('/api/feedback', 'GET', undefined, owner)).body.items;
    assert.equal(leadList[0].theme, 'delivery');
    assert.equal(leadList[0].shopFormat, 'shop');
    const analyticsPath = path.join(temp, 'analytics-test');
    fs.mkdirSync(analyticsPath);
    let now = Date.parse('2026-10-17T12:00:00Z');
    const catalog = [
      { kind: 'product', itemKey: 'toy', name: 'Toy', brand: 'Brand', published: true },
      { kind: 'brand', itemKey: 'brand', name: 'Brand', published: true },
    ];
    const factory = require('./analytics.cjs');
    let analytics = factory(
      analyticsPath,
      () => catalog,
      () => now,
    );
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone) AppleWebKit Safari/605', host: 'beles.test' },
    };
    const input = { ...event, referrer: 'https://google.com/search?q=private', source: 'campaign' };
    analytics.ingest(input, req);
    now += 30000;
    analytics.ingest({ ...input, id: crypto.randomUUID(), type: 'heartbeat', seconds: 99999 }, req);
    analytics.ingest({ ...input, id: crypto.randomUUID(), type: 'product', key: 'toy' }, req);
    analytics.ingest({ ...input, id: crypto.randomUUID(), type: 'scroll', depth: 75 }, req);
    let r = analytics.report('2026-10-17', '2026-10-17');
    assert.equal(r.avgSeconds, 30);
    assert.equal(r.products[0].name, 'Toy');
    assert.equal(r.avgScroll, 75);
    assert.equal(r.devices['Телефон'], 1);
    assert.throws(
      () =>
        analytics.ingest(
          { ...input, id: crypto.randomUUID(), type: 'product', key: 'missing' },
          req,
        ),
      /Unknown/,
    );
    assert.equal(
      analytics.ingest(
        { ...input, id: crypto.randomUUID() },
        { headers: { 'user-agent': 'Googlebot' } },
      ),
      false,
    );
    assert.equal(
      analytics.ingest({ ...input, id: crypto.randomUUID() }, { headers: { dnt: '1' } }),
      false,
    );
    now += 91000;
    assert.equal(analytics.report('2026-10-17', '2026-10-17').online, 0);
    analytics.close();
    analytics = factory(
      analyticsPath,
      () => catalog,
      () => now,
    );
    r = analytics.report('2026-10-17', '2026-10-17');
    assert.equal(r.views, 1);
    assert.equal(r.products[0].count, 1);
    assert.equal(r.online, 0);
    assert.throws(() => analytics.report('2026-02-30', '2026-10-17'));
    analytics.close();
    console.log(
      'PASS: legacy login, concurrent unlimited-admin creation, CSRF/auth, isolated password changes, analytics access, events, deduplication, devices, online expiry, persistence',
    );
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      await closed;
    }
    if (
      path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) ||
      !path.basename(temp).startsWith('beles-features-')
    )
      throw Error('Unexpected cleanup path');
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
