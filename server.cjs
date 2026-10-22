const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const buildPage = require('./render.cjs');
const seo = require('./seo.cjs');
const cooperation = require('./cooperation.cjs');
const preparePreview = require('./design-preview.cjs');
const repositoryFactory = require('./repository.cjs');
const { fail } = require('./security.cjs');
const requestSecurity = require('./request-security.cjs');
const permissions = require('./permissions.cjs');
const { revision, validate } = require('./catalog.cjs');
const { json, body, serve } = require('./http-utils.cjs');
const ROOT = __dirname,
  { data: DATA, uploads: UP } = require('./storage.cjs')(ROOT);
const PORT = Number(process.env.PORT || 3000),
  HOST = process.env.HOST || '127.0.0.1';
const configFile = path.join(DATA, 'admin.json'),
  catalogFile = path.join(DATA, 'catalog.json'),
  feedbackFile = path.join(DATA, 'feedback.json'),
  initializedFile = path.join(DATA, 'admin.initialized');
const repository = repositoryFactory(DATA);
let setupToken = '',
  configured = true,
  bootError = null,
  catalogCache = [];
async function read(file, fallback) {
  const value = await repository.read(path.basename(file), fallback);
  if (file === catalogFile) catalogCache = value;
  return value;
}
async function write(file, value) {
  await repository.write(path.basename(file), value);
  if (file === catalogFile) catalogCache = value;
}
const accounts = require('./accounts.cjs')(configFile, repository);
const sessionManager = require('./sessions.cjs')(repository, accounts);
const passkeys = require('./passkeys.cjs')(accounts);
const audit = require('./audit.cjs')(repository);
const media = require('./media.cjs')(UP, repository);
const accountRoutes = require('./account-routes.cjs')({
  accounts,
  sessions: sessionManager,
  audit,
  passkeys,
});
const analytics = require('./analytics.cjs')(DATA, () => catalogCache);
const siteDesign = require('./site-design.cjs')(
    DATA,
    path.join(ROOT, 'data/base.html'),
    repository,
  ),
  designPreviews = new Map();
const storageRoutes = require('./storage-routes.cjs')({
  media,
  repository,
  directory: UP,
  root: ROOT,
  design: siteDesign,
  audit,
});
const readiness = (async () => {
  await repository.ready();
  await media.ready();
  await siteDesign.ready();
  configured = await repository.initialized();
  if (
    repository.mode === 'postgres' &&
    !configured &&
    (fs.existsSync(configFile) || fs.existsSync(initializedFile))
  )
    fail(503, 'Спочатку імпортуйте існуючі дані у PostgreSQL.');
  catalogCache = await repository.read('catalog.json', []);
  await require('./content-migrations.cjs').apply(repository);
  catalogCache = await repository.read('catalog.json', []);
  if (!configured) {
    setupToken = crypto.randomBytes(24).toString('hex');
    console.log('First-time setup: open /admin and enter this one-time setup code:', setupToken);
  }
})().catch((error) => {
  bootError = error;
  configured = true;
});
process.on('SIGTERM', () => {
  analytics.close();
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
});
process.on('SIGINT', () => {
  analytics.close();
  process.exit(0);
});
const attempts = new Map(),
  importsActive = new Set();
const session = (req) => sessionManager.get(req);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.PUBLIC_URL?.startsWith('https://'))
    res.setHeader('Strict-Transport-Security', 'max-age=86400');
  let u, route;
  try {
    u = new URL(req.url, 'http://localhost');
    route = u.pathname;
  } catch {
    return json(res, 400, { error: 'Invalid request URL' });
  }
  try {
    await readiness;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = new URL(process.env.PUBLIC_URL || `http://${req.headers.host}`).origin;
      if (
        (req.headers.origin && req.headers.origin !== expected) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return json(res, 403, { error: 'Origin not allowed' });
    }
    if (route === '/health') {
      let available = !bootError;
      try {
        await repository.ready();
      } catch {
        available = false;
      }
      return json(res, available ? 200 : 503, { ok: available, storage: repository.mode });
    }
    if (bootError && (route === '/' || route.startsWith('/api/')))
      return json(res, 503, {
        error: 'База даних недоступна або потребує міграції. Зверніться до власника.',
        configured: true,
      });
    if (route.startsWith('/api/')) res.setHeader('X-Robots-Tag', 'noindex');
    if (route === '/') {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https: blob:; style-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
      );
    }
    if (route.startsWith('/admin')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'",
      );
    }
    if (req.method === 'GET' && (route === '/admin' || route === '/admin/'))
      return serve(res, path.join(ROOT, 'public/admin/index.html'), 'text/html; charset=utf-8');
    if (
      ['GET', 'HEAD'].includes(req.method) &&
      ['/favicon.png', '/apple-touch-icon.png'].includes(route)
    )
      return serve(res, path.join(ROOT, 'public', route.slice(1)), 'image/png', req);
    if (req.method === 'GET' && ['/robots.txt', '/sitemap.xml'].includes(route)) {
      res.writeHead(200, {
        'Content-Type': route.endsWith('.xml')
          ? 'application/xml; charset=utf-8'
          : 'text/plain; charset=utf-8',
      });
      return res.end(route.endsWith('.xml') ? seo.sitemap() : seo.robots());
    }
    if (
      req.method === 'GET' &&
      /^\/locales\/(en|pl|de|fr|es|it|ro|cs|sk|hu|bg|tr|nl|pt|el|sv|da|fi|no|ja|ko|zh-CN|ar|he)\.json$/.test(
        route,
      )
    )
      return serve(
        res,
        path.join(ROOT, 'public', route.slice(1)),
        'application/json; charset=utf-8',
        req,
      );
    if (
      req.method === 'GET' &&
      [
        '/assets/cooperation.js',
        '/assets/cooperation.css',
        '/assets/product-gallery.js',
        '/assets/product-gallery.css',
      ].includes(route)
    )
      return serve(
        res,
        path.join(ROOT, 'public', path.basename(route)),
        route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      );
    if (req.method === 'GET' && route === '/assets/analytics.js')
      return serve(res, path.join(ROOT, 'public/analytics.js'), 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && route === '/assets/visual-elements.js')
      return serve(
        res,
        path.join(ROOT, 'public/visual-elements.js'),
        'text/javascript; charset=utf-8',
      );
    if (req.method === 'GET' && route === '/assets/benefit-copy.js')
      return serve(
        res,
        path.join(ROOT, 'public/benefit-copy.js'),
        'text/javascript; charset=utf-8',
      );
    if (req.method === 'GET' && route === '/assets/contact-message.js')
      return serve(
        res,
        path.join(ROOT, 'public/contact-message.js'),
        'text/javascript; charset=utf-8',
      );
    if (['GET', 'HEAD'].includes(req.method) && route === '/favicon.svg')
      return serve(res, path.join(ROOT, 'public/favicon.svg'), 'image/svg+xml', req);
    if (['GET', 'HEAD'].includes(req.method) && route === '/favicon.ico') {
      res.writeHead(302, { Location: '/favicon.png' });
      return res.end();
    }
    if (route.startsWith('/design-preview/') && req.method === 'GET') {
      const p = designPreviews.get(route.slice('/design-preview/'.length));
      if (!p || p.until < Date.now() || p.session !== (await session(req))?.id)
        return json(res, 404, { error: 'Preview expired' });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'",
      });
      return res.end(p.html);
    }
    if (req.method === 'GET' && route === '/assets/clarity.js')
      return serve(res, path.join(ROOT, 'public/clarity.js'), 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && route === '/assets/google-analytics.js')
      return serve(
        res,
        path.join(ROOT, 'public/google-analytics.js'),
        'text/javascript; charset=utf-8',
      );
    if (req.method === 'GET' && route === '/api/public-integrations')
      return json(res, 200, {
        clarityProjectId: '',
        gaMeasurementId: (await session(req))
          ? ''
          : (await read(path.join(DATA, 'integrations.json'), {})).gaMeasurementId || '',
      });
    if (route === '/api/events' && req.method === 'POST') {
      const origin = req.headers.origin;
      const expected = new URL(process.env.PUBLIC_URL || `http://${req.headers.host}`).origin;
      if ((origin && origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site')
        return json(res, 403, { error: 'Origin not allowed' });
      const event = await body(req, 8192);
      if (await session(req)) return json(res, 200, { ok: true, tracked: false });
      return json(res, 200, { ok: true, tracked: analytics.ingest(event, req) });
    }
    if (req.method === 'GET' && route === '/assets/fonts.css')
      return serve(res, path.join(ROOT, 'public/fonts.css'), 'text/css');
    if (
      req.method === 'GET' &&
      [
        '/admin/app.js',
        '/admin/gallery.js',
        '/admin/storage.js',
        '/admin/security.js',
        '/admin/site-design.js',
        '/admin/feedback.js',
        '/admin/analytics-chart.js',
        '/admin/webauthn-browser.js',
        '/admin/integrations.js',
        '/admin/analytics.js',
        '/admin/style.css',
      ].includes(route)
    )
      return serve(
        res,
        path.join(ROOT, 'public', route),
        route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css',
      );
    if (route === '/api/status' && req.method === 'GET') {
      const s = await session(req);
      return json(res, 200, {
        configured,
        authenticated: !!s,
        user: s ? accounts.publicUser(s.user) : undefined,
        csrf: s?.csrf,
      });
    }
    if (req.method === 'POST' && ['/api/setup', '/api/login'].includes(route)) {
      const ip = requestSecurity.client(req);
      requestSecurity.limit('login-ip:' + ip, 15, 900000);
      const a = attempts.get(ip) || { count: 0, until: Date.now() + 900000 };
      if (a.until < Date.now()) {
        a.count = 0;
        a.until = Date.now() + 900000;
      }
      if (a.count >= 10)
        return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      a.count++;
      attempts.set(ip, a);
      const b = await body(req, 8192);
      requestSecurity.limit(
        'login-account:' +
          String(b.username || '')
            .trim()
            .toLowerCase()
            .slice(0, 80),
        10,
        900000,
      );
      if (route === '/api/setup') {
        if (await repository.initialized()) return json(res, 409, { error: 'Already configured' });
        if (b.token !== setupToken) return json(res, 403, { error: 'Invalid setup code' });
        await accounts.create(b.username, b.password);
        await repository.markInitialized();
        configured = true;
        setupToken = '';
        return json(res, 200, { ok: true });
      }
      const c = (await accounts.users()).find(
        (u) =>
          u.username.toLowerCase() ===
          String(b.username || '')
            .trim()
            .toLowerCase(),
      );
      if (
        !(await accounts.verify(
          c || {
            enabled: true,
            salt: 'beles-dummy',
            password: '0'.repeat(128),
            passwordVersion: 2,
          },
          b.password,
        ))
      ) {
        await audit.record('auth.failed', null, null, 'invalid_credentials');
        return json(res, 401, { error: 'Incorrect login or password' });
      }
      if (c.totp && !b.code && !(c.passkeys || []).length)
        return json(res, 401, {
          error: 'Вкажіть код 2FA або резервний код.',
          requiresTwoFactor: true,
        });
      if (b.code) await accounts.factor(c.id, b.code);
      else if ((c.passkeys || []).length) return json(res, 200, await passkeys.beginLogin(req, c));
      attempts.delete(ip);
      const created = await sessionManager.create(c.id, req);
      res.setHeader(
        'Set-Cookie',
        `beles_session=${created.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
      );
      await audit.record('auth.login', c.id);
      return json(res, 200, { ok: true, csrf: created.csrf, user: accounts.publicUser(c) });
    }
    if (route === '/api/passkey-login' && req.method === 'POST') {
      requestSecurity.limit('passkey-login:' + requestSecurity.client(req), 15, 900000);
      const user = await passkeys.finishLogin(await body(req, 32768));
      const created = await sessionManager.create(user.id, req);
      res.setHeader(
        'Set-Cookie',
        `beles_session=${created.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
      );
      await audit.record('auth.passkey', user.id);
      return json(res, 200, { ok: true, csrf: created.csrf, user: accounts.publicUser(user) });
    }
    if (route === '/api/feedback' && req.method === 'POST') {
      const item = require('./feedback.cjs')(await body(req, 8192));
      requestSecurity.limit('feedback:' + requestSecurity.client(req), 3, 60000);
      await repository.mutate(
        'feedback.json',
        (items) => {
          items.unshift(item);
          return { value: items };
        },
        [],
      );
      return json(res, 200, { ok: true });
    }
    if (route.startsWith('/api/')) {
      const s = await session(req);
      if (!s) return json(res, 401, { error: 'Login required' });
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== s.csrf)
        return json(res, 403, { error: 'Invalid CSRF token' });
      const routePermissions = {
        '/api/site-design': req.method === 'GET' ? 'design.read' : 'design.write',
        '/api/site-design/download': 'design.read',
        '/api/site-design/preview': 'design.read',
        '/api/editorial-preview': 'storage.read',
        '/api/integrations': 'analytics.write',
        '/api/backup': 'backup.export',
        '/api/audit': 'storage.read',
        '/api/analytics': 'analytics.read',
        '/api/import-product': 'product.write',
        '/api/feedback': req.method === 'GET' ? 'feedback.read' : 'feedback.write',
      };
      if (routePermissions[route]) permissions.requirePermission(s, routePermissions[route]);
      if (route.startsWith('/api/storage'))
        permissions.requirePermission(s, req.method === 'GET' ? 'storage.read' : 'storage.write');
      if (await accountRoutes(req, res, route, s)) return;
      if (route === '/api/editorial-preview' && req.method === 'POST') {
        const token = crypto.randomBytes(24).toString('hex');
        designPreviews.set(token, {
          session: s.id,
          until: Date.now() + 600000,
          html: cooperation.enhance(buildPage(siteDesign.template(), await read(catalogFile, []))),
        });
        return json(res, 200, { url: '/design-preview/' + token });
      }
      if (route === '/api/logout' && req.method === 'POST') {
        await sessionManager.logout(s.id);
        res.setHeader('Set-Cookie', 'beles_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(res, 200, { ok: true });
      }
      if (route === '/api/catalog' && req.method === 'GET') {
        const rows = await read(catalogFile, []);
        return json(res, 200, {
          rows: permissions.visibleRows(rows, s.user),
          revision: revision(rows),
        });
      }
      if (route === '/api/site-design' && req.method === 'GET')
        return json(res, 200, siteDesign.view());
      if (route === '/api/site-design/download' && req.method === 'GET') {
        const part = u.searchParams.get('part') || 'html';
        const state =
          u.searchParams.get('original') === '1' ? siteDesign.original() : siteDesign.read();
        const value =
          u.searchParams.get('original') === '1'
            ? siteDesign.view().originals[part]
            : siteDesign.value(state, part);
        if (typeof value !== 'string') fail(404, 'Вихідну версію елемента не знайдено.');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Disposition':
            'attachment; filename="beles-' +
            part.replace(/[^a-z0-9-]/gi, '') +
            (part === 'colors' ? '.json' : part === 'css' ? '.css' : '.html') +
            '"',
        });
        return res.end(value);
      }
      if (
        ['/api/site-design', '/api/site-design/preview'].includes(route) &&
        req.method === 'POST'
      ) {
        const b = await body(req, 4 * 1024 * 1024),
          draft = siteDesign.edit(b);
        if (route.endsWith('/preview')) {
          for (const [k, v] of designPreviews)
            if (v.until < Date.now() || v.session === s.id) designPreviews.delete(k);
          const token = crypto.randomBytes(24).toString('hex');
          designPreviews.set(token, {
            session: s.id,
            until: Date.now() + 600000,
            html: buildPage(
              preparePreview(siteDesign.template(draft), b.part),
              await read(catalogFile, []),
            ),
          });
          return json(res, 200, { url: '/design-preview/' + token });
        }
        const saved = await siteDesign.save(draft, b.revision);
        await audit.record('design.publish', s.userId);
        return json(res, 200, saved);
      }
      if (route === '/api/import-product' && req.method === 'POST') {
        if (importsActive.has(s.id))
          return json(res, 429, { error: 'Імпорт уже виконується. Зачекайте.' });
        const b = await body(req, 4 * 1024 * 1024);
        if (typeof b.url !== 'string') throw Error('Вкажіть посилання на товар.');
        const importer = require('./product-import.cjs');
        if (b.html !== undefined) {
          if (typeof b.html !== 'string' || Buffer.byteLength(b.html) > 3 * 1024 * 1024)
            throw Error('HTML-файл має бути не більше 3 МБ.');
          const source = importer.safeURL(b.url);
          const result = importer.parse(b.html, source.href);
          result.warnings.unshift(
            'Імпорт зі збереженої сторінки. Дані відповідають моменту її збереження.',
          );
          return json(res, 200, result);
        }
        importsActive.add(s.id);
        try {
          return json(res, 200, await importer.importProduct(b.url));
        } finally {
          importsActive.delete(s.id);
        }
      }
      if (route === '/api/integrations' && req.method === 'GET')
        return json(res, 200, {
          gaMeasurementId:
            (await read(path.join(DATA, 'integrations.json'), {})).gaMeasurementId || '',
        });
      if (route === '/api/integrations' && req.method === 'POST') {
        const b = await body(req, 8192),
          id = String(b.gaMeasurementId || '')
            .trim()
            .toUpperCase();
        if (!Object.hasOwn(b, 'gaMeasurementId'))
          throw Error('Оновіть адмінку та вкажіть Measurement ID Google Analytics.');
        if (id && !/^G-[A-Z0-9]{4,20}$/.test(id))
          throw Error('Вставте Measurement ID GA4 у форматі G-XXXXXXXXXX.');
        await write(path.join(DATA, 'integrations.json'), {
          gaMeasurementId: id,
          clarityProjectId: '',
        });
        return json(res, 200, { ok: true, gaMeasurementId: id });
      }
      if (route === '/api/backup' && req.method === 'GET') {
        res.setHeader('Content-Disposition', 'attachment; filename="beles-backup.json"');
        return json(res, 200, {
          version: 1,
          exportedAt: new Date().toISOString(),
          rows: await read(catalogFile, []),
          feedback: await read(feedbackFile, []),
        });
      }
      if (route === '/api/catalog' && ['POST', 'DELETE'].includes(req.method)) {
        const b = await body(req);
        const rows = await repository.mutate(
          'catalog.json',
          async (rows) => {
            const previous = structuredClone(rows);
            permissions.requirePermission(
              s,
              (req.method === 'DELETE' ? b.originalKind : b.record?.kind) + '.write',
            );
            if (b.originalKind) permissions.requirePermission(s, b.originalKind + '.write');
            if (b.revision !== revision(rows)) fail(409, 'Catalog changed. Reload before saving.');
            const i = rows.findIndex(
              (x) => x.itemKey === b.originalKey && x.kind === b.originalKind,
            );
            if (req.method === 'DELETE') {
              if (i < 0) throw Error('Record not found');
              if (
                rows[i].kind === 'brand' &&
                rows.some(
                  (x) => ['product', 'presentation'].includes(x.kind) && x.brand === rows[i].name,
                )
              )
                throw Error('Move or delete linked products and presentations first');
              rows.splice(i, 1);
            } else {
              const r = validate(b.record);
              if (media.driver === 'volume')
                for (const field of ['image', 'pdfFile', 'url', 'sourceURL'])
                  if (
                    r[field]?.startsWith('/uploads/') &&
                    !fs.existsSync(path.join(UP, path.basename(r[field])))
                  )
                    fail(400, 'Медіафайл відсутній. Відновіть його або завантажте знову.');
              if (i >= 0 && rows[i].kind !== r.kind) fail(400, 'Record type cannot be changed');
              if (
                r.kind === 'brand' &&
                rows.some((x, n) => n !== i && x.kind === 'brand' && x.name === r.name)
              )
                fail(400, 'Brand name already exists');
              if (
                ['product', 'presentation'].includes(r.kind) &&
                r.brand &&
                !['—', '-'].includes(r.brand) &&
                !rows.some((x) => x.kind === 'brand' && x.name === r.brand)
              )
                fail(400, 'Unknown brand');
              if (rows.some((x, n) => n !== i && x.kind === r.kind && x.itemKey === r.itemKey))
                throw Error('Duplicate Item Key');
              if (i >= 0) {
                const old = rows[i];
                if (old.kind === 'brand' && r.name !== old.name)
                  for (const x of rows)
                    if (x.brand === old.name) {
                      permissions.requirePermission(s, x.kind + '.write');
                      x.brand = r.name;
                    }
                rows[i] = r;
              } else rows.push(r);
            }
            return { value: rows, related: { 'catalog.previous.json': previous }, result: rows };
          },
          [],
        );
        catalogCache = rows;
        await audit.record(req.method === 'DELETE' ? 'catalog.delete' : 'catalog.save', s.userId);
        return json(res, 200, {
          ok: true,
          rows: permissions.visibleRows(rows, s.user),
          revision: revision(rows),
        });
      }
      if (route === '/api/analytics' && req.method === 'GET')
        return json(
          res,
          200,
          analytics.report(u.searchParams.get('from'), u.searchParams.get('to')),
        );
      if (route === '/api/feedback' && req.method === 'GET')
        return json(res, 200, { items: await read(feedbackFile, []) });
      if (route === '/api/feedback' && req.method === 'PATCH') {
        const b = await body(req, 8192);
        if (!['new', 'done'].includes(b.status)) fail(400, 'Invalid feedback status');
        await repository.mutate(
          'feedback.json',
          (items) => {
            const item = items.find((x) => x.id === b.id);
            if (!item) fail(404, 'Not found');
            item.status = b.status;
            return { value: items };
          },
          [],
        );
        return json(res, 200, { ok: true });
      }
      if (route === '/api/password' && req.method === 'POST') {
        requestSecurity.limit('password:' + s.userId, 8, 900000);
        const b = await body(req, 8192),
          c = (await accounts.users()).find((u) => u.id === s.userId);
        if (!(await accounts.verify(c, b.current))) throw Error('Incorrect current password');
        await accounts.factor(s.userId, b.code);
        await accounts.change(s.userId, b.password);
        await audit.record('password.change', s.userId);
        await sessionManager.revokeUser(s.userId);
        return json(res, 200, { ok: true });
      }
      if (await storageRoutes(req, res, route, s)) return;
      if (route === '/api/upload' && req.method === 'POST')
        return json(res, 200, await media.upload(req, s.userId));
      return json(res, 404, { error: 'Not found' });
    }
    if (['GET', 'HEAD'].includes(req.method) && route.startsWith('/uploads/')) {
      const name = path.basename(route);
      if (/\.(woff2?|ttf)$/.test(name)) res.setHeader('Access-Control-Allow-Origin', '*');
      if (
        media.driver === 's3' &&
        process.env.MEDIA_READ_REMOTE === 'true' &&
        /^[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)$/.test(name)
      ) {
        res.writeHead(302, {
          Location: process.env.MEDIA_PUBLIC_URL.replace(/\/$/, '') + '/' + name,
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
      const mediaFile = fs.existsSync(path.join(UP, name))
        ? path.join(UP, name)
        : path.join(ROOT, 'uploads', name);
      if (
        !/^[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2|woff|ttf)$/.test(name) ||
        !fs.existsSync(mediaFile)
      )
        return json(res, 404, { error: 'Not found' });
      if (name.endsWith('.svg'))
        res.setHeader(
          'Content-Security-Policy',
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        );
      return serve(
        res,
        mediaFile,
        {
          woff2: 'font/woff2',
          woff: 'font/woff',
          ttf: 'font/ttf',
          avif: 'image/avif',
          svg: 'image/svg+xml',
          png: 'image/png',
          jpg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
          pdf: 'application/pdf',
        }[name.split('.').pop()],
        req,
      );
    }
    if (req.method === 'GET' && route === '/') {
      const rows = await read(catalogFile, []);
      const origin = process.env.PUBLIC_URL || `http://${req.headers.host}`;
      for (const r of rows)
        for (const k of ['image', 'pdfFile', 'url', 'sourceURL'])
          if (
            typeof r[k] === 'string' &&
            r[k].startsWith('https://brilliant-fulfillment-production-38a1.up.railway.app/uploads/')
          )
            r[k] = r[k].slice(
              'https://brilliant-fulfillment-production-38a1.up.railway.app'.length,
            );
      for (const r of rows)
        if (
          r.kind === 'content' &&
          (r.name === 'feedback_endpoint' || r.itemKey === 'feedback_endpoint')
        )
          r.url = origin + '/api/feedback';
      if (!rows.some((r) => r.kind === 'content' && r.name === 'feedback_endpoint'))
        rows.push({
          kind: 'content',
          name: 'feedback_endpoint',
          itemKey: 'feedback_endpoint',
          url: origin + '/api/feedback',
          published: true,
        });
      let html = seo.enhance(buildPage(siteDesign.template(), rows), rows);

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(
        html.replace(
          /<\/head\s*>/i,
          '<script src="/assets/google-analytics.js?v=20261020-1" defer></script>' +
            '<script src="/assets/contact-message.js?v=20261021-2" defer></script>' +
            '<script src="/assets/visual-elements.js?v=20261021-1" defer></script>' +
            '<script src="/assets/benefit-copy.js?v=20261021-1" defer></script></head>',
        ),
      );
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e.code === 'ENOSPC')
      return json(res, 507, {
        error: 'Сховище заповнене. Зміни не збережено. Зверніться до власника.',
      });
    json(
      res,
      e.status || (e.code || e instanceof TypeError || e instanceof SyntaxError ? 500 : 400),
      {
        error:
          e.code || e instanceof TypeError || e instanceof SyntaxError
            ? 'Помилка сервера. Спробуйте пізніше.'
            : e.message || 'Request failed',
        reason: e.reason,
      },
    );
  }
});
readiness.then(() =>
  server.listen(PORT, HOST, () => console.log(`Beles: http://${HOST}:${PORT} | Admin: /admin`)),
);
setInterval(() => {
  for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
}, 60000).unref();
