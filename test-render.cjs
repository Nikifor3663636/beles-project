const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const render = require('./render.cjs');

const rows = [
  { kind: 'brand', itemKey: 'brand', name: 'Test brand', published: true, categories: 'baby' },
  {
    kind: 'product',
    itemKey: 'toy',
    name: 'Toy',
    brand: 'Test brand',
    sku: '123',
    published: true,
  },
  {
    kind: 'presentation',
    itemKey: 'pdf',
    name: 'PDF',
    brand: 'Test brand',
    pdfFile: '/uploads/demo.pdf',
  },
  {
    kind: 'content',
    itemKey: 'headline',
    name: 'hero_w1',
    textUA: 'Новий заголовок',
    textEN: 'New title',
  },
];

// Both immutable legacy backups and newly formatted templates must remain renderable.
function template(modern) {
  return `<html><head></head><body><script>
const BRANDS=[],LOGO={},BR_EN={},DRIVE_PRODUCT_IMAGES={};
${modern ? '/* BELES:CATALOG */' : ''}
const bl=document.getElementById('bl');
const PRES={"old":"https://example.com/old.pdf"};
${modern ? '/* BELES:PRESENTATIONS */' : ''}
const BRAND_CATEGORIES=[{id:"baby",names:[]}
];
${modern ? '/* BELES:CATEGORIES */' : ''}
const I18N = {"uk":{"hero_w1":"Old"},"en":{"hero_w1":"Old"}};
${modern ? '/* BELES:TRANSLATIONS */' : ''}
window.result={BRANDS,LOGO,BR_EN,DRIVE_PRODUCT_IMAGES,PRES,BRAND_CATEGORIES,I18N};
</script></body></html>`;
}

function state(html) {
  const context = { window: {}, document: { getElementById: () => null } };
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(code, context);
  return JSON.parse(JSON.stringify(context.window.result));
}

const legacy = state(render(template(false), rows));
const modern = state(render(template(true), rows));
assert.deepEqual(modern, legacy);
assert.equal(modern.I18N.uk.hero_w1, 'Новий заголовок');
assert.deepEqual(modern.PRES, { 'Test brand': '/uploads/demo.pdf', pdf: '/uploads/demo.pdf' });
assert.deepEqual(modern.BRAND_CATEGORIES[0].names, ['Test brand']);
assert.equal(modern.BRANDS[0].p.length, 1);

const page = render(fs.readFileSync('data/base.html', 'utf8'), rows);
assert.ok(!page.includes('/* BELES:CATALOG */'));
assert.match(page, /window\.__BELES_CMS_PAYLOAD__/);
for (const match of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
  if (match[1].trim()) new vm.Script(match[1]);
}
console.log(
  'PASS: legacy/formatted template parity, catalog, translations, PDF, categories, script syntax',
);

const placePartners = require('./page-layout.cjs');
const layout =
  '<body><section id="bx-voices"><div>Partners</div></section><main><section id="brands"></section><div><section id="about"></section><section id="contacts"></section></div></main></body>';
const arranged = placePartners(layout);
assert.ok(arranged.indexOf('id="brands"') < arranged.indexOf('id="bx-voices"'));
assert.ok(arranged.indexOf('id="bx-voices"') < arranged.indexOf('id="about"'));
assert.equal((arranged.match(/id="bx-voices"/g) || []).length, 1);
assert.equal(placePartners(arranged).replace(/\s+/g, ''), arranged.replace(/\s+/g, ''));
const { validate } = require('./catalog.cjs');
const product = { kind: 'product', name: 'Gallery', itemKey: 'gallery', published: true };
assert.deepEqual(
  validate({ ...product, images: ['https://example.com/a.jpg', 'https://example.com/a.jpg'] })
    .images,
  ['https://example.com/a.jpg'],
);
for (const images of [
  'not-an-array',
  [3],
  ['javascript:alert(1)'],
  ['/uploads/../../private.png'],
  Array(21).fill('https://example.com/a.jpg'),
])
  assert.throws(() => validate({ ...product, images }));
console.log('PASS: partner order in saved templates; gallery URL validation and limits');
