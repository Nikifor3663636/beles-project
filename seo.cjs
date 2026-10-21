'use strict';
const TITLE = 'Белес (Beles) - дитячі іграшки оптом в Україні';
const DESCRIPTION =
  'Белес - іграшки та дитячі товари оптом. Каталог брендів, презентації та співпраця з магазинами по всій Україні';
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function origin() {
  return new URL(process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`)
    .origin;
}
function enhance(html, rows) {
  const url = origin() + '/';
  const content = (key) =>
    rows.find((r) => r.kind === 'content' && r.name === key && r.published !== false);
  const organization = {
    '@type': 'Organization',
    '@id': url + '#organization',
    name: 'Белес Україна',
    alternateName: 'Beles',
    url,
    logo: origin() + '/favicon.png',
  };
  const email = content('email')?.textUA,
    phone = content('phone')?.textUA;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) organization.email = email;
  if (phone) organization.telephone = phone;
  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      organization,
      {
        '@type': 'WebSite',
        '@id': url + '#website',
        url,
        name: 'Beles',
        publisher: { '@id': url + '#organization' },
        inLanguage: ['uk', 'en'],
      },
    ],
  };
  html = html
    .replace(/<title>[\s\S]*?<\/title\s*>/i, '<title>' + TITLE + '</title>')
    .replace(/<meta\b[^>]*name=["']description["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*>/gi, '')
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, '');
  return html.replace(
    /<\/head\s*>/i,
    `<meta name="description" content="${escape(DESCRIPTION)}"><link rel="canonical" href="${escape(url)}"><meta property="og:title" content="${escape(TITLE)}"><meta property="og:description" content="${escape(DESCRIPTION)}"><meta property="og:url" content="${escape(url)}"><meta property="og:type" content="website"><link rel="icon" type="image/png" sizes="96x96" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script></head>`,
  );
}
function robots() {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /design-preview/\nSitemap: ${origin()}/sitemap.xml\n`;
}
function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin())}/</loc></url></urlset>`;
}
module.exports = { enhance, robots, sitemap };
