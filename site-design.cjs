'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
function parts(html) {
  const blockLabels = {
    top: 'Головний екран',
    brands: 'Каталог брендів і товарів',
    about: 'Про компанію',
    contacts: 'Контакти',
    'bx-voices': 'Партнери',
    'beles-brand-rail': 'Категорії та список брендів',
  };
  const result = [],
    stack = [],
    counts = {};
  const tokens = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z][^>]*>/gi;
  let m;
  while ((m = tokens.exec(html))) {
    const t = m[0];
    if (t.startsWith('<!--')) continue;
    const tag = t.match(/^<\/?([\w-]+)/)?.[1].toLowerCase();
    if (tag === 'script') continue;
    if (tag === 'style') {
      const n = (counts.style = (counts.style || 0) + 1);
      result.push({
        id: 'style-' + n,
        label: 'CSS · шар ' + n,
        start: m.index,
        end: tokens.lastIndex,
      });
      continue;
    }
    if (!['header', 'footer', 'section', 'aside'].includes(tag)) continue;
    if (t.startsWith('</')) {
      const open = stack.pop();
      if (open && open.tag === tag) result.push({ ...open, end: tokens.lastIndex });
      continue;
    }
    const n = (counts[tag] = (counts[tag] || 0) + 1),
      id = t.match(/\bid\s*=\s*["']([^"']+)/i)?.[1];
    const label = t.match(/\baria-label\s*=\s*["']([^"']+)/i)?.[1];
    stack.push({
      tag,
      id: tag + '-' + (id || n),
      label:
        blockLabels[id] ||
        label ||
        { header: 'Шапка', footer: 'Підвал', aside: 'Бічна панель', section: 'Блок' }[tag] +
          ' · ' +
          (id || n),
      start: m.index,
    });
  }
  return result
    .sort((a, b) => a.start - b.start)
    .map((p) => ({ ...p, value: html.slice(p.start, p.end) }));
}
module.exports = function (
  directory,
  baseFile,
  repository = require('./repository.cjs')(directory),
) {
  const originalFile = path.join(directory, 'site-original.html'),
    file = path.join(directory, 'site-design.json'),
    previous = path.join(directory, 'site-design.previous.json');
  try {
    fs.copyFileSync(baseFile, originalFile, fs.constants.COPYFILE_EXCL);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const original = fs.readFileSync(originalFile, 'utf8');
  const historyFile = path.join(directory, 'site-design.history.json');
  let cached, historyCache, previousCache;
  const history = () =>
    historyCache ||
    (fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []);
  const initial = () => ({ html: original, css: '', colors: {} });
  // Published edits take precedence; the immutable original is only used for restoration.
  const read = () =>
    cached ||
    (fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : {
          html:
            process.env.COOPERATION_APPROVED === 'true'
              ? require('./cooperation.cjs').enhance(fs.readFileSync(baseFile, 'utf8'))
              : fs.readFileSync(baseFile, 'utf8'),
          css: '',
          colors: {},
        });
  const revision = (s) => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex');
  const defaults = { background: '#fffaf6', text: '#101a3d', accent: '#ed008c', hero: '#fffaf6' };
  function value(s, id) {
    if (id === 'html') return s.html;
    if (id === 'css') return s.css;
    if (id === 'colors') return JSON.stringify({ ...defaults, ...s.colors }, null, 2);
    if (id.startsWith('live-'))
      return JSON.stringify(
        s.elementOverrides?.find((entry) => entry.id === id)?.fields || {},
        null,
        2,
      );
    if (id.startsWith('element-')) {
      const element = require('./visual-elements.cjs')
        .elements(s.html)
        .find((node) => node.id === id);
      if (!element) throw Error('Елемент не знайдено.');
      return element.value;
    }
    const p = parts(s.html).find((p) => p.id === id);
    if (!p) throw Error('Блок не знайдено. Оновіть редактор.');
    return p.value;
  }
  function edit(b) {
    const s = structuredClone(read());
    if (b.revision !== revision(s)) {
      const e = Error('Сайт змінено в іншій вкладці. Оновіть редактор.');
      e.status = 409;
      throw e;
    }
    if (b.restoreAll) return initial();
    if (b.version) {
      const entry = history().find((v) => v.id === b.version);
      if (!entry) throw Error('Версію не знайдено.');
      return entry.state;
    }
    if (b.undo) {
      if (!previousCache && !fs.existsSync(previous)) throw Error('Немає попередньої версії.');
      return structuredClone(previousCache || JSON.parse(fs.readFileSync(previous, 'utf8')));
    }
    if (b.part?.startsWith('live-')) {
      const old = (s.elementOverrides || []).find((entry) => entry.id === b.part);
      const input = b.runtime || old;
      if (
        !input ||
        typeof input.selector !== 'string' ||
        input.selector.length > 1500 ||
        !input.selector.startsWith('body ') ||
        /[,{};]/.test(input.selector) ||
        !/^(?:div|span|p|h[1-6]|a|button|img|label|input|textarea|section|article|header|footer|li|ul|nav|small|strong|em|i|b)$/.test(
          input.tag,
        )
      )
        throw Error('Некоректний елемент перегляду.');
      const id =
        'live-' + crypto.createHash('sha256').update(input.selector).digest('hex').slice(0, 20);
      if (id !== b.part) throw Error('Елемент змінився. Виберіть його повторно.');
      const changes = b.element || JSON.parse(b.value || '{}');
      const synthetic = `<html><head></head><body><${input.tag}></${input.tag}></body></html>`;
      const parser = require('./visual-elements.cjs');
      const sample = parser.elements(synthetic)[0];
      parser.edit(synthetic, sample.id, changes);
      const defaults = old?.defaults || input.defaults || sample.fields;
      parser.edit(
        synthetic,
        sample.id,
        Object.fromEntries(Object.entries(defaults).filter(([, value]) => value !== null)),
      );
      const entry = {
        id,
        selector: input.selector,
        tag: input.tag,
        label: typeof input.label === 'string' ? input.label.slice(0, 120) : input.tag,
        fields: b.element ? { ...(old?.fields || {}), ...changes } : changes,
        defaults,
        baseline:
          old?.baseline ||
          (typeof input.baseline === 'string' ? input.baseline.slice(0, 20000) : ''),
      };
      s.elementOverrides = (s.elementOverrides || []).filter((entry) => entry.id !== id);
      if (s.elementOverrides.length >= 500)
        throw Error('Досягнуто ліміт 500 налаштувань елементів.');
      s.elementOverrides.push(entry);
      return s;
    }
    if (b.element && b.part?.startsWith('element-')) {
      s.html = require('./visual-elements.cjs').edit(s.html, b.part, b.element);
      return edit({ revision: b.revision, part: 'html', value: s.html });
    }
    const v = b.original ? value(initial(), b.part) : b.value;
    if (typeof v !== 'string' || Buffer.byteLength(v) > 2 * 1024 * 1024)
      throw Error('Максимальний розмір — 2 МБ.');
    if (b.part === 'html') s.html = v;
    else if (b.part === 'css') {
      if (/<\/style/i.test(v)) throw Error('У CSS не можна додавати HTML-теги style.');
      s.css = v;
    } else if (b.part === 'colors') {
      const c = JSON.parse(v);
      s.colors = {};
      for (const k of Object.keys(defaults)) {
        if (c[k] && !/^#[0-9a-f]{6}$/i.test(c[k])) throw Error('Колір має бути у форматі #RRGGBB.');
        if (c[k]) s.colors[k] = c[k];
      }
    } else {
      const p = (
        b.part?.startsWith('element-')
          ? require('./visual-elements.cjs').elements(s.html)
          : parts(s.html)
      ).find((p) => p.id === b.part);
      if (!p) throw Error('Блок не знайдено.');
      s.html = s.html.slice(0, p.start) + v + s.html.slice(p.end);
    }
    if (!/<html\b/i.test(s.html) || !/<\/head\s*>/i.test(s.html) || !/<\/body\s*>/i.test(s.html))
      throw Error('HTML має містити html, head та body.');
    for (const script of s.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(script[1])) continue;
      const type =
        script[1].match(/\btype\s*=\s*["']([^"']+)/i)?.[1].toLowerCase() || 'text/javascript';
      try {
        if (['application/json', 'application/ld+json'].includes(type)) JSON.parse(script[2]);
        else if (['text/javascript', 'application/javascript', 'module'].includes(type))
          require('acorn').parse(script[2], {
            ecmaVersion: 'latest',
            sourceType: type === 'module' ? 'module' : 'script',
          });
      } catch {
        throw Error(
          'У шаблоні є синтаксична помилка JavaScript/JSON. Виправте її перед публікацією.',
        );
      }
    }
    return s;
  }
  function template(s = read()) {
    const c = s.colors;
    let css = s.css || '';
    if (Object.keys(c).length)
      css += `\n:root{--cream:${c.background || defaults.background};--ink:${c.text || defaults.text};--coral:${c.accent || defaults.accent}}body{background:${c.background || defaults.background}!important;color:${c.text || defaults.text}!important}.beles-hero,.beles-hero .beles-theatre{background:${c.hero || defaults.hero}!important}.btn,.pill.hot{background:${c.accent || defaults.accent}!important}`;
    let result = css
      ? s.html.replace(
          /<\/head\s*>/i,
          () => '<style id="beles-custom-design">' + css + '</style></head>',
        )
      : s.html;
    if (s.elementOverrides?.length)
      result = result.replace(
        /<\/head\s*>/i,
        () =>
          '<script type="application/json" id="beles-element-overrides">' +
          JSON.stringify(
            s.elementOverrides.map(({ selector, fields }) => ({ selector, fields })),
          ).replace(/</g, '\\u003c') +
          '</script></head>',
      );
    return result;
  }
  async function save(s, expected = revision(read())) {
    const versions = structuredClone(history());
    const old = await repository.mutate(
      'site-design.json',
      (old) => {
        if (revision(old) !== expected) {
          const error = Error('Сайт змінено в іншій вкладці. Оновіть редактор.');
          error.status = 409;
          throw error;
        }
        versions.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), state: old });
        return {
          value: s,
          related: {
            'site-design.previous.json': old,
            'site-design.history.json': versions.slice(0, 10),
          },
          result: old,
        };
      },
      read(),
    );
    cached = structuredClone(s);
    previousCache = old;
    historyCache = versions.slice(0, 10);
    return view();
  }
  function view() {
    const s = read();
    const elements = require('./visual-elements.cjs').elements(s.html);
    const originalElements = require('./visual-elements.cjs').elements(original);
    const elementOriginals = Object.fromEntries(
      elements.flatMap((node) => {
        const match = node.attrs.id
          ? originalElements.find((old) => old.attrs.id === node.attrs.id && old.tag === node.tag)
          : originalElements.find(
              (old) =>
                old.id === node.id &&
                old.tag === node.tag &&
                !old.attrs.id &&
                old.attrs.class === node.attrs.class,
            );
        return match ? [[node.id, match.value]] : [];
      }),
    );
    return {
      revision: revision(s),
      parts: [
        { id: 'colors', label: 'Кольори' },
        { id: 'css', label: 'Додаткові стилі CSS' },
        { id: 'html', label: 'Весь HTML / JavaScript' },
        ...parts(s.html).map(({ id, label }) => ({ id, label })),
        ...elements.map(({ id, label }) => ({ id, label })),
        ...(s.elementOverrides || []).map(({ id, label }) => ({
          id,
          label: 'На сторінці · ' + label,
        })),
      ],
      elements: [
        ...elements.map(({ id, fields }) => ({ id, fields })),
        ...(s.elementOverrides || []).map(
          ({ id, fields, defaults, selector, tag, label, baseline }) => ({
            id,
            fields: { ...defaults, ...fields },
            runtime: { selector, tag, label, baseline, defaults },
          }),
        ),
      ],
      values: {
        ...Object.fromEntries(
          (s.elementOverrides || []).map((entry) => [
            entry.id,
            JSON.stringify(entry.fields, null, 2),
          ]),
        ),
        ...Object.fromEntries(elements.map((node) => [node.id, node.value])),
        ...Object.fromEntries(
          ['colors', 'css', 'html', ...parts(s.html).map((p) => p.id)].map((id) => [
            id,
            value(s, id),
          ]),
        ),
      },
      originals: {
        ...Object.fromEntries((s.elementOverrides || []).map((entry) => [entry.id, '{}'])),
        ...elementOriginals,
        ...Object.fromEntries(
          ['colors', 'css', 'html', ...parts(original).map((p) => p.id)].map((id) => [
            id,
            value(initial(), id),
          ]),
        ),
      },
      canUndo: !!previousCache || fs.existsSync(previous),
      history: history().map(({ id, at }) => ({ id, at })),
    };
  }
  return {
    view,
    edit,
    save,
    template,
    value,
    read,
    original: initial,
    async ready() {
      cached = await repository.read('site-design.json', read());
      historyCache = await repository.read('site-design.history.json', []);
      previousCache = await repository.read('site-design.previous.json', null);
    },
  };
};
module.exports.parts = parts;
