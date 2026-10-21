'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fail(status, message) {
  const error = Error(message);
  error.status = status;
  throw error;
}
let hashesActive = 0;
const hashWaiters = [];
async function passwordHash(password, salt, version = 1) {
  if (hashesActive < 2) hashesActive++;
  else {
    if (hashWaiters.length >= 32) fail(429, 'Забагато перевірок пароля. Спробуйте пізніше.');
    await new Promise((resolve) => hashWaiters.push(resolve));
  }
  try {
    const options = version === 2 ? { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 } : {};
    return (await scrypt(password, salt, 64, options)).toString('hex');
  } finally {
    const next = hashWaiters.shift();
    if (next) next();
    else hashesActive--;
  }
}
function equal(a, b) {
  const left = Buffer.from(String(a)),
    right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function base32(bytes) {
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw Error('Invalid TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest(),
    offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function verifyTotp(secret, code, lastStep = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1])
    if (step > lastStep && equal(totp(secret, step), code)) return step;
  return null;
}
function key() {
  const text = process.env.APP_ENCRYPTION_KEY || '';
  const bytes = /^[a-f0-9]{64}$/i.test(text)
    ? Buffer.from(text, 'hex')
    : Buffer.from(text, 'base64');
  if (bytes.length !== 32)
    fail(503, 'Для 2FA власник має налаштувати APP_ENCRYPTION_KEY на сервері.');
  return bytes;
}
function encrypt(text) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
function decrypt(text) {
  try {
    const [iv, tag, data] = text.split('.').map((v) => Buffer.from(v, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error.status) throw error;
    fail(503, 'Неможливо відкрити налаштування 2FA. Зверніться до власника.');
  }
}
const tokenHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
module.exports = {
  fail,
  passwordHash,
  equal,
  base32,
  totp,
  verifyTotp,
  encrypt,
  decrypt,
  tokenHash,
};
