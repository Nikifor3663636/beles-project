'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('public/contact-message.js', 'utf8');

async function check(outcome) {
  const calls = [];
  const email = { value: 'sender@example.com' };
  const message = { value: ' Message ', setCustomValidity() {} };
  const status = {};
  const button = {};
  let listener,
    reset = false,
    stopped = false;
  const form = {
    elements: { namedItem: (name) => ({ email, message })[name] },
    querySelector: (selector) => (selector.includes('status') ? status : button),
    addEventListener: (type, callback, capture) => {
      assert.equal(type, 'submit');
      assert.equal(capture, true);
      listener = callback;
    },
    reportValidity: () => true,
    reset: () => {
      reset = true;
    },
    setAttribute() {},
    removeAttribute() {},
  };
  vm.runInNewContext(code, {
    document: { getElementById: () => form },
    window: { location: { origin: 'https://belesbrands.com.ua', pathname: '/' } },
    AbortSignal,
    fetch: async (url, options) => {
      calls.push({ url, payload: JSON.parse(options.body) });
      if (outcome === 'network') throw Error('Network unavailable');
      return { ok: true, json: async () => ({ ok: outcome === 'accepted' }) };
    },
  });
  await listener({
    preventDefault() {},
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true, 'Legacy mailto handler is stopped');
  assert.equal(button.disabled, false);
  assert.equal(calls[0].url, '/api/feedback');
  assert.equal(calls[0].payload.contact, 'sender@example.com');
  assert.equal(calls[0].payload.message, 'Message');
  assert.equal(reset, outcome === 'accepted', 'Retain text on failed send');
  assert.equal(calls.length, 1, 'Only the site server receives contact data');
}
(async () => {
  for (const result of ['accepted', 'rejected', 'network']) await check(result);
  vm.runInNewContext(code, { document: { getElementById: () => null } });
  console.log(
    'PASS: direct contact destination, reply email, local copy, legacy interception and failure recovery',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
