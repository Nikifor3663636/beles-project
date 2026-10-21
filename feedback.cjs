'use strict';
const crypto = require('node:crypto');
const { fail } = require('./security.cjs');
module.exports = function feedback(value) {
  const field = (name, max, required = false) => {
    const text = value[name] === undefined ? '' : value[name];
    if (typeof text !== 'string' || text.length > max || (required && !text.trim()))
      fail(400, 'Invalid ' + name);
    return text.trim();
  };
  const name = field('name', 100, true),
    contact = field('contact', 254, true),
    message = field('message', 5000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !/^\+?[\d\s()\-]{7,25}$/.test(contact))
    fail(400, 'Вкажіть правильний email або телефон.');
  const theme = field('theme', 40) || 'feedback';
  if (
    ![
      'feedback',
      'cooperation',
      'assortment',
      'first_order',
      'delivery',
      'product_request',
      'availability',
    ].includes(theme)
  )
    fail(400, 'Invalid theme');
  const sku = field('sku', 200),
    quantity = value.quantity ? Number(value.quantity) : undefined;
  if (
    theme === 'product_request' &&
    (!sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)
  )
    fail(400, 'Вкажіть назву/артикул і кількість товару.');
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    contact,
    message,
    theme,
    sku,
    quantity,
    shopFormat: field('shopFormat', 120),
    language: field('language', 10),
    page: field('page', 1000),
    source: field('source', 100),
    status: 'new',
  };
};
