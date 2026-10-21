'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

// Only globally routable addresses; pin the validated DNS answer to the socket.
function publicIP(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Conservative IPv6 allowlist: global unicast, excluding special 2001 ranges.
  return (
    net.isIP(ip) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(ip) &&
    !/^2001:(?:[0-9a-f]{1,3}:|0[0-9a-f]{3}:|db8:)/i.test(ip) &&
    !/^2002:/i.test(ip)
  );
}
function safeURL(value, base) {
  const u = new URL(value, base);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !['80', '443'].includes(u.port)) ||
    u.href.length > 4096
  )
    throw Error(
      'Вкажіть звичайне посилання http:// або https:// без пароля та нестандартного порту.',
    );
  u.hash = '';
  return u;
}
async function download(value, redirects = 0, deadline = Date.now() + 18000) {
  const u = safeURL(value),
    host = u.hostname.replace(/^\[|\]$/g, '');
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw Error('Сайт не відповів вчасно. Спробуйте ще раз або заповніть товар вручну.');
  let timer;
  const addresses = await Promise.race([
    dns.lookup(host, { all: true }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('DNS timeout')), remaining);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
    throw Error('Локальні та службові адреси недоступні для імпорту.');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (u.protocol === 'https:' ? https : http).get(
      u,
      {
        agent: false,
        headers: {
          'User-Agent': 'BelesProductImporter/1.0',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, options, cb) =>
          options.all ? cb(null, [address]) : cb(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          clearTimeout(timeout);
          if (redirects >= 4 || !response.headers.location)
            return reject(Error('Забагато перенаправлень. Вставте кінцеву адресу товару.'));
          try {
            resolve(download(safeURL(response.headers.location, u).href, redirects + 1, deadline));
          } catch (e) {
            reject(e);
          }
          return;
        }
        if (status !== 200) {
          response.resume();
          return reject(
            Error(
              'Сайт відхилив завантаження (HTTP ' +
                status +
                '). Відкрийте товар у браузері, збережіть сторінку як HTML (Ctrl+S) і виберіть цей файл нижче.',
            ),
          );
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(response.headers['content-type'] || '')) {
          response.resume();
          return reject(Error('Посилання має вести на HTML-сторінку товару.'));
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 3 * 1024 * 1024) request.destroy(Error('Сторінка завелика для імпорту.'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          clearTimeout(timeout);
          const bytes = Buffer.concat(chunks);
          const charset =
            (response.headers['content-type'].match(/charset=["']?([\w-]+)/i) ||
              bytes.toString('ascii', 0, 2048).match(/charset=["']?([\w-]+)/i))?.[1] || 'utf-8';
          try {
            resolve({ html: new TextDecoder(charset).decode(bytes), url: u.href });
          } catch {
            resolve({ html: bytes.toString('utf8'), url: u.href });
          }
        });
      },
    );
    const timeout = setTimeout(
      () => request.destroy(Error('Сайт не відповів вчасно.')),
      Math.max(1, deadline - Date.now()),
    );
    request.on('error', reject);
    request.on('close', () => clearTimeout(timeout));
  });
}
function decode(s) {
  return String(s ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, key) => {
    if (key[0] === '#') {
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return (
      { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[key.toLowerCase()] || all
    );
  });
}
function clean(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return decode(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<\/?(?:p|div|br|li|tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 15000);
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  return out;
}
function parse(html, url) {
  if (/<title[^>]*>\s*(?:Just a moment|Access denied|Attention Required)/i.test(html))
    throw Error(
      'Це сторінка перевірки доступу. Збережіть HTML після того, як у браузері відкриється сам товар.',
    );
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    meta[(a.property || a.name || a.itemprop || '').toLowerCase()] = a.content || '';
  }
  const products = [];
  const micro = {};
  for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bitemprop\s*=[^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const a = attrs(m[2]);
    if (['sku', 'brand', 'description', 'name', 'material'].includes(a.itemprop))
      micro[a.itemprop] = clean(m[3]);
  }
  function walk(x, depth = 0) {
    if (!x || typeof x !== 'object' || depth > 15) return;
    if ([].concat(x['@type'] || []).some((t) => /(?:^|\/)Product$/.test(t))) products.push(x);
    for (const v of Object.values(x)) if (typeof v === 'object') walk(v, depth + 1);
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    if ((attrs(m[1]).type || '').toLowerCase() === 'application/ld+json') {
      try {
        walk(JSON.parse(m[2]));
      } catch {}
    }
  const p = products.find((p) => p.name) || {},
    offer = [].concat(p.offers || [])[0] || {};
  const name = clean(
    p.name ||
      meta['og:title'] ||
      meta['twitter:title'] ||
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  );
  if (!name)
    throw Error(
      'Не вдалося знайти дані товару. Сайт може вимагати JavaScript або блокувати імпорт.',
    );
  const draft = {
    name,
    sourceURL: url,
    descriptionUA: clean(
      p.description || micro.description || meta['og:description'] || meta.description,
    ),
    sku: clean(p.sku || p.mpn || micro.sku || meta['product:retailer_item_id']),
    brand: clean((typeof p.brand === 'object' ? p.brand?.name : p.brand) || micro.brand),
    material: clean(p.material || micro.material),
    imageAlt: name,
  };
  let img = [].concat(p.image || [])[0] || meta['og:image'] || meta['twitter:image'];
  if (img && typeof img === 'object') img = img.url || img.contentUrl;
  if (img)
    try {
      const image = safeURL(img, url);
      if (image.protocol === 'https:' || image.protocol === 'http:') draft.image = image.href;
    } catch {}
  const features = [];
  const add = (k, v) => {
    const value = clean(typeof v === 'object' ? v?.value : v);
    if (value) features.push(clean(k) + ': ' + value);
  };
  for (const prop of [].concat(p.additionalProperty || []).slice(0, 60))
    if (prop && typeof prop === 'object') add(prop.name, prop.value);
  for (const [key, label] of Object.entries({
    color: 'Колір',
    weight: 'Вага',
    width: 'Ширина',
    height: 'Висота',
    depth: 'Глибина',
    size: 'Розмір',
    gtin13: 'EAN',
    model: 'Модель',
  }))
    add(label, p[key]);
  if (offer.price)
    add('Ціна на сайті джерела', [offer.price, offer.priceCurrency].filter(Boolean).join(' '));
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) =>
      clean(m[1]),
    );
    if (cells.length === 2 && cells[0].length < 80 && cells[1].length < 500) {
      add(cells[0], cells[1]);
      const key = cells[0].trim().toLowerCase().replace(/:$/, '');
      for (const [field, names] of Object.entries({
        brand: ['бренд', 'виробник', 'торгова марка', 'производитель', 'brand', 'manufacturer'],
        sku: ['артикул', 'sku'],
        material: ['матеріал', 'материал', 'material'],
        age: ['вік', 'возраст', 'age'],
        dimensions: ['розмір', 'размер', 'dimensions', 'size'],
      }))
        if (!draft[field] && names.includes(key)) draft[field] = cells[1];
    }
    if (features.length >= 60) break;
  }
  draft.featuresUA = [...new Set(features)].join('\n');
  const warnings = [
    'Перевірте мову опису, характеристики та виберіть бренд каталогу перед збереженням.',
  ];
  if (!products.length)
    warnings.push('Сайт не надав розмітку Product: використані загальні дані сторінки.');
  if (products.length > 1)
    warnings.push('Знайдено кілька товарів або варіантів: імпортовано перший.');
  const missing = ['descriptionUA', 'image', 'sku'].filter((k) => !draft[k]);
  if (missing.length)
    warnings.push(
      'Частина даних відсутня: ' +
        missing
          .map((k) => ({ descriptionUA: 'опис', image: 'фото', sku: 'артикул' })[k])
          .join(', ') +
        '.',
    );
  if (draft.image)
    warnings.push(
      'Фото використовується за зовнішнім посиланням. За потреби завантажте власний файл.',
    );
  return { draft, warnings, format: products.length ? 'Product / JSON-LD' : 'HTML / Open Graph' };
}
async function importProduct(url) {
  const result = await download(url);
  return parse(result.html, result.url);
}
module.exports = { importProduct, parse, publicIP, safeURL };
