'use strict';
const crypto = require('node:crypto');

function revision(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function validate(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('Invalid record');
  const allowed = new Set(
    'kind name title itemKey slug brand sort published nameEN descriptionUA descriptionEN image imageAlt categories accent sku age material dimensions featuresUA featuresEN focusUA focusEN assortmentUA assortmentEN url pdfFile textUA textEN sourceURL catalogLabel presentationPage legacyId'.split(
      ' ',
    ),
  );
  for (const [key, value] of Object.entries(r)) {
    if (!allowed.has(key)) throw Error('Unknown record field');
    if (!['sort', 'published', 'presentationPage'].includes(key) && typeof value !== 'string')
      throw Error('Invalid field type');
  }
  if (!['brand', 'product', 'partner', 'presentation', 'content'].includes(r.kind))
    throw Error('Invalid type');
  if (!/^[\w.-]{1,150}$/.test(r.itemKey || ''))
    throw Error('Item Key: use Latin letters, digits, - or _');
  if (!String(r.name || r.title || '').trim()) throw Error('Name required');
  if (r.kind === 'content' && ['__proto__', 'constructor', 'prototype'].includes(r.name))
    throw Error('Reserved content key');
  for (const v of Object.values(r))
    if (typeof v === 'string' && v.length > 100000) throw Error('Field too long');
  for (const k of ['image', 'pdfFile', 'sourceURL', 'url'])
    if (r[k]) {
      r[k] = r[k].trim();
      if (r[k].startsWith('/uploads/')) {
        if (!/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|gif|pdf|svg|avif|woff2?|ttf)$/.test(r[k]))
          throw Error('Invalid media path');
      } else if (k === 'url' && /^(mailto:|tel:)/i.test(r[k])) {
        if (/[<>\r\n]/.test(r[k])) throw Error('Invalid contact URL');
      } else {
        let url;
        try {
          url = new URL(r[k]);
        } catch {
          throw Error('Invalid URL in ' + k);
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw Error('Invalid URL in ' + k);
        r[k] = url.href;
      }
    }
  if (r.accent && !/^#[0-9a-f]{3,8}$/i.test(r.accent)) throw Error('Accent: use a hex colour');
  r.name = String(r.name || r.title).trim();
  r.title = r.name;
  if (
    r.sort !== undefined &&
    (!Number.isFinite(Number(r.sort)) || Math.abs(Number(r.sort)) > 10000000)
  )
    throw Error('Invalid sort');
  if (
    r.presentationPage !== undefined &&
    (!Number.isInteger(Number(r.presentationPage)) ||
      Number(r.presentationPage) < 0 ||
      Number(r.presentationPage) > 100000)
  )
    throw Error('Invalid PDF page');
  if (r.published !== undefined && typeof r.published !== 'boolean')
    throw Error('Invalid publication status');
  r.sort = Number(r.sort) || 0;
  r.published = r.published === true;
  return r;
}

module.exports = { revision, validate };
