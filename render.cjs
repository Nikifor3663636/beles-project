const brandLogoManifest = require('./public/brand-logos/manifest.json');
const brandLogoByImage = Object.fromEntries(
  brandLogoManifest.filter((item) => item.src).map((item) => [item.old, item.src]),
);

function buildPage(base, rows) {
  base = require('./page-layout.cjs')(base);
  const unique = new Map();
  for (const r of rows) if (r.itemKey) unique.set(r.kind + ':' + r.itemKey, r);
  const data = [...unique.values()]
    .filter((r) => r.published !== false)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((r) =>
      r.kind === 'brand' && brandLogoByImage[r.image]
        ? { ...r, image: brandLogoByImage[r.image] }
        : r,
    );
  const brands = data.filter((r) => r.kind === 'brand'),
    products = data.filter((r) => r.kind === 'product'),
    presentations = data.filter((r) => r.kind === 'presentation'),
    content = data
      .filter((r) => r.kind === 'content')
      .filter((r) => !['benefit_1_title', 'benefit_1_body'].includes(r.name))
      .map((r) =>
        r.name === 'benefit_3_title'
          ? { ...r, textUA: 'Доставка товару під замовлення', textEN: 'Delivery of items on request' }
          : r,
      );
  const safe = (s) =>
    String(s || '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c] || c,
    );
  const imageURL = (s) =>
    /^(?:https?:\/\/|\/uploads\/|\/assets\/brand-logos\/)/.test(String(s || '')) ? String(s) : '';
  const productTitle = (p) =>
    String(p.name || '') + (p.sku && !String(p.name || '').includes(p.sku) ? ' ' + p.sku : '');
  const catalog = brands.map((b) => ({
    n: safe(b.name),
    c: b.accent || '#0074c8',
    d: safe(b.descriptionUA),
    p: products
      .filter((p) => p.brand === b.name)
      .map((p) => [
        safe(productTitle(p)),
        '<img loading="lazy" decoding="async" src="' +
          safe(imageURL(p.image)) +
          '" alt="' +
          safe(p.name) +
          '">',
        safe(p.descriptionUA),
      ]),
    categories: b.categories || '',
  }));
  const logos = Object.fromEntries(brands.map((b) => [safe(b.name), imageURL(b.image)]));
  const translations = {};
  for (const r of [...brands, ...products]) {
    if (r.nameEN) {
      const title = r.kind === 'product' ? productTitle(r) : r.name;
      const enTitle = r.nameEN + (r.sku && !String(r.nameEN).includes(r.sku) ? ' ' + r.sku : '');
      translations[title] = enTitle;
    }
    if (r.descriptionEN) translations[r.descriptionUA] = r.descriptionEN;
  }
  const pres = Object.fromEntries(
    presentations
      .filter((r) => r.pdfFile)
      .flatMap((r) => [
        [safe(r.brand), r.pdfFile],
        [r.itemKey, r.pdfFile],
      ]),
  );
  const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');
  const heroImages = Object.fromEntries(
    products.filter((p) => p.sku).map((p) => [p.brand + '/' + p.sku, imageURL(p.image)]),
  );
  const hook = `\n/* Live content from native Framer CMS collection lists. */\nwindow.__BELES_CMS_PAYLOAD__=${json(data)};BRANDS.splice(0,BRANDS.length,...${json(catalog)});Object.assign(LOGO,${json(logos)});Object.assign(BR_EN,${json(translations)});Object.assign(DRIVE_PRODUCT_IMAGES,${json(heroImages)});\n`;
  const hasStableHooks = base.includes('/* BELES:CATALOG */');
  let html = hasStableHooks
    ? base.replace('/* BELES:CATALOG */', () => hook)
    : base.replace(
        "const bl=document.getElementById('bl')",
        () => hook + "const bl=document.getElementById('bl')",
      );
  html = hasStableHooks
    ? html.replace(
        '/* BELES:PRESENTATIONS */',
        () =>
          `for(const key of Object.keys(PRES))delete PRES[key];Object.assign(PRES,${json(pres)});`,
      )
    : html.replace(/const PRES=(\{[^\n]+\});/, () => 'const PRES=' + json(pres) + ';');
  const categoriesHook =
    'for(const cat of BRAND_CATEGORIES){if(cat.id!=="all")cat.names=BRANDS.filter(b=>(b.categories||"").split(";").includes(cat.id)).map(b=>b.n);}';
  html = hasStableHooks
    ? html.replace('/* BELES:CATEGORIES */', () => categoriesHook)
    : html.replace(
        /const BRAND_CATEGORIES=([\s\S]*?\n\]);/,
        (match) =>
          match +
          '\nfor(const cat of BRAND_CATEGORIES){if(cat.id!=="all")cat.names=BRANDS.filter(b=>(b.categories||"").split(";").includes(cat.id)).map(b=>b.n);}',
      );
  if (hasStableHooks) {
    const updates = {
      uk: { panel_title: 'Beles · Комфорт', fb_thanks: '' },
      en: { panel_title: 'Beles · Comfort', fb_thanks: '' },
    };
    for (const c of content)
      for (const [lang, value] of [
        ['uk', c.textUA],
        ['en', c.textEN],
      ])
        if (value !== undefined) updates[lang][c.name] = value;
    html = html.replace(
      '/* BELES:TRANSLATIONS */',
      () =>
        `for(const [lang,values]of Object.entries(${json(updates)})){if(I18N[lang])Object.assign(I18N[lang],values);}`,
    );
  } else
    html = html.replace(/const I18N = (\{[^\n]+\});/, (_, raw) => {
      const dictionaries = JSON.parse(raw);
      for (const [language, dictionary] of Object.entries(dictionaries)) {
        dictionary.panel_title = language === 'uk' ? 'Beles · Комфорт' : 'Beles · Comfort';
        dictionary.fb_thanks = '';
      }
      for (const c of content)
        for (const [lang, value] of [
          ['uk', c.textUA],
          ['en', c.textEN],
        ])
          if (dictionaries[lang] && value !== undefined) dictionaries[lang][c.name] = value;
      return 'const I18N = ' + json(dictionaries) + ';';
    });
  const changes = {
    content,
    brands: brands.length,
    products: products.length,
  };
  const tail = `<script>(${applyLiveContent.toString()})(${json(changes)});<\/script>`;
  return html
    .replace(
      /<\/head\s*>/i,
      `<style id="beles-benefits-layout">
        .beles-benefits {
          max-width: 1040px !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: clamp(16px, 2vw, 24px) !important;
          align-items: stretch;
        }
        .beles-benefits > .beles-benefit {
          box-sizing: border-box;
          min-width: 0;
          min-height: 220px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          border: 1px solid #d6e0e9;
          border-radius: 24px;
          padding: clamp(22px, 2.5vw, 32px);
        }
        .beles-benefits > .beles-benefit h3 { margin-bottom: 12px; }
        .beles-benefits > .beles-benefit p { margin: 0; }
        @media (max-width: 900px) {
          .beles-benefits { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 600px) {
          .beles-benefits { grid-template-columns: 1fr !important; padding: 24px 16px; gap: 14px !important; }
          .beles-benefits > .beles-benefit { min-height: 0; padding: 22px 20px; border-radius: 20px; }
        }
      </style><link rel="stylesheet" href="/assets/product-gallery.css?v=20261022-3"></head>`,
    )
    .replace(
      /<\/body\s*>/i,
      tail +
        '<script src="/assets/visual-elements.js?v=20261026-1" defer></script>' +
        '<script src="/assets/product-gallery.js?v=20261022-2" defer></script></body>',
    );
}

// Serialized into the public page; keep this function independent of server variables.
function applyLiveContent(data) {
  function apply() {
    const en = document.documentElement.lang === 'en';
    for (const content of data.content) {
      const text = en ? content.textEN || content.textUA : content.textUA;
      if (!['phone', 'email', 'telegram'].includes(content.name)) continue;
      const prefix =
        content.name === 'phone' ? 'tel:' : content.name === 'email' ? 'mailto:' : 'https://t.me/';
      document.querySelectorAll('a[href^="' + prefix + '"]').forEach((link) => {
        if (content.url && /^(https?:|tel:|mailto:)/.test(content.url)) link.href = content.url;
        const textNode = [...link.childNodes].find((node) => node.nodeType === 3);
        if (textNode) textNode.textContent = text + ' ';
      });
    }
    for (const [key, count] of [
      ['stat_brands', data.brands],
      ['stat_products', data.products],
    ]) {
      const element = document.querySelector('[data-beles-copy="' + key + '"]');
      if (!element) continue;
      if (element.previousElementSibling)
        element.previousElementSibling.textContent = String(count);
      if (key === 'stat_products')
        element.textContent = en ? 'products in the catalog' : 'товари у каталозі';
    }
    document.querySelectorAll('.catalog-count').forEach((element) => {
      element.textContent = data.brands + ' / BELES';
    });
  }
  apply();
  document.addEventListener('beles:languagechange', apply);
  window.__BELES_CMS_ACTIVE__ = { brands: data.brands, products: data.products };
}

module.exports = buildPage;
