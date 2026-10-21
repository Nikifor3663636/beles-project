'use strict';
const net = require('node:net');
const crypto = require('node:crypto');
const { fail } = require('./security.cjs');
const trusted = new net.BlockList();
for (const item of (process.env.TRUSTED_PROXY_CIDRS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  const [ip, bits] = item.split('/');
  const family = net.isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  if (bits) trusted.addSubnet(ip, Number(bits), family);
  else trusted.addAddress(ip, family);
}
const salt = crypto.randomBytes(16),
  limits = new Map();
function address(req) {
  const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  // Railway's HTTP ingress supplies X-Real-IP. Outside Railway only explicitly
  // trusted proxies may supply forwarding headers. Never accept IP from JSON.
  const railway =
    !!process.env.RAILWAY_ENVIRONMENT_ID &&
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.|::1$|f[cd])/i.test(peer);
  if (railway || trusted.check(peer, net.isIP(peer) === 6 ? 'ipv6' : 'ipv4')) {
    const value = String(req.headers['x-real-ip'] || '').trim();
    if (net.isIP(value)) return { ip: value, source: 'proxy' };
  }
  return { ip: net.isIP(peer) ? peer : '', source: 'connection' };
}
function client(req) {
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  let ip = address(req).ip || peer;
  if (ip === peer && trusted.check(peer, net.isIP(peer) === 6 ? 'ipv6' : 'ipv4')) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim());
    const candidate = forwarded.at(-1);
    if (net.isIP(candidate)) ip = candidate;
  }
  return crypto.createHmac('sha256', salt).update(ip).digest('hex');
}
function limit(key, count, window) {
  const now = Date.now();
  if (limits.size > 10000)
    for (const [id, value] of limits) if (value.until < now) limits.delete(id);
  if (limits.size > 12000) fail(429, 'Забагато запитів. Спробуйте пізніше.');
  let value = limits.get(key);
  if (!value || value.until < now) {
    value = { count: 0, until: now + window };
    limits.set(key, value);
  }
  value.count++;
  if (value.count > count) fail(429, 'Забагато запитів. Спробуйте пізніше.');
}
function owner(session, fresh = false) {
  if (session.user.role !== 'owner') fail(403, 'Ця дія доступна лише головному адміністратору.');
}
module.exports = { client, limit, owner, address };
