(() => {
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const number = (value) => Number(value || 0).toLocaleString('uk-UA');
  const dateBefore = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  let timer,
    request = 0;
  function stop() {
    clearInterval(timer);
    request++;
  }
  async function render(root) {
    stop();
    root.replaceChildren();
    if (hasPermission('analytics.write')) window.BelesIntegrations?.render(root);
    const controls = el('div', undefined, 'analytics-controls');
    const period = el('select');
    period.setAttribute('aria-label', 'Період');
    for (const [n, text] of [
      [1, 'Сьогодні'],
      [7, '7 днів'],
      [30, '30 днів'],
      [90, '90 днів'],
      ['custom', 'Власний період'],
    ])
      period.add(new Option(text, n));
    period.value = '7';
    const from = el('input'),
      to = el('input');
    from.type = to.type = 'date';
    from.value = dateBefore(6);
    to.value = today();
    from.setAttribute('aria-label', 'Початок періоду UTC');
    to.setAttribute('aria-label', 'Кінець періоду UTC');
    const refresh = el('button', 'Оновити'),
      download = el('button', 'Експорт CSV');
    controls.append(period, from, to, refresh, download);
    const status = el('p', 'Завантажуємо аналітику…', 'helper');
    status.setAttribute('role', 'status');
    const content = el('div', undefined, 'analytics-content');
    root.append(controls, status, content);
    let current;
    function card(title, value, hint) {
      const box = el('article', undefined, 'metric');
      box.append(el('span', title), el('strong', value), el('small', hint));
      return box;
    }
    const delta = (value, previous) =>
      previous
        ? `${Math.round((value / previous - 1) * 100) >= 0 ? '+' : ''}${Math.round((value / previous - 1) * 100)}% до попереднього періоду`
        : 'Немає бази для порівняння';
    function ranking(title, values, limit = 12) {
      const box = el('section', undefined, 'analytics-panel');
      box.append(el('h2', title));
      const list = Array.isArray(values)
        ? values
        : Object.entries(values)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
      if (!list.length) {
        box.append(el('p', 'Ще немає даних', 'helper'));
        return box;
      }
      const table = el('table'),
        head = el('tr');
      head.append(el('th', 'Назва'), el('th', 'Кількість'));
      table.append(head);
      for (const item of list.slice(0, limit)) {
        const row = el('tr'),
          name = el('td');
        name.append(el('div', item.name));
        if (item.brand) name.append(el('small', item.brand, 'helper'));
        const progress = el('progress');
        progress.max = list[0].count || 1;
        progress.value = item.count;
        progress.setAttribute('aria-label', item.name + ': ' + item.count);
        name.append(progress);
        row.append(name, el('td', number(item.count)));
        table.append(row);
      }
      box.append(table);
      if (list.length > limit)
        box.append(el('p', `Показано ${limit} з ${list.length}. Повний список — в CSV.`, 'helper'));
      return box;
    }
    function chart(data) {
      return window.BelesAnalyticsChart.render(data);
    }
    function visitors(data) {
      const box = el('section', undefined, 'analytics-panel');
      box.append(
        el('h2', 'IP та останні відвідування'),
        el(
          'p',
          'До 7 днів, останні 1000 візитів вибраного періоду. Адреса може належати VPN або спільній мережі.',
          'helper',
        ),
      );
      const search = el('input');
      search.type = 'search';
      search.placeholder = 'Знайти IP або пристрій…';
      search.setAttribute('aria-label', 'Пошук IP');
      const online = el('select');
      online.add(new Option('Усі відвідування', ''));
      online.add(new Option('Зараз онлайн', 'online'));
      online.setAttribute('aria-label', 'Активність відвідувача');
      const table = el('table'),
        container = el('div', undefined, 'table-scroll');
      container.append(table);
      box.append(search, online, container);
      function draw() {
        table.replaceChildren();
        const head = el('tr');
        ['IP', 'Джерело адреси', 'Пристрій / браузер', 'Востаннє', 'Перегляди', 'Статус'].forEach(
          (title) => head.append(el('th', title)),
        );
        table.append(head);
        const items = (data.recentVisitors || []).filter(
          (item) =>
            (!online.value || item.online) &&
            [item.ip, item.device, item.browser]
              .join(' ')
              .toLowerCase()
              .includes(search.value.toLowerCase()),
        );
        for (const item of items.slice(0, 100)) {
          const tr = el('tr');
          [
            item.ip,
            item.source === 'proxy' ? 'HTTP-проксі' : 'З’єднання',
            `${item.device} · ${item.browser}`,
            new Date(item.lastSeen).toLocaleString('uk-UA'),
            String(item.views),
            item.online ? 'Онлайн' : 'Завершено',
          ].forEach((value) => tr.append(el('td', value)));
          table.append(tr);
        }
        if (!items.length) {
          const tr = el('tr'),
            td = el('td', 'Ще немає відвідувань за цими умовами');
          td.colSpan = 6;
          tr.append(td);
          table.append(tr);
        }
      }
      search.oninput = online.onchange = draw;
      draw();
      return box;
    }
    async function update() {
      const ticket = ++request;
      refresh.disabled = true;
      try {
        const response = await fetch(
          '/api/analytics?' + new URLSearchParams({ from: from.value, to: to.value }),
        );
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'Помилка аналітики');
        if (ticket !== request) return;
        current = data;
        status.textContent =
          `Оновлено ${new Date(data.updatedAt).toLocaleTimeString('uk-UA')}. Автооновлення кожні 30 с. Збір з ${new Date(data.startedAt).toLocaleDateString('uk-UA')}.` +
          (data.capped ? ' Досягнуто денний ліміт збору: дані неповні.' : '') +
          (data.storageError ? ' ' + data.storageError : '');
        content.replaceChildren();
        const metrics = el('div', undefined, 'analytics-metrics');
        metrics.append(
          card('Зараз онлайн', number(data.online), 'Активні браузери за останні 90 с'),
          card(
            'Унікальні відвідувачі',
            number(data.visitors),
            'Анонімні браузери · ' + delta(data.visitors, data.previous.visitors),
          ),
          card('Візити', number(data.visits), delta(data.visits, data.previous.visits)),
          card('Перегляди сторінки', number(data.views), delta(data.views, data.previous.views)),
          card(
            'Середній активний час',
            `${Math.floor(data.avgSeconds / 60)} хв ${data.avgSeconds % 60} с`,
            'Час видимої вкладки, приблизно',
          ),
          card(
            'Залучені візити',
            data.engagementRate + '%',
            '≥10 с, взаємодія або кілька переглядів',
          ),
          card('Середня глибина', data.avgScroll + '%', 'Найбільша прокрутка в кожному візиті'),
          card(
            'Надіслані звернення',
            number(data.feedback),
            'У відстежених візитах, без тексту повідомлень',
          ),
        );
        content.append(metrics, chart(data.timeline), visitors(data));
        const grid = el('div', undefined, 'analytics-grid');
        grid.append(
          ranking('Популярні бренди · відкриття', data.brands, 20),
          ranking('Популярні товари · відкриття / кліки', data.products, 20),
          ranking('Презентації · відкриття / завантаження', data.pdf),
          ranking('Джерела переходів · візити', data.sources),
          ranking('Пристрої · візити', data.devices),
          ranking('Пристрої онлайн', data.onlineDevices),
          ranking('Браузери · візити', data.browsers),
          ranking('Операційні системи · візити', data.os),
          ranking('Мови · візити', data.languages),
          ranking('Контакти · кліки', data.contacts),
          ranking(
            'Час активності · перегляди UTC',
            data.hours
              .map((count, i) => ({ name: String(i).padStart(2, '0') + ':00', count }))
              .filter((x) => x.count)
              .sort((a, b) => b.count - a.count),
            24,
          ),
        );
        content.append(
          grid,
          el(
            'p',
            'Методика: браузер ≠ конкретна людина. Візит — вкладка з перервою не більше 30 хв. Онлайн та час приблизні; адміни у поточній сесії, відомі боти, Do Not Track і відмова від аналітики не враховуються. Історія — до 90 днів, із обмеженням обсягу. IP зберігаються до 7 днів і доступні лише адміністраторам з правами аналітики. IP може належати VPN або спільній мережі; це не ідентифікація людини. Точна геолокація та текст звернень не збираються.',
            'analytics-method helper',
          ),
        );
      } catch (error) {
        if (ticket === request) status.textContent = error.message;
      } finally {
        if (ticket === request) refresh.disabled = false;
      }
    }
    period.onchange = () => {
      if (period.value !== 'custom') {
        to.value = today();
        from.value = dateBefore(Number(period.value) - 1);
        update();
      }
    };
    from.onchange = to.onchange = () => {
      period.value = 'custom';
    };
    refresh.onclick = update;
    download.onclick = () => {
      if (!current) return;
      const rows = [['Розділ', 'Назва / дата', 'Кількість']];
      for (const day of current.timeline)
        for (const [key, title] of [
          ['views', 'Перегляди'],
          ['visits', 'Візити'],
          ['visitors', 'Унікальні браузери'],
        ])
          rows.push([title, day.date, day[key]]);
      for (const key of [
        'brands',
        'products',
        'pdf',
        'devices',
        'sources',
        'browsers',
        'os',
        'languages',
        'contacts',
      ])
        for (const item of Array.isArray(current[key])
          ? current[key]
          : Object.entries(current[key]).map(([name, count]) => ({ name, count })))
          rows.push([key, item.name, item.count]);
      const escape = (value) =>
        '"' +
        String(value)
          .replace(/^[=+@-]/, "'$&")
          .replace(/"/g, '""') +
        '"';
      const blob = new Blob(
        ['\ufeff' + rows.map((row) => row.map(escape).join(';')).join('\r\n')],
        { type: 'text/csv;charset=utf-8' },
      );
      const url = URL.createObjectURL(blob),
        a = el('a');
      a.href = url;
      a.download = `beles-analytics-${from.value}-${to.value}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    timer = setInterval(() => {
      if (!document.hidden) update();
    }, 30000);
    await update();
  }
  window.BelesAnalytics = { render, stop };
})();
