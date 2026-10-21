'use strict';
// Owner-requested text correction, applied once before the HTTP server serves data.
const benefits = {
  benefit_1_title: ['Склади по всій Україні', 'Warehouses across Ukraine'],
  benefit_1_body: [
    'Організовуємо постачання у ваш регіон швидко та без затримок!',
    'We arrange supply to your region quickly and without delays!',
  ],
  benefit_2_title: ['Безкоштовна доставка', 'Free delivery'],
  benefit_2_body: [
    "Ми надаємо безкоштовну доставку власною кур'єрською службою в будь-який регіон",
    'We provide free delivery to any region with our own courier service.',
  ],
  benefit_3_title: ['Величезний асортимент', 'An extensive range'],
  benefit_3_body: [
    'Понад 20 000 товарів у каталозі доставка рідкісних позицій “під замовлення”',
    'Over 20,000 products in the catalogue, plus delivery of rare items to order.',
  ],
};
async function originalBenefits(repository) {
  const file = 'content-migrations.json';
  const state = await repository.read(file, {});
  if (state.benefits20261021) return;
  await repository.mutate(
    'catalog.json',
    (rows) => {
      if (!Array.isArray(rows)) throw Error('Invalid catalogue');
      const before = structuredClone(rows);
      let matched = 0;
      for (const row of rows) {
        if (row.kind !== 'content' || !benefits[row.name]) continue;
        [row.textUA, row.textEN] = benefits[row.name];
        matched++;
      }
      return {
        value: rows,
        related: matched
          ? { 'catalog.previous.json': before, [file]: { ...state, benefits20261021: true } }
          : {},
        result: { matched },
      };
    },
    [],
  );
}
async function apply(repository) {
  await originalBenefits(repository);
  const file = 'content-migrations.json';
  const state = await repository.read(file, {});
  if (state.assortmentPlus20261021) return;
  await repository.mutate(
    'catalog.json',
    (rows) => {
      const before = structuredClone(rows);
      const row = rows.find(
        (row) =>
          row.kind === 'content' &&
          (row.name === 'benefit_3_body' || row.itemKey === 'benefit_3_body'),
      );
      if (!row) return { value: rows };
      if (typeof row.textUA === 'string') row.textUA = row.textUA.replace(/\s*\+\s*/g, ' ');
      return {
        value: rows,
        related: {
          'catalog.previous.json': before,
          [file]: { ...state, assortmentPlus20261021: true },
        },
      };
    },
    [],
  );
}
module.exports = { apply, benefits };
