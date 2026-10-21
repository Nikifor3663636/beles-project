'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/google-analytics.js', 'utf8');

// All browser and network APIs below are stubs: tests never transmit visits to Google.
async function browser({ id = 'G-TEST123456', consent, clarityConsent, dnt = '0' } = {}) {
  const listeners = {},
    events = {},
    values = new Map(),
    scripts = [];
  if (consent) values.set('beles-google-consent', consent);
  if (clarityConsent) values.set('beles-clarity-consent', clarityConsent);
  const node = () => ({
    children: [],
    style: {},
    append(...items) {
      this.children.push(...items);
    },
    setAttribute() {},
  });
  const body = node(),
    footer = node(),
    head = node();
  head.append = (script) => scripts.push(script);
  const document = {
    body,
    head,
    documentElement: { lang: 'uk' },
    referrer: 'https://example.com/private?email=test',
    createElement: node,
    querySelector: () => footer,
    addEventListener: (key, fn) => {
      events[key] = fn;
    },
  };
  const window = {
    __BELES_CMS_PAYLOAD__: [
      { kind: 'product', itemKey: 'toy', name: 'Toy', brand: 'Brand' },
      { kind: 'brand', itemKey: 'brand', name: 'Brand' },
    ],
  };
  let requests = 0,
    reloads = 0;
  vm.runInNewContext(source, {
    window,
    document,
    navigator: { doNotTrack: dnt },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    },
    location: { origin: 'https://beles.example', pathname: '/', reload: () => reloads++ },
    fetch: async () => {
      requests++;
      return { json: async () => ({ gaMeasurementId: id }) };
    },
    URL,
    Date,
    encodeURIComponent,
    addEventListener: (key, fn) => {
      listeners[key] = fn;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    window,
    body,
    footer,
    scripts,
    events,
    values,
    requests: () => requests,
    reloads: () => reloads,
  };
}

(async () => {
  const inactive = await browser({ id: '' });
  assert.equal(inactive.body.children.length, 0);
  const denied = await browser({ consent: 'no' });
  assert.equal(denied.scripts.length, 0);
  const dnt = await browser({ dnt: '1', consent: 'yes' });
  assert.equal(dnt.requests(), 0);
  const independent = await browser({ clarityConsent: 'yes' });
  assert.equal(independent.scripts.length, 0, 'Clarity consent must not authorize Google');
  const box = independent.body.children[0];
  box.children[2].onclick();
  assert.equal(independent.values.get('beles-google-consent'), 'yes');
  assert.equal(independent.scripts.length, 1);
  assert.match(independent.scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-TEST123456/);
  const commands = independent.window.dataLayer.map((args) => Array.from(args));
  assert.equal(commands[0][0], 'consent');
  assert.equal(commands[0][1], 'default');
  assert.equal(commands[0][2].analytics_storage, 'denied');
  assert.equal(commands[1][2].analytics_storage, 'granted');
  const config = commands.find((args) => args[0] === 'config');
  assert.equal(config[2].page_location, 'https://beles.example/');
  assert.equal(config[2].page_referrer, 'https://example.com');
  box.children[2].onclick();
  assert.equal(independent.scripts.length, 1, 'No duplicate page view configuration');
  independent.events['beles:tracked-action']({ detail: { type: 'product', key: 'toy' } });
  const event = Array.from(independent.window.dataLayer.at(-1));
  assert.equal(event[1], 'view_item');
  assert.equal(event[2].items[0].item_id, 'toy');
  box.children[3].onclick();
  assert.equal(independent.window['ga-disable-G-TEST123456'], true);
  assert.equal(independent.reloads(), 1);
  const count = independent.window.dataLayer.length;
  independent.events['beles:tracked-action']({ detail: { type: 'contact', key: 'email' } });
  assert.equal(independent.window.dataLayer.length, count, 'No events after withdrawal');
  console.log(
    'PASS: GA4 opt-in, provider-specific consent, DNT, single initialization, catalog events, withdrawal; no external requests',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
