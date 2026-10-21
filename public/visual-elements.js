'use strict';
(() => {
  const rules = JSON.parse(document.getElementById('beles-element-overrides')?.textContent || '[]');
  let pending = false;
  function apply() {
    pending = false;
    for (const rule of rules) {
      let node;
      try {
        node = document.querySelector(rule.selector);
      } catch {
        continue;
      }
      if (!node) continue;
      for (const [key, value] of Object.entries(rule.fields)) {
        const attribute = ['href', 'src', 'alt', 'title'].includes(key)
          ? key
          : 'data-beles-editor-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
        if (node.getAttribute(attribute) !== String(value))
          node.setAttribute(attribute, String(value));
      }
      if (
        (rule.fields.text !== undefined || rule.fields.textEN !== undefined) &&
        !node.hasAttribute('data-no-translate')
      )
        node.setAttribute('data-no-translate', '');
    }
    const uk = document.documentElement.lang === 'uk';
    for (const node of document.querySelectorAll(
      '[data-beles-editor-text],[data-beles-editor-text-e-n],[data-beles-editor-color],[data-beles-editor-background],[data-beles-editor-font-size],[data-beles-editor-padding],[data-beles-editor-border-radius],[data-beles-editor-hidden]',
    )) {
      const text = node.getAttribute('data-beles-editor-text');
      const english = node.getAttribute('data-beles-editor-text-e-n');
      const value = !uk && english ? english : text;
      if (value !== null && node.textContent !== value) node.textContent = value;
      for (const property of ['color', 'background', 'font-size', 'padding', 'border-radius']) {
        const value = node.getAttribute('data-beles-editor-' + property);
        if (value) {
          const expected = document.createElement('span').style;
          expected.setProperty(property, value, 'important');
          if (
            node.style.getPropertyValue(property) !== expected.getPropertyValue(property) ||
            node.style.getPropertyPriority(property) !== 'important'
          )
            node.style.setProperty(property, value, 'important');
        }
      }
      if (
        node.getAttribute('data-beles-editor-hidden') === 'true' &&
        node.style.getPropertyValue('display') !== 'none'
      )
        node.style.setProperty('display', 'none', 'important');
    }
  }
  new MutationObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(apply);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['lang', 'style'],
  });
  apply();
})();
