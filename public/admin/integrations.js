'use strict';
(() => {
  const dialog = el('dialog');
  dialog.className = 'import-dialog';
  const form = el('form'),
    head = el('div', undefined, 'dialogHead'),
    title = el('h2', 'Імпорт товару за посиланням'),
    close = el('button', 'Закрити');
  close.type = 'button';
  close.onclick = () => dialog.close();
  head.append(title, close);
  const body = el('div', undefined, 'accountBody'),
    label = el('label', 'Посилання на сторінку товару'),
    url = el('input');
  url.type = 'url';
  url.required = true;
  url.placeholder = 'https://example.com/product';
  label.append(url);
  const help = el(
    'p',
    'Імпортуємо доступні назву, фото, опис, бренд, артикул і характеристики. Сторінки з авторизацією або захистом можуть бути недоступні. Ручне додавання залишається.',
    'helper',
  );
  const backup = el('details'),
    backupTitle = el('summary', 'Чудо Острів / сайт блокує імпорт?'),
    backupHelp = el(
      'p',
      'Відкрийте товар у своєму браузері, дочекайтеся появи опису та фото. Натисніть Ctrl+S → «Вебсторінка, лише HTML» (або повністю). Вкажіть оригінальне посилання вище та виберіть збережений .html — поля заповняться автоматично.',
      'helper',
    ),
    fileLabel = el('label', 'Збережена сторінка товару (.html)'),
    file = el('input');
  file.type = 'file';
  file.accept = '.html,.htm,text/html';
  fileLabel.append(file);
  backup.append(backupTitle, backupHelp, fileLabel);
  const status = el('p');
  status.setAttribute('role', 'status');
  const submit = el('button', 'Завантажити дані', 'primary');
  body.append(label, help, backup, status, submit);
  form.append(head, body);
  dialog.append(form);
  document.body.append(dialog);
  $('importProduct').onclick = () => {
    status.textContent = '';
    file.value = '';
    dialog.showModal();
    url.focus();
  };
  url.addEventListener('input', () => {
    file.value = '';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    url.disabled = true;
    status.textContent = 'Завантажуємо сторінку…';
    try {
      const payload = { url: url.value };
      if (file.files[0]) {
        if (file.files[0].size > 3 * 1024 * 1024) throw Error('HTML-файл має бути не більше 3 МБ.');
        payload.html = await file.files[0].text();
      }
      const result = await api('/api/import-product', 'POST', payload);
      const draft = result.draft;
      const matched = rows.find(
        (r) =>
          r.kind === 'brand' && r.name.toLowerCase() === String(draft.brand || '').toLowerCase(),
      );
      const importedBrand = draft.brand;
      if (matched) draft.brand = matched.name;
      else draft.brand = '';
      if (importedBrand && !matched)
        result.warnings.push(
          'Бренд джерела: ' +
            importedBrand +
            '. Оберіть наявний бренд або спочатку створіть його в розділі «Бренди».',
        );
      kind = 'product';
      dialog.close();
      edit(null, draft);
      const info = el('section', undefined, 'import-summary');
      info.append(el('h3', 'Дані завантажено · ' + result.format));
      for (const warning of result.warnings) info.append(el('p', warning));
      $('fields').prepend(info);
    } catch (error) {
      status.textContent = error.message;
      backup.open = true;
    } finally {
      submit.disabled = false;
      url.disabled = false;
    }
  };

  window.BelesIntegrations = {
    async render(root) {
      const panel = el('section', undefined, 'analytics-panel integration-panel');
      panel.append(
        el('h2', 'Google Analytics 4'),
        el(
          'p',
          'Відвідування, джерела трафіку, пристрої, перегляди товарів і події. Повні звіти відкриваються у вашому акаунті Google Analytics.',
          'helper',
        ),
      );
      const form = el('form', undefined, 'integration-form'),
        label = el('label', 'Measurement ID'),
        input = el('input');
      input.placeholder = 'G-XXXXXXXXXX';
      input.pattern = 'G-[A-Za-z0-9]{4,20}';
      input.maxLength = 22;
      label.append(input);
      const save = el('button', 'Зберегти підключення', 'primary'),
        link = el('a', 'Відкрити Google Analytics ↗');
      link.href = 'https://analytics.google.com/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const status = el('p');
      status.setAttribute('role', 'status');
      const guide = el(
        'p',
        'Відкрийте analytics.google.com → Адміністратор → Потоки даних → Веб. Скопіюйте Measurement ID виду G-XXXXXXXXXX. Якщо потоку немає, створіть його для адреси цього сайту. Порожнє поле вимикає Google Analytics.',
        'helper',
      );
      const help = el('a', 'Як знайти Measurement ID ↗');
      help.href = 'https://support.google.com/analytics/answer/12270356';
      help.target = '_blank';
      help.rel = 'noopener noreferrer';
      form.append(label, save, link);
      panel.append(
        form,
        status,
        guide,
        help,
        el(
          'p',
          'Microsoft Clarity вимкнено. Google починає збір після збереження ID та окремої згоди відвідувача. Візити авторизованих адміністраторів виключені. Дані до підключення GA4 не переносяться. Вбудовані звіти нижче працюють окремо.',
          'helper',
        ),
      );
      root.append(panel);
      function state(id) {
        status.textContent = id
          ? 'Налаштовано: ' +
            id +
            '. Перевірте події у Google Analytics → Звіти → У реальному часі. Збереження ID саме по собі не підтверджує надходження даних.'
          : 'Ще не підключено: потрібен Measurement ID вашого потоку GA4.';
      }
      try {
        const config = await api('/api/integrations');
        input.value = config.gaMeasurementId || '';
        state(input.value);
      } catch (error) {
        status.textContent = error.message;
      }
      form.onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          const config = await api('/api/integrations', 'POST', {
            gaMeasurementId: input.value.trim(),
          });
          input.value = config.gaMeasurementId;
          state(config.gaMeasurementId);
        } catch (error) {
          status.textContent = error.message;
        } finally {
          save.disabled = false;
        }
      };
    },
  };
})();
