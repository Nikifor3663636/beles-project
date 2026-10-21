(() => {
  'use strict';
  const data = (window.__BELES_CMS_PAYLOAD__ || [])
    .filter((r) => r.published !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const uuid = () => crypto.randomUUID();
  const store = (storage, key, value) => {
    try {
      if (value === undefined) return storage.getItem(key);
      storage.setItem(key, value);
    } catch {}
  };
  let visitor = store(localStorage, 'beles-visitor') || uuid();
  let session = store(sessionStorage, 'beles-session') || uuid();
  let lastActivity = Number(store(sessionStorage, 'beles-last')) || Date.now(),
    lastBeat = Date.now(),
    lastAction = '',
    lastActionAt = 0;
  const disabled = () =>
    navigator.doNotTrack === '1' || store(localStorage, 'beles-analytics-off') === '1';
  if (!disabled()) store(localStorage, 'beles-visitor', visitor);
  function send(type, extra = {}) {
    if (disabled()) return;
    if (Date.now() - lastActivity > 1800000) session = uuid();
    lastActivity = Date.now();
    store(sessionStorage, 'beles-session', session);
    store(sessionStorage, 'beles-last', String(lastActivity));
    const event = {
      type,
      visitor,
      session,
      id: uuid(),
      visible: !document.hidden,
      language: document.documentElement.lang,
      referrer: document.referrer,
      source: new URLSearchParams(location.search).get('utm_source') || '',
      ...extra,
    };
    const payload = JSON.stringify(event);
    if (!navigator.sendBeacon?.('/api/events', new Blob([payload], { type: 'application/json' })))
      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
  }
  function action(type, key) {
    if (!key) return;
    const value = type + ':' + key;
    if (value === lastAction && Date.now() - lastActionAt < 700) return;
    lastAction = value;
    lastActionAt = Date.now();
    send(type, { key });
    if (!disabled())
      document.dispatchEvent(new CustomEvent('beles:tracked-action', { detail: { type, key } }));
  }
  document.addEventListener('beles:analytics', (e) => action(e.detail.type, e.detail.key));
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest?.('a,.bp .card');
      if (!target) return;
      if (target.matches('.bp .card')) {
        const panel = target.closest('.bp');
        const brands = data.filter((r) => r.kind === 'brand');
        const brand = brands[Number(panel.dataset.i)];
        const products = data.filter((r) => r.kind === 'product' && r.brand === brand?.name);
        const index = [...panel.querySelectorAll('.grid .card')].indexOf(target);
        action('product', products[index]?.itemKey);
      }
      if (target.matches('a')) {
        const href = target.getAttribute('href') || '';
        const pdf = data.find(
          (r) =>
            r.kind === 'presentation' &&
            r.pdfFile &&
            new URL(r.pdfFile, location.href).pathname ===
              new URL(target.href, location.href).pathname,
        );
        if (pdf) action('pdf', pdf.itemKey);
        else if (/^tel:/i.test(href)) action('contact', 'phone');
        else if (/^mailto:/i.test(href)) action('contact', 'email');
        else if (/^https?:/i.test(href)) {
          const host = new URL(href).hostname;
          if (host === 't.me') action('contact', 'telegram');
          else if (/(^|\.)instagram.com$/.test(host)) action('contact', 'instagram');
        }
      }
    },
    true,
  );
  let maxScroll = 0;
  function scrollDepth() {
    const height = document.documentElement.scrollHeight - innerHeight;
    const depth = height > 0 ? Math.min(100, Math.floor((scrollY / height) * 4) * 25) : 100;
    if (depth > maxScroll) {
      maxScroll = depth;
      send('scroll', { depth });
    }
  }
  let scrollTimer;
  addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(scrollDepth, 400);
    },
    { passive: true },
  );
  function beat(visible) {
    const now = Date.now();
    const seconds = Math.min(30, Math.max(0, (now - lastBeat) / 1000));
    lastBeat = now;
    send('heartbeat', { seconds, visible });
  }
  setInterval(() => {
    if (!document.hidden) beat(true);
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) beat(false);
    else {
      lastBeat = Date.now();
      send('heartbeat', { seconds: 0, visible: true });
    }
  });
  addEventListener('pagehide', () => {
    if (!document.hidden) beat(false);
  });

  send('pageview');
})();
