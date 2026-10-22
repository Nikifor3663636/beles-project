'use strict';
window.BelesFeedback = {
  filters: {},
  async render(root) {
    let { items } = await api('/api/feedback');
    const selected = new Set();
    const controls = el('div', undefined, 'analytics-controls');
    const status = el('select'),
      theme = el('select'),
      order = el('select');
    status.setAttribute('aria-label', 'Статус звернення');
    theme.setAttribute('aria-label', 'Тема звернення');
    order.setAttribute('aria-label', 'Сортування звернень');
    for (const [value, label] of [
      ['', 'Усі статуси'],
      ['new', 'Нові'],
      ['done', 'Опрацьовані'],
    ])
      status.add(new Option(label, value));
    const themes = {
      feedback: 'Загальні',
      cooperation: 'Співпраця',
      assortment: 'Асортимент',
      first_order: 'Перше замовлення',
      delivery: 'Доставка',
      product_request: 'Запит товару',
      availability: 'Наявність',
    };
    theme.add(new Option('Усі теми', ''));
    for (const [value, label] of Object.entries(themes)) theme.add(new Option(label, value));
    for (const [value, label] of [
      ['newest', 'Спочатку новіші'],
      ['oldest', 'Спочатку старіші'],
      ['name', 'За ім’ям'],
      ['unread', 'Спочатку неопрацьовані'],
    ])
      order.add(new Option(label, value));
    const from = el('input'),
      to = el('input');
    from.type = to.type = 'date';
    from.setAttribute('aria-label', 'З дати UTC');
    to.setAttribute('aria-label', 'До дати UTC');
    const exportButton = el('button', 'Експорт вибірки CSV');
    const reset = el('button', 'Скинути фільтри');
    const choosePage = el('button', 'Вибрати сторінку');
    const removeSelected = el('button', 'Видалити вибрані');
    const source = el('select');
    source.setAttribute('aria-label', 'Джерело звернення');
    source.add(new Option('Усі джерела', ''));
    for (const value of [...new Set(items.map((item) => item.source).filter(Boolean))])
      source.add(new Option(value === 'contact-form' ? 'Контактна форма' : value, value));
    const refresh = el('button', 'Оновити');
    refresh.onclick = () => show().catch((error) => note(error.message));
    const list = el('div', undefined, 'feedback-inbox');
    const pager = el('div', undefined, 'analytics-controls');
    let page = 0,
      filtered = [];
    const fields = { status, theme, order, from, to, source };
    for (const [key, input] of Object.entries(fields))
      if (this.filters[key] !== undefined) input.value = this.filters[key];
    controls.append(
      status,
      theme,
      source,
      order,
      from,
      to,
      reset,
      refresh,
      exportButton,
      choosePage,
      removeSelected,
    );
    root.append(controls, list, pager);
    const state = this.filters;
    async function remove(ids) {
      if (
        !ids.length ||
        !confirm(
          `Видалити звернення (${ids.length}) назавжди? Це не видаляє листи з поштової скриньки.`,
        )
      )
        return;
      removeSelected.disabled = true;
      try {
        await api('/api/feedback', 'DELETE', { ids });
        items = items.filter((item) => !ids.includes(item.id));
        ids.forEach((id) => selected.delete(id));
        note('Звернення видалено');
        draw();
      } catch (error) {
        note(error.message);
        draw();
      }
    }
    reset.onclick = () => {
      for (const input of [status, theme, source, from, to]) input.value = '';
      order.value = 'newest';
      $('search').value = '';
      page = 0;
      selected.clear();
      draw();
    };
    choosePage.onclick = () => {
      const visible = filtered.slice(page * 25, page * 25 + 25);
      const all = visible.every((item) => selected.has(item.id));
      for (const item of visible) {
        if (all) selected.delete(item.id);
        else if (selected.size < 100) selected.add(item.id);
      }
      draw();
    };
    removeSelected.onclick = () => remove([...selected]);
    function draw() {
      for (const [key, input] of Object.entries(fields)) state[key] = input.value;
      const query = $('search').value.trim().toLocaleLowerCase();
      filtered = items.filter(
        (m) =>
          (!status.value || m.status === status.value) &&
          (!theme.value || m.theme === theme.value) &&
          (!source.value || m.source === source.value) &&
          (!from.value || m.createdAt.slice(0, 10) >= from.value) &&
          (!to.value || m.createdAt.slice(0, 10) <= to.value) &&
          [m.name, m.contact, m.message, m.sku, m.source]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query),
      );
      filtered.sort((a, b) =>
        order.value === 'name'
          ? a.name.localeCompare(b.name, 'uk')
          : order.value === 'oldest'
            ? a.createdAt.localeCompare(b.createdAt)
            : order.value === 'unread' && a.status !== b.status
              ? a.status === 'new'
                ? -1
                : 1
              : b.createdAt.localeCompare(a.createdAt),
      );
      page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
      for (const id of selected) if (!filtered.some((item) => item.id === id)) selected.delete(id);
      removeSelected.textContent = `Видалити вибрані (${selected.size})`;
      removeSelected.disabled = !hasPermission('feedback.write') || !selected.size;
      choosePage.disabled = !hasPermission('feedback.write') || !filtered.length;
      $('count').textContent =
        `${filtered.length} із ${items.length} звернень · нових ${items.filter((m) => m.status === 'new').length}`;
      list.replaceChildren();
      pager.replaceChildren();
      if (!filtered.length) list.append(el('p', 'Немає звернень за цими фільтрами.', 'helper'));
      for (const m of filtered.slice(page * 25, page * 25 + 25)) {
        const card = el('article', undefined, 'message' + (m.status === 'done' ? ' done' : ''));
        const selection = el('label', 'Вибрати звернення');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = selected.has(m.id);
        check.disabled = !hasPermission('feedback.write');
        check.onchange = () => {
          if (check.checked && selected.size >= 100) {
            check.checked = false;
            note('Максимум 100 звернень за раз');
            return;
          }
          if (check.checked) selected.add(m.id);
          else selected.delete(m.id);
          removeSelected.disabled = !selected.size;
          removeSelected.textContent = `Видалити вибрані (${selected.size})`;
        };
        selection.prepend(check);
        card.append(selection);
        card.append(
          el('span', m.status === 'done' ? 'Опрацьовано' : 'Нове', 'message-status'),
          el('h3', m.name),
          el('p', new Date(m.createdAt).toLocaleString('uk-UA') + ' · ' + m.contact),
          el(
            'p',
            [themes[m.theme] || m.theme, m.shopFormat, m.sku, m.quantity]
              .filter(Boolean)
              .join(' · '),
          ),
          el('p', m.message, 'message-text'),
          el('p', [m.source, m.page].filter(Boolean).join(' · '), 'sub'),
        );
        const button = el('button', m.status === 'done' ? 'Позначити новим' : 'Опрацьовано');
        button.disabled = !hasPermission('feedback.write');
        button.onclick = async () => {
          button.disabled = true;
          try {
            const next = m.status === 'done' ? 'new' : 'done';
            await api('/api/feedback', 'PATCH', { id: m.id, status: next });
            m.status = next;
            draw();
          } catch (error) {
            note(error.message);
            button.disabled = false;
          }
        };
        const removeButton = el('button', 'Видалити');
        removeButton.disabled = !hasPermission('feedback.write');
        removeButton.onclick = () => remove([m.id]);
        card.append(button, removeButton);
        list.append(card);
      }
      const previous = el('button', '← Назад'),
        next = el('button', 'Далі →');
      previous.disabled = page === 0;
      next.disabled = (page + 1) * 25 >= filtered.length;
      previous.onclick = () => {
        page--;
        draw();
      };
      next.onclick = () => {
        page++;
        draw();
      };
      pager.append(
        previous,
        el('span', `Сторінка ${page + 1} / ${Math.max(1, Math.ceil(filtered.length / 25))}`),
        next,
      );
    }
    for (const input of [status, theme, order, from, to, source])
      input.onchange = () => {
        selected.clear();
        page = 0;
        draw();
      };
    exportButton.onclick = () => {
      const escape = (value) =>
        '"' +
        String(value ?? '')
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const rows = [
        ['Дата UTC', 'Ім’я', 'Контакт', 'Тема', 'Повідомлення', 'Статус', 'Джерело'],
        ...filtered.map((m) => [
          m.createdAt,
          m.name,
          m.contact,
          themes[m.theme] || m.theme,
          m.message,
          m.status,
          m.source,
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(['\ufeff' + rows.map((row) => row.map(escape).join(';')).join('\r\n')], {
          type: 'text/csv;charset=utf-8',
        }),
      );
      const link = el('a');
      link.href = url;
      link.download = 'beles-messages.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    draw();
  },
};
