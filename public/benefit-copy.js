'use strict';
(() => {
  let scheduled = false;
  function format() {
    scheduled = false;
    for (const paragraph of document.querySelectorAll(
      '[data-v2-copy="benefit_3_body"],.beles-benefit:nth-child(3) p',
    )) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.textContent.replace(/\s*\+\s*/g, ' ');
        if (node.textContent !== text) node.textContent = text;
        if (node.parentElement.closest('strong,b')) continue;
        const match = /під\s+замовлення/i.exec(text);
        if (!match) continue;
        const strong = document.createElement('strong');
        strong.textContent = match[0];
        strong.style.setProperty('font-weight', '800', 'important');
        node.replaceWith(
          document.createTextNode(text.slice(0, match.index)),
          strong,
          document.createTextNode(text.slice(match.index + match[0].length)),
        );
      }
    }
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(format);
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
  format();
})();
