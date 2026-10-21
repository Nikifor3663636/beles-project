(() => {
  'use strict';
  const dialog = document.getElementById('coop-dialog'),
    form = document.getElementById('coop-form');
  if (!dialog || !form) return;
  const english = () => document.documentElement.lang === 'en';
  const t = (ua, en) => (english() ? en : ua);
  const themes = {
    assortment: ['Підбір асортименту', 'Assortment selection'],
    delivery: ['Доставка', 'Delivery'],
    first_order: ['Перше замовлення', 'First order'],
    product_request: ['Товар під замовлення', 'Product enquiry'],
    availability: ['Наявність', 'Availability'],
    cooperation: ['Співпраця', 'Cooperation'],
  };
  let theme = 'cooperation',
    opener,
    busy = false;
  function translate() {
    document
      .querySelectorAll('[data-coop-ua]')
      .forEach((e) => (e.textContent = english() ? e.dataset.coopEn : e.dataset.coopUa));
    document.getElementById('coop-topic').textContent = themes[theme][english() ? 1 : 0];
    document.getElementById('coop-close').setAttribute('aria-label', t('Закрити', 'Close'));
  }
  document.addEventListener('beles:languagechange', translate);
  translate();
  document.querySelectorAll('[data-coop-theme]').forEach((button) =>
    button.addEventListener('click', () => {
      if (button.dataset.coopTheme === 'catalog') {
        document.getElementById('brands')?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
        });
        return;
      }
      opener = button;
      theme = button.dataset.coopTheme;
      translate();
      const product = theme === 'product_request';
      document.getElementById('coop-product-fields').hidden = !product;
      form.elements.sku.required = product;
      form.elements.quantity.required = product;
      document.getElementById('coop-status').textContent = '';
      dialog.showModal();
      form.elements.name.focus();
      document.dispatchEvent(
        new CustomEvent('beles:analytics', {
          detail: { type: 'contact', key: 'cooperation_' + theme },
        }),
      );
    }),
  );
  document.getElementById('coop-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => opener?.focus());
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(form)),
      status = document.getElementById('coop-status');
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contact) &&
      !/^\+?[\d\s()\-]{7,25}$/.test(values.contact)
    ) {
      status.textContent = t(
        'Вкажіть правильний email або телефон.',
        'Enter a valid email or phone number.',
      );
      return;
    }
    busy = true;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    status.textContent = t('Надсилаємо…', 'Sending…');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          theme,
          language: document.documentElement.lang,
          page: location.pathname,
          source: 'cooperation',
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(
          response.status === 429
            ? t('Забагато запитів. Спробуйте пізніше.', 'Too many requests. Please try later.')
            : t('Не вдалося надіслати. Спробуйте ще раз.', 'Could not send. Please try again.'),
        );
      form.reset();
      status.textContent = t(
        'Дякуємо! Запит збережено.',
        'Thank you! Your request has been saved.',
      );
      document.dispatchEvent(
        new CustomEvent('beles:analytics', { detail: { type: 'feedback', key: theme } }),
      );
    } catch (error) {
      status.textContent =
        error.message ||
        t('Не вдалося надіслати. Спробуйте ще раз.', 'Could not send. Please try again.');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };
})();
