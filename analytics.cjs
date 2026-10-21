const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const DAY = 86400000;
const date = (time) => new Date(time).toISOString().slice(0, 10);
const clean = (value) =>
  String(value || '')
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, 100);
const own = (object, key) => Object.hasOwn(object, key);
function bump(map, key, amount = 1) {
  key = clean(key) || 'Невідомо';
  if (!own(map, key) && Object.keys(map).length >= 1000) key = 'Інше';
  Object.defineProperty(map, key, {
    value: (own(map, key) ? map[key] : 0) + amount,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
function agent(ua) {
  return {
    device: /ipad|tablet|android(?!.*mobile)/i.test(ua)
      ? 'Планшет'
      : /mobile|iphone|ipod/i.test(ua)
        ? 'Телефон'
        : 'Комп’ютер',
    browser: /edg\//i.test(ua)
      ? 'Edge'
      : /opr\//i.test(ua)
        ? 'Opera'
        : /firefox|fxios/i.test(ua)
          ? 'Firefox'
          : /chrome|crios/i.test(ua)
            ? 'Chrome'
            : /safari/i.test(ua)
              ? 'Safari'
              : 'Інший',
    os: /android/i.test(ua)
      ? 'Android'
      : /iphone|ipad|ipod/i.test(ua)
        ? 'iOS'
        : /windows/i.test(ua)
          ? 'Windows'
          : /macintosh/i.test(ua)
            ? 'macOS'
            : /linux/i.test(ua)
              ? 'Linux'
              : 'Інша',
  };
}
module.exports = (directory, catalog, now = () => Date.now()) => {
  const file = path.join(directory, 'analytics.json.gz');
  let state = { version: 1, startedAt: new Date(now()).toISOString(), days: {} },
    dirty = false,
    storageError = null;
  if (fs.existsSync(file)) state = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  const live = new Map(),
    limits = new Map();
  function flush() {
    const cutoff = date(now() - 89 * DAY);
    for (const day of Object.keys(state.days))
      if (day < cutoff) {
        delete state.days[day];
        dirty = true;
      }
    for (const [day, value] of Object.entries(state.days))
      if (day < date(now() - 6 * DAY))
        for (const session of Object.values(value.sessions || {})) {
          if (session.ip || session.ipSource) dirty = true;
          delete session.ip;
          delete session.ipSource;
        }
    if (!dirty) return;
    let raw = JSON.stringify(state);
    while (Buffer.byteLength(raw) > 12 * 1024 * 1024 && Object.keys(state.days).length > 1) {
      delete state.days[Object.keys(state.days).sort()[0]];
      raw = JSON.stringify(state);
    }
    try {
      fs.writeFileSync(file + '.tmp', zlib.gzipSync(raw), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      dirty = false;
      storageError = null;
    } catch (error) {
      storageError = 'Не вдалося зберегти статистику: перевірте вільне місце';
      console.error('Analytics storage:', error.code);
    }
  }
  const timer = setInterval(flush, 15000);
  timer.unref();
  function ingest(body, req) {
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawler|spider|headless|lighthouse/i.test(ua) || req.headers.dnt === '1') return false;
    if (
      !body ||
      ![
        'pageview',
        'heartbeat',
        'brand',
        'product',
        'pdf',
        'contact',
        'scroll',
        'feedback',
      ].includes(body.type)
    )
      throw Error('Invalid analytics event');
    for (const key of ['visitor', 'session', 'id'])
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(body[key] || ''))
        throw Error('Invalid analytics identifier');
    const time = now(),
      dayKey = date(time);
    const key = crypto.createHash('sha256').update(body.visitor).digest('hex').slice(0, 20);
    const sid = crypto
      .createHash('sha256')
      .update(body.visitor + ':' + body.session)
      .digest('hex')
      .slice(0, 20);
    const rate = limits.get(sid) || { since: time, count: 0 };
    if (time - rate.since > 60000) {
      rate.since = time;
      rate.count = 0;
    }
    if (++rate.count > 120) return false;
    if (limits.size >= 10000)
      for (const [id, item] of limits) if (time - item.since > 60000) limits.delete(id);
    if (limits.size >= 10000 && !limits.has(sid)) return false;
    limits.set(sid, rate);
    const day = (state.days[dayKey] ||= {
      views: 0,
      sessions: {},
      devices: {},
      browsers: {},
      os: {},
      sources: {},
      languages: {},
      brands: {},
      products: {},
      pdf: {},
      contacts: {},
      hours: Array(24).fill(0),
      feedback: 0,
      capped: false,
    });
    let session = day.sessions[sid];
    if (!session) {
      if (Object.keys(day.sessions).length >= 5000) {
        day.capped = true;
        dirty = true;
        return false;
      }
      const info = agent(ua);
      session = day.sessions[sid] = {
        visitor: key,
        seconds: 0,
        scroll: 0,
        views: 0,
        actions: 0,
        ids: [],
        last: time,
        beat: time,
        device: info.device,
      };
      let source = 'Прямий перехід';
      try {
        const ref = new URL(body.referrer);
        if (ref.hostname !== req.headers.host?.split(':')[0]) source = ref.hostname;
      } catch {}
      if (body.source && /^[\p{L}\p{N}_. -]{1,60}$/u.test(body.source))
        source = 'UTM: ' + body.source;
      bump(day.sources, source);
      bump(day.devices, info.device);
      bump(day.browsers, info.browser);
      bump(day.os, info.os);
      bump(
        day.languages,
        /^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.language || '') ? body.language : 'Інша',
      );
    }
    if (session.ids.includes(body.id)) return false;
    let item;
    if (['brand', 'product', 'pdf'].includes(body.type)) {
      item = catalog().find(
        (r) =>
          r.published !== false &&
          r.kind === { brand: 'brand', product: 'product', pdf: 'presentation' }[body.type] &&
          r.itemKey === body.key,
      );
      if (!item) throw Error('Unknown analytics item');
    }
    session.ids.push(body.id);
    if (session.ids.length > 20) session.ids.shift();
    if (body.type === 'heartbeat') {
      session.seconds += Math.min(
        30,
        Math.max(0, Number(body.seconds) || 0),
        Math.max(0, (time - (session.beat || session.last)) / 1000),
      );
      session.beat = time;
    }
    if (body.type === 'pageview') {
      day.views++;
      session.views++;
      day.hours[new Date(time).getUTCHours()]++;
    }
    if (body.type === 'scroll' && Number.isFinite(body.depth))
      session.scroll = Math.max(session.scroll, Math.min(100, Math.max(0, body.depth)));
    if (item) {
      bump(day[{ brand: 'brands', product: 'products', pdf: 'pdf' }[body.type]], item.itemKey);
      session.actions++;
    }
    if (
      body.type === 'contact' &&
      [
        'phone',
        'email',
        'telegram',
        'instagram',
        'other',
        'cooperation_assortment',
        'cooperation_delivery',
        'cooperation_first_order',
        'cooperation_product_request',
        'cooperation_availability',
        'cooperation_cooperation',
      ].includes(body.key)
    ) {
      bump(day.contacts, body.key);
      session.actions++;
    }
    if (body.type === 'feedback') {
      day.feedback++;
      session.actions++;
    }
    session.last = time;
    const address = require('./request-security.cjs').address(req);
    session.ip = address.ip;
    session.ipSource = address.source;
    session.browser = agent(ua).browser;
    if (body.visible !== false)
      live.set(sid, { visitor: key, device: session.device, last: time, ip: address.ip });
    else live.delete(sid);
    for (const [id, item] of live) if (time - item.last > 90000) live.delete(id);
    dirty = true;
    return true;
  }
  function report(from, to) {
    to ||= date(now());
    from ||= date(now() - 6 * DAY);
    if (
      ![from, to].every(
        (s) =>
          /^\d{4}-\d{2}-\d{2}$/.test(s) &&
          Number.isFinite(Date.parse(s)) &&
          date(Date.parse(s)) === s,
      ) ||
      from > to ||
      (Date.parse(to) - Date.parse(from)) / DAY > 89
    )
      throw Error('Choose a date range up to 90 days');
    flush();
    function aggregate(start, end) {
      const out = {
        views: 0,
        visits: 0,
        visitors: 0,
        seconds: 0,
        engaged: 0,
        scroll: 0,
        feedback: 0,
        devices: {},
        browsers: {},
        os: {},
        sources: {},
        languages: {},
        brands: {},
        products: {},
        pdf: {},
        contacts: {},
        hours: Array(24).fill(0),
        timeline: [],
        capped: false,
      };
      const visitors = new Set();
      for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) {
        const dayKey = date(t),
          day = state.days[dayKey];
        const sessions = Object.values(day?.sessions || {});
        out.timeline.push({
          date: dayKey,
          views: day?.views || 0,
          visits: sessions.length,
          visitors: new Set(sessions.map((s) => s.visitor)).size,
        });
        if (!day) continue;
        out.views += day.views;
        out.visits += sessions.length;
        out.feedback += day.feedback;
        out.capped ||= day.capped;
        for (const session of sessions) {
          visitors.add(session.visitor);
          out.seconds += session.seconds;
          out.scroll += session.scroll;
          if (session.seconds >= 10 || session.actions > 0 || session.views > 1) out.engaged++;
        }
        for (const field of [
          'devices',
          'browsers',
          'os',
          'sources',
          'languages',
          'brands',
          'products',
          'pdf',
          'contacts',
        ])
          for (const [key, count] of Object.entries(day[field])) bump(out[field], key, count);
        day.hours.forEach((n, i) => (out.hours[i] += n));
      }
      out.visitors = visitors.size;
      out.avgSeconds = out.visits ? Math.round(out.seconds / out.visits) : 0;
      out.avgScroll = out.visits ? Math.round(out.scroll / out.visits) : 0;
      out.engagementRate = out.visits ? Math.round((out.engaged / out.visits) * 100) : 0;
      return out;
    }
    const result = aggregate(from, to),
      span = Date.parse(to) - Date.parse(from) + DAY;
    const previous = aggregate(date(Date.parse(from) - span), date(Date.parse(from) - DAY));
    const people = new Map();
    for (const item of live.values())
      if (now() - item.last <= 90000) people.set(item.visitor, item);
    const onlineDevices = {};
    const activeVisitors = new Set(people.keys());
    for (const item of people.values()) bump(onlineDevices, item.device);
    const recentVisitors = [];
    for (const [day, entry] of Object.entries(state.days)) {
      if (day < from || day > to || day < date(now() - 6 * DAY)) continue;
      for (const session of Object.values(entry.sessions))
        if (session.ip)
          recentVisitors.push({
            ip: session.ip,
            source: session.ipSource,
            device: session.device,
            browser: session.browser || '',
            lastSeen: new Date(session.last).toISOString(),
            views: session.views,
            online: now() - session.last <= 90000 && activeVisitors.has(session.visitor),
          });
    }
    recentVisitors.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const names = new Map(catalog().map((r) => [r.kind + ':' + r.itemKey, r]));
    for (const [field, kind] of [
      ['brands', 'brand'],
      ['products', 'product'],
      ['pdf', 'presentation'],
    ])
      result[field] = Object.entries(result[field])
        .map(([key, count]) => ({
          key,
          name: names.get(kind + ':' + key)?.name || key,
          brand: names.get(kind + ':' + key)?.brand || '',
          count,
        }))
        .sort((a, b) => b.count - a.count);
    return {
      ...result,
      from,
      to,
      previous: { views: previous.views, visitors: previous.visitors, visits: previous.visits },
      online: people.size,
      onlineDevices,
      recentVisitors: recentVisitors.slice(0, 1000),
      recentVisitorsTotal: recentVisitors.length,
      startedAt: state.startedAt,
      retainedFrom: Object.keys(state.days).sort()[0] || null,
      updatedAt: new Date(now()).toISOString(),
      storageError,
    };
  }
  return {
    ingest,
    report,
    flush,
    close() {
      clearInterval(timer);
      flush();
    },
  };
};
