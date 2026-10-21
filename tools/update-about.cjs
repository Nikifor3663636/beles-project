'use strict';
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = process.env.BELES_STORAGE_DIR
  ? path.join(process.env.BELES_STORAGE_DIR, 'data')
  : path.join(root, 'data');
const repository = require('../repository.cjs')(directory);
const ua = [
  'Широкий асортимент товарів від кращих виробників.',
  'Конкурентні ціни та гнучкі умови співпраці.',
  'Зручні способи замовлення та доставки.',
  'Професійна консультація та підтримка.',
];
const en = [
  'A wide range of products from leading manufacturers.',
  'Competitive prices and flexible terms of cooperation.',
  'Convenient ordering and delivery options.',
  'Professional advice and support.',
];
async function main() {
  try {
    await repository.ready();
    const apply = process.argv.includes('--apply');
    const update = (rows) => {
      if (!Array.isArray(rows) || !rows.length) throw Error('Existing catalogue required.');
      const before = structuredClone(rows);
      const heading = rows.find((r) => r.kind === 'content' && r.name === 'about_h2');
      // Respect any editorial changes made since the original snapshot.
      if (
        heading &&
        ['Про нас', 'Чому «Белес Україна»?', 'Чому "Белес Україна"?'].includes(heading.textUA)
      ) {
        heading.textUA = 'Чому "Белес Україна"?';
        heading.textEN = 'Why Beles Ukraine?';
      }
      for (const [index, key] of ['one', 'two', 'three', 'four'].entries()) {
        const name = 'about_' + key;
        if (!rows.some((r) => r.kind === 'content' && r.name === name))
          rows.push({
            kind: 'content',
            itemKey: name,
            name,
            textUA: ua[index],
            textEN: en[index],
            published: true,
            sort: 0,
          });
      }
      const changed = JSON.stringify(before) !== JSON.stringify(rows);
      return {
        value: rows,
        related: changed ? { 'catalog.previous.json': before } : {},
        result: {
          before: before.length,
          after: rows.length,
          changed,
        },
      };
    };
    if (apply) console.log(await repository.mutate('catalog.json', update, []));
    else console.log({ dryRun: true, ...update(await repository.read('catalog.json', [])).result });
  } finally {
    await repository.close();
  }
}
main().catch((error) => {
  console.error(error.code ? 'Update failed; no connection details printed.' : error.message);
  process.exitCode = 1;
});
