'use strict';
const cards = [
  [
    'Бренди для вашої аудиторії',
    'Підбираєте товари для дитячого магазину, онлайн-продажів чи торговельної мережі? Перегляньте бренди та категорії, щоб знайти свій напрям.',
    'Переглянути асортимент',
    'catalog',
    'Brands for your audience',
    'Choosing products for a children’s shop, online store or retail chain? Explore brands and categories to find your direction.',
    'Explore the range',
  ],
  [
    'Поставки з погодженими умовами',
    'Уточніть наявність, обсяги та умови доставки до оформлення замовлення. Обговоримо постачання для вашого формату бізнесу.',
    'Дізнатися умови',
    'delivery',
    'Deliveries on agreed terms',
    'Check availability, quantities and delivery terms before ordering. Discuss supplies for your business format.',
    'Discuss delivery',
  ],
  [
    'Допомога з першим замовленням',
    'Розкажіть про ваш магазин і категорії, які вас цікавлять. Допоможемо зорієнтуватися в асортименті та презентаціях брендів.',
    'Обговорити підбір',
    'first_order',
    'Help with your first order',
    'Tell us about your shop and the categories you are interested in. We can guide you through the range and brand presentations.',
    'Discuss your selection',
  ],
];
const benefits = [
  [
    'Асортимент під ваш формат',
    'Переглядайте бренди та категорії, щоб підібрати товари для вашого магазину. За потреби обговоримо добірку з менеджером',
    'Переглянути бренди',
    'catalog',
    'An assortment for your format',
    'Explore brands and categories to choose products for your shop. Discuss a selection with a manager if needed.',
    'Explore brands',
  ],
  [
    'Зручні умови доставки',
    'Уточніть спосіб доставки, доступність у вашому регіоні та умови для замовлення. Менеджер допоможе погодити деталі постачання',
    'Дізнатися умови',
    'delivery',
    'Convenient delivery terms',
    'Ask about delivery methods, availability in your region and order terms. A manager can help agree on the details.',
    'Discuss delivery',
  ],
  [
    'Потрібен товар під замовлення?',
    'Не знайшли потрібної позиції? Надішліть назву або артикул - перевіримо можливість постачання та повідомимо умови.',
    'Запитати про товар',
    'product_request',
    'Looking for a specific product?',
    'Can’t find an item? Send its name or SKU and we will check supply options and terms.',
    'Ask about a product',
  ],
  [
    'Наявність і відвантаження',
    'Запитайте про актуальну наявність потрібних позицій і можливі строки відвантаження перед оформленням замовлення.',
    'Уточнити наявність',
    'availability',
    'Availability and dispatch',
    'Ask about current stock and possible dispatch times before placing your order.',
    'Check availability',
  ],
];
const paths = [
  '<path d="M12 27 40 12l28 15v32L40 74 12 59zM12 27l28 16 28-16M40 43v31M26 20l28 16"/>',
  '<path d="M8 23h40v38H8zM48 36h14l12 13v12H48M15 15h25M12 70h56"/><circle cx="23" cy="62" r="7"/><circle cx="62" cy="62" r="7"/>',
  '<path d="M17 12h34l12 13v49H17zM51 12v16h12M26 39h28M26 49h18M26 59h12"/><circle cx="62" cy="59" r="13"/><path d="m56 59 4 4 8-9"/>',
  '<path d="M10 33h60v41H10zM16 33V19h48v14M24 19V9h32v10M19 45h18v18H19zM46 45h15M46 54h15M46 63h9"/>',
];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const text = (ua, en) =>
  `<span data-coop-ua="${escape(ua)}" data-coop-en="${escape(en)}">${escape(ua)}</span>`;
function card(row, i, illustrated) {
  return `<article>${illustrated ? `<svg viewBox="0 0 84 84" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${paths[i]}</svg>` : `<span class="coop-number">0${i + 1}</span>`}<h3>${text(row[0], row[4])}</h3><p>${text(row[1], row[5])}</p><button type="button" data-coop-theme="${row[3]}">${text(row[2], row[6])}<span aria-hidden="true"> ↗</span></button></article>`;
}
function enhance(html) {
  if (/id=["']cooperation["']/.test(html)) return html;
  const help = `<div class="coop-help"><h3>${text('Не знаєте, з чого почати?', 'Not sure where to start?')}</h3><p>${text('Залиште контакт - обговоримо асортимент і умови співпраці для вашого магазину', 'Leave your contact details to discuss the range and terms for your shop')}</p><button type="button" data-coop-theme="assortment">${text('Отримати консультацію', 'Get advice')}</button></div>`;
  const section = `<section class="beles-cooperation" id="cooperation">
    <div class="coop-inner">
    <p class="coop-kicker">BELES / B2B</p>
    <h2>${text('Ваш наступний асортимент починається тут', 'Your next product range starts here')}</h2>
    <p class="coop-lead">${text('Знайомтеся з брендами, переглядайте товари та обговорюйте співпрацю з командою Beles', 'Meet the brands, explore products and discuss cooperation with the Beles team')}</p>
    <div class="coop-grid coop-intro">${cards.map((r, i) => card(r, i, false)).join('')}</div>${help}<h2>${text('Більше можливостей для вашого магазину', 'More possibilities for your shop')}</h2>
    <p class="coop-lead">${text('Знайдіть потрібний асортимент і обговоріть постачання з командою Beles', 'Find your range and discuss supplies with the Beles team')}</p>
    <div class="coop-grid">${benefits.map((r, i) => card(r, i, true)).join('')}</div>
    <div class="coop-cta">
    <h2>${text('Обговорімо асортимент для вашого магазину', 'Let’s discuss the range for your shop')}</h2>
    <p>${text('Залиште контакт і коротко розкажіть, що шукаєте. Команда Beles допоможе уточнити наступні кроки', 'Leave your contact details and briefly tell us what you need. The Beles team can help clarify the next steps')}</p>
    <button type="button" data-coop-theme="cooperation">${text('Обговорити співпрацю', 'Discuss cooperation')}</button>
    </div>
    </div>
    </section>
    <dialog id="coop-dialog">
    <form id="coop-form">
    <button type="button" id="coop-close" aria-label="Close / Закрити">×</button>
    <h2>${text('Обговорити співпрацю', 'Discuss cooperation')}</h2>
    <p id="coop-topic">
    </p>
    <label>${text('Ваше ім’я', 'Your name')}<input name="name" required maxlength="100" autocomplete="name">
    </label>
    <label>${text('Електронна пошта або телефон', 'Email or phone')}<input name="contact" required maxlength="250" autocomplete="email">
    </label>
    <label>${text('Формат магазину (необов’язково)', 'Shop format (optional)')}<input name="shopFormat" maxlength="120">
    </label>
    <div id="coop-product-fields" hidden>
    <label>${text('Назва або артикул товару', 'Product name or SKU')}<input name="sku" maxlength="200">
    </label>
    <label>${text('Кількість', 'Quantity')}<input name="quantity" type="number" min="1" max="1000000">
    </label>
    </div>
    <label>${text('Що вас цікавить? (необов’язково)', 'What are you looking for? (optional)')}<textarea name="message" maxlength="5000">
    </textarea>
    </label>
    <p id="coop-status" role="status" aria-live="polite">
    </p>
    <button type="submit" class="coop-submit">${text('Надіслати запит', 'Send request')}</button>
    </form>
    </dialog>`;
  html = html.replace(
    /<section\b[^>]*class=["'][^"']*\bbeles-benefits\b[^"']*["'][^>]*>[\s\S]*?<\/section\s*>/i,
    '',
  );
  const positioned = /<footer\b/i.test(html)
    ? html.replace(/<footer\b/i, section + '<footer')
    : html.replace(/<\/body\s*>/i, section + '</body>');
  return positioned
    .replace(/<\/body\s*>/i, '<script src="/assets/cooperation.js" defer></script></body>')
    .replace(/<\/head\s*>/i, '<link rel="stylesheet" href="/assets/cooperation.css"></head>');
}
module.exports = { enhance };
