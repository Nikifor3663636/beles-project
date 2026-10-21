'use strict';
const parse5 = require('parse5');
const { fail } = require('./security.cjs');
const forbidden = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'path',
  'defs',
  'use',
  'linearGradient',
  'stop',
]);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function elements(html) {
  const result = [];
  const tree = parse5.parse(html, { sourceCodeLocationInfo: true });
  const body = tree.childNodes
    .find((node) => node.tagName === 'html')
    ?.childNodes.find((node) => node.tagName === 'body');
  function visit(node, path) {
    if (
      !node.tagName ||
      forbidden.has(node.tagName) ||
      node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    )
      return;
    const loc = node.sourceCodeLocation;
    const attrs = Object.fromEntries((node.attrs || []).map((a) => [a.name, a.value]));
    const children = (node.childNodes || []).filter((child) => child.tagName);
    const plain = (node.childNodes || [])
      .filter((child) => child.nodeName === '#text')
      .map((child) => child.value)
      .join('')
      .trim();
    if (loc && node !== body) {
      result.push({
        id: 'element-' + path.join('-'),
        label:
          `<${node.tagName}> ${attrs.id ? '#' + attrs.id : plain.slice(0, 55) || attrs.alt || attrs['aria-label'] || attrs.class || ''}`.trim(),
        tag: node.tagName,
        start: loc.startOffset,
        end: loc.endOffset,
        openEnd: loc.startTag.endOffset,
        closeStart: loc.endTag?.startOffset,
        value: html.slice(loc.startOffset, loc.endOffset),
        fields: {
          text: children.length ? null : (attrs['data-beles-editor-text'] ?? plain),
          textEN: children.length ? null : attrs['data-beles-editor-text-e-n'] || '',
          href: node.tagName === 'a' ? attrs.href || '' : null,
          src: node.tagName === 'img' ? attrs.src || '' : null,
          alt: node.tagName === 'img' ? attrs.alt || '' : null,
          title: attrs.title || '',
          color: attrs['data-beles-editor-color'] || '',
          background: attrs['data-beles-editor-background'] || '',
          fontSize: attrs['data-beles-editor-font-size'] || '',
          padding: attrs['data-beles-editor-padding'] || '',
          borderRadius: attrs['data-beles-editor-border-radius'] || '',
          hidden: attrs['data-beles-editor-hidden'] === 'true',
        },
        attrs,
      });
    }
    children.forEach((child, index) => visit(child, [...path, index]));
  }
  if (body) visit(body, []);
  return result;
}
function edit(html, id, fields) {
  const node = elements(html).find((node) => node.id === id);
  if (!node || !fields || typeof fields !== 'object' || Array.isArray(fields))
    fail(400, 'Елемент не знайдено.');
  const allowed = new Set(Object.keys(node.fields));
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key) || node.fields[key] === null)
      fail(400, 'Властивість недоступна для цього елемента.');
    if (key === 'hidden') {
      if (typeof value !== 'boolean') fail(400, 'Некоректне значення видимості.');
      continue;
    }
    if (typeof value !== 'string' || value.length > (key === 'text' ? 5000 : 2000))
      fail(400, 'Некоректне значення властивості.');
    if (['color', 'background'].includes(key) && value && !/^#[a-f\d]{6}$/i.test(value))
      fail(400, 'Колір має бути #RRGGBB.');
    if (
      ['fontSize', 'padding', 'borderRadius'].includes(key) &&
      value &&
      !/^\d{1,3}(?:\.\d)?(?:px|rem|em|%)$/.test(value)
    )
      fail(400, 'Розмір: число та px, rem, em або %.');
    if (
      ['src', 'href'].includes(key) &&
      value &&
      !/^(?:https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(value)
    )
      fail(400, 'Вкажіть https-посилання або шлях /…');
  }
  const attrs = { ...node.attrs };
  for (const [key, value] of Object.entries(fields)) {
    const attribute = ['href', 'src', 'alt', 'title'].includes(key)
      ? key
      : 'data-beles-editor-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if ((value === '' && !['text', 'textEN'].includes(key)) || value === false)
      delete attrs[attribute];
    else attrs[attribute] = value;
  }
  if (fields.text !== undefined || fields.textEN !== undefined) attrs['data-no-translate'] = '';
  const open =
    '<' +
    node.tag +
    Object.entries(attrs)
      .map(([name, value]) => ' ' + name + '="' + escape(value) + '"')
      .join('') +
    '>';
  let inner = html.slice(node.openEnd, node.closeStart ?? node.openEnd);
  if (fields.text !== undefined && node.closeStart !== undefined) inner = escape(fields.text);
  const close = node.closeStart !== undefined ? html.slice(node.closeStart, node.end) : '';
  return html.slice(0, node.start) + open + inner + close + html.slice(node.end);
}
module.exports = { elements, edit };
