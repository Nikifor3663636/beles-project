'use strict';
const { parts } = require('./site-design.cjs');

// This bridge runs only inside a sandboxed, authenticated preview, never on the public site.
function previewBridge(selected) {
  function runtimeElement(target) {
    const node = target.closest(
      'div,span,p,h1,h2,h3,h4,h5,h6,a,button,img,label,input,textarea,section,article,header,footer,li,ul,nav,small,strong,em,i,b',
    );
    if (!node || node.dataset.designElement) return null;
    const path = [];
    let current = node;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift('[id="' + CSS.escape(current.id) + '"]');
        break;
      }
      const index =
        [...current.parentElement.children]
          .filter((sibling) => sibling.tagName === current.tagName)
          .indexOf(current) + 1;
      path.unshift(tag + ':nth-of-type(' + index + ')');
      current = current.parentElement;
    }
    const selector = 'body ' + path.join(' > ');
    const simple = !node.children.length && !['IMG', 'INPUT'].includes(node.tagName);
    const fields = {
      text: simple ? node.textContent : null,
      textEN: simple ? node.getAttribute('data-beles-editor-text-e-n') || '' : null,
      href: node.tagName === 'A' ? node.getAttribute('href') || '' : null,
      src: node.tagName === 'IMG' ? node.getAttribute('src') || '' : null,
      alt: node.tagName === 'IMG' ? node.getAttribute('alt') || '' : null,
      title: node.title || '',
      color: '',
      background: '',
      fontSize: '',
      padding: '',
      borderRadius: '',
      hidden: false,
    };
    return {
      selector,
      tag: node.tagName.toLowerCase(),
      label:
        node.tagName.toLowerCase() +
        ' · ' +
        (node.textContent || node.getAttribute('alt') || '').trim().slice(0, 65),
      baseline: node.outerHTML.slice(0, 20000),
      defaults: fields,
    };
  }
  function focus(id) {
    const element = [
      ...document.querySelectorAll('[data-design-block],[data-design-element]'),
    ].find((node) => node.dataset.designBlock === id || node.dataset.designElement === id);
    document.querySelectorAll('[data-design-selected]').forEach((node) => {
      node.removeAttribute('data-design-selected');
    });
    if (element) {
      element.setAttribute('data-design-selected', '');
      element.scrollIntoView({ block: 'center' });
    }
  }
  addEventListener('message', (event) => {
    if (event.source === parent && event.data?.type === 'beles:focus-block') focus(event.data.id);
  });
  addEventListener(
    'click',
    (event) => {
      if (event.altKey) return; // Alt+click operates the preview, e.g. opens a brand.
      const runtime = runtimeElement(event.target);
      if (runtime) {
        event.preventDefault();
        event.stopImmediatePropagation();
        parent.postMessage({ type: 'beles:select-runtime', runtime }, '*');
        return;
      }
      const block = event.target.closest('[data-design-element],[data-design-block]');
      if (!block) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = block.dataset.designElement || block.dataset.designBlock;
      focus(id);
      parent.postMessage({ type: 'beles:select-block', id }, '*');
    },
    true,
  );
  addEventListener('load', () => {
    if (selected) focus(selected);
    parent.postMessage({ type: 'beles:preview-ready' }, '*');
  });
}

module.exports = function preparePreview(html, selected) {
  // An opaque sandbox cannot read browser storage. Isolate temporary preferences.
  const storage =
    '<script>(()=>{for(const name of ["localStorage","sessionStorage"]){const data={"beles-analytics-off":"1"};Object.defineProperty(window,name,{value:{getItem:key=>Object.hasOwn(data,key)?data[key]:null,setItem:(key,value)=>{data[key]=String(value)},removeItem:key=>{delete data[key]},clear:()=>{for(const key of Object.keys(data))delete data[key]}}})}})();</script>';
  html = html.replace(/<head\b[^>]*>/i, (match) => match + storage);
  // Work backwards so injected attributes do not shift the remaining source offsets.
  const blocks = [
    ...parts(html).filter((p) => p.tag),
    ...require('./visual-elements.cjs').elements(html),
  ];
  for (const block of blocks.sort((a, b) => b.start - a.start)) {
    const safeId = block.id.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const start = html.indexOf('>', block.start);
    html =
      html.slice(0, start) +
      ` data-design-${block.id.startsWith('element-') ? 'element' : 'block'}="${safeId}"` +
      html.slice(start);
  }
  const styles =
    '<style>[data-design-block],[data-design-element]{cursor:crosshair!important;scroll-margin-top:90px}[data-design-element]:hover{outline:2px dashed #ed087b!important;outline-offset:-2px}[data-design-selected]{outline:3px solid #ed087b!important;outline-offset:-3px}</style>';
  const script = `<script>(${previewBridge.toString()})(${JSON.stringify(selected || '').replace(/</g, '\\u003c')});</script>`;
  return html
    .replace(/<\/head\s*>/i, styles + '</head>')
    .replace(
      /<\/body\s*>/i,
      '<script src="/assets/visual-elements.js?v=20261021-1"></script>' +
        '<script src="/assets/benefit-copy.js?v=20261021-1"></script>' +
        script +
        '</body>',
    );
};
