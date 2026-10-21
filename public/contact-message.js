'use strict';

// Capture submit before the legacy template's mailto listener. Published designs
// live in the persistent store, so this also upgrades them without replacing HTML.
(() => {
  const form = document.getElementById('contact-message-form');
  if (!form) return;
  const recipient = 'tzubchenko@beles.com.ua';
  const email = form.elements.namedItem('email');
  const message = form.elements.namedItem('message');
  const status = form.querySelector('[role="status"]');
  const button = form.querySelector('[type="submit"]');
  if (!email || !message || !status || !button) return;

  status.textContent = 'Ваше повідомлення буде передано команді Beles Brands.';
  let pending = false;
  form.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending) return;
      message.setCustomValidity(message.value.trim() ? '' : 'Будь ласка, введіть повідомлення.');
      if (!form.reportValidity()) return;
      const replyTo = email.value.trim();
      const text = message.value.trim();
      pending = true;
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      status.textContent = 'Надсилаємо повідомлення…';
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            name: replyTo.slice(0, 100),
            contact: replyTo,
            message: text,
            source: 'contact-message-form',
            page: window.location.pathname,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) throw Error('Rejected');
        form.reset();
        status.textContent = 'Повідомлення збережено та передано команді Beles Brands. Дякуємо!';
      } catch {
        status.textContent =
          'Не вдалося підтвердити надсилання. Текст збережено у формі. Спробуйте ще раз або напишіть на ' +
          recipient +
          '.';
      } finally {
        pending = false;
        button.disabled = false;
        form.removeAttribute('aria-busy');
      }
    },
    true,
  );
})();
