'use strict';
const { parse } = require('parse5');
// Source offsets preserve the custom template and its scripts exactly.
module.exports = function placePartners(html) {
  const nodes = new Map();
  function visit(node) {
    const id = node.attrs?.find((attribute) => attribute.name === 'id')?.value;
    if (['brands', 'bx-voices'].includes(id)) nodes.set(id, node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html, { sourceCodeLocationInfo: true }));
  const brands = nodes.get('brands')?.sourceCodeLocation;
  const partners = nodes.get('bx-voices')?.sourceCodeLocation;
  if (!brands?.endTag || !partners?.endTag) return html;
  if (
    partners.startOffset >= brands.endOffset &&
    /^\s*$/.test(html.slice(brands.endOffset, partners.startOffset))
  )
    return html;
  const section = html.slice(partners.startOffset, partners.endOffset);
  const edits = [
    { start: partners.startOffset, end: partners.endOffset, text: '' },
    { start: brands.endOffset, end: brands.endOffset, text: '\n' + section },
  ].sort((a, b) => b.start - a.start);
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
};
