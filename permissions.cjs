'use strict';
const { fail } = require('./security.cjs');
const groups = [
  { id: 'product', label: 'Товари' },
  { id: 'brand', label: 'Бренди' },
  { id: 'partner', label: 'Партнери' },
  { id: 'presentation', label: 'Презентації PDF' },
  { id: 'content', label: 'Тексти та контакти' },
  { id: 'feedback', label: 'Звернення' },
  { id: 'analytics', label: 'Аналітика', writeLabel: 'Налаштування Google Analytics' },
  { id: 'design', label: 'Код і дизайн сайту' },
  { id: 'storage', label: 'Сховище та журнал', writeLabel: 'Очищення файлів' },
  { id: 'backup', label: 'Експорт каталогу та звернень', single: 'export' },
];
const all = groups.flatMap((g) =>
  g.single ? [g.id + '.' + g.single] : [g.id + '.read', g.id + '.write'],
);
const legacy = ['product', 'brand', 'partner', 'presentation', 'content', 'feedback']
  .flatMap((kind) => [kind + '.read', kind + '.write'])
  .concat('analytics.read');
function normalize(value = [], strict = true) {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string' || !all.includes(key))) {
    if (strict) fail(400, 'Недозволений перелік прав доступу.');
    value = Array.isArray(value) ? value.filter((key) => all.includes(key)) : [];
  }
  const result = new Set(value);
  for (const key of result)
    if (key.endsWith('.write')) result.add(key.replace(/\.write$/, '.read'));
  return all.filter((key) => result.has(key));
}
function effective(user) {
  return user.role === 'owner'
    ? all
    : normalize(user.permissions === undefined ? legacy : user.permissions, false);
}
function has(user, permission) {
  return effective(user).includes(permission);
}
function requirePermission(session, permission) {
  if (!has(session.user, permission)) fail(403, 'Недостатньо прав для цього розділу або дії.');
}
function visibleRows(rows, user) {
  return rows.flatMap((row) => {
    if (has(user, row.kind + '.read')) return [row];
    // Product editors need brand names for the selector, not the private brand fields.
    if (row.kind === 'brand' && (has(user, 'product.read') || has(user, 'presentation.read')))
      return [{ kind: 'brand', itemKey: row.itemKey, name: row.name }];
    return [];
  });
}
module.exports = { groups, all, legacy, normalize, effective, has, requirePermission, visibleRows };
