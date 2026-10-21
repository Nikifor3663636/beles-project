'use strict';
const assert = require('node:assert/strict');
const { parse, publicIP, safeURL, importProduct } = require('./product-import.cjs');
const product = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Трактор &amp; причіп',
  description: '<p>Опис</p><script>alert(1)</script>',
  image: [{ url: '/images/toy.jpg' }],
  brand: { name: 'Bruder' },
  sku: '001',
  additionalProperty: [{ name: 'Вік', value: '3+' }],
  offers: { price: '25', priceCurrency: 'EUR' },
};
const result = parse(
  '<script type="application/ld+json">' +
    JSON.stringify({ '@graph': [product] }).replace(/</g, '\\u003c') +
    '</script>',
  'https://example.com/toy',
);
assert.equal(result.draft.name, 'Трактор & причіп');
assert.equal(result.draft.descriptionUA, 'Опис');
assert.equal(result.draft.image, 'https://example.com/images/toy.jpg');
assert.equal(result.draft.brand, 'Bruder');
assert.match(result.draft.featuresUA, /Вік: 3\+/);
assert.match(result.draft.featuresUA, /25 EUR/);
const fallback = parse(
  '<meta content="Toy &amp; car" property="og:title"><meta property="og:image" content="javascript:alert(1)"><table><tr><th>Матеріал</th><td>Дерево</td></tr></table>',
  'https://example.com',
);
assert.equal(fallback.draft.name, 'Toy & car');
assert.equal(fallback.draft.image, undefined);
assert.match(fallback.draft.featuresUA, /Дерево/);
assert.ok(fallback.warnings.length);
assert.throws(() => parse('<html></html>', 'https://example.com'));
for (const ip of [
  '0.0.0.0',
  '10.0.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.0.1',
  '100.100.100.200',
  '198.18.0.1',
  '224.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'fc00::1',
  'fe80::1',
  '2001:db8::1',
  '2002:7f00:1::1',
])
  assert.equal(publicIP(ip), false, ip);
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
  assert.equal(publicIP(ip), true, ip);
for (const url of [
  'file:///etc/passwd',
  'ftp://example.com',
  'http://user:password@example.com',
  'http://example.com:3000',
])
  assert.throws(() => safeURL(url));
(async () => {
  for (const url of [
    'http://127.0.0.1',
    'http://2130706433',
    'http://[::1]',
    'http://169.254.169.254/latest/meta-data/',
  ])
    await assert.rejects(importProduct(url), /службові/);
  console.log(
    'PASS: product structured data, metadata fallback, safe text, images, specifications, SSRF addresses and schemes',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
