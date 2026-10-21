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
