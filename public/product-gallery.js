'use strict';
(() => {
  const text = (ua, en) => (document.documentElement.lang === 'en' ? en : ua);
  const safeURL = (value) => {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value, location.origin);
      return /^(https?:\/\/|\/uploads\/)/.test(value) &&
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? value
        : '';
    } catch {
      return '';
    }
  };
  const element = (tag, className, label) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label) node.textContent = label;
    return node;
  };
  const details = document.querySelector('.beles-details-dialog');
  if (!details) return;
  let active = null;
  function navigation(container, change) {
    const controls = element('div', 'beles-gallery-controls');
    const prev = element('button', '', '←');
    const next = element('button', '', '→');
    const counter = element('span', 'beles-gallery-count');
    counter.setAttribute('aria-live', 'polite');
    for (const [button, delta, label] of [
      [prev, -1, text('Попереднє фото', 'Previous photo')],
      [next, 1, text('Наступне фото', 'Next photo')],
    ]) {
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.onclick = () => change(delta);
    }
    controls.append(prev, counter, next);
    container.append(controls);
    return { controls, counter };
  }
  function gestures(node, change) {
    let start = null;
    node.addEventListener(
      'touchstart',
      (event) => {
        start = event.touches.length === 1 ? event.touches[0] : null;
      },
      { passive: true },
    );
    node.addEventListener(
      'touchend',
      (event) => {
        if (!start || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - start.clientX;
        const dy = event.changedTouches[0].clientY - start.clientY;
        start = null;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) change(dx < 0 ? 1 : -1);
      },
      { passive: true },
    );
    node.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      change(event.key === 'ArrowRight' ? 1 : -1);
    });
  }
  const viewer = document.querySelector('.beles-product-image-viewer');
  const viewerNav = viewer && navigation(viewer, (delta) => active?.step(delta));
  if (viewer) gestures(viewer, (delta) => active?.step(delta));
  function enhance() {
    const trigger = details.querySelector('.beles-spec-image-button');
    if (!trigger || trigger.closest('.beles-product-gallery')) return;
    const product = (window.__BELES_CMS_PAYLOAD__ || []).find(
      (row) => row.kind === 'product' && row.itemKey === details.dataset.analyticsProduct,
    );
    if (!product) return;
    const images = [
      ...new Set(
        [product.image, ...(Array.isArray(product.images) ? product.images : [])]
          .map(safeURL)
          .filter(Boolean),
      ),
    ];
    if (!images.length) {
      active = null;
      return;
    }
    const gallery = element('div', 'beles-product-gallery');
    gallery.setAttribute('role', 'group');
    gallery.setAttribute('aria-label', text('Фото товару', 'Product photos'));
    trigger.before(gallery);
    gallery.append(trigger);
    const nav = navigation(gallery, (delta) => select(index + delta));
    const thumbs = element('div', 'beles-gallery-thumbs');
    gallery.append(thumbs);
    let index = 0;
    const name = trigger.querySelector('img').alt;
    const buttons = images.map((src, i) => {
      const button = element('button');
      button.type = 'button';
      button.setAttribute('aria-label', text('Фото ', 'Photo ') + (i + 1));
      const photo = element('img');
      photo.src = src;
      photo.alt = '';
      photo.loading = 'lazy';
      button.append(photo);
      button.onclick = () => select(i);
      thumbs.append(button);
      return button;
    });
    function syncViewer() {
      if (!viewerNav) return;
      viewerNav.controls.hidden = images.length < 2;
      viewerNav.counter.textContent = index + 1 + ' / ' + images.length;
      if (!viewer.open) return;
      const photo = viewer.querySelector(':scope > img');
      const mainPhoto = trigger.querySelector('img');
      if (photo) {
        delete photo.dataset.belesOriginalSrc;
        delete photo.dataset.belesHighresSrc;
        photo.dataset.belesFallbackSrc = images[index];
        photo.src = mainPhoto.dataset.belesHighresSrc || images[index];
        photo.alt = name;
      }
    }
    function select(next) {
      index = (next + images.length) % images.length;
      // Replace the node so old high-resolution/error handlers cannot restore a previous photo.
      const photo = element('img');
      photo.src = images[index];
      photo.alt = name;
      photo.decoding = 'async';
      trigger.replaceChildren(photo);
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      nav.counter.textContent = index + 1 + ' / ' + images.length;
      syncViewer();
    }
    nav.controls.hidden = thumbs.hidden = images.length < 2;
    gestures(gallery, (delta) => select(index + delta));
    active = { step: (delta) => select(index + delta), syncViewer };
    select(0);
  }
  new MutationObserver(enhance).observe(details, { childList: true, subtree: true });
  if (viewer)
    new MutationObserver(() => {
      if (viewer.open) active?.syncViewer();
    }).observe(viewer, { attributes: true, attributeFilter: ['open'] });
  enhance();
})();
