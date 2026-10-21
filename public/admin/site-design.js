(() => {
  'use strict';
  let unsaved = false;
  let dispose = () => {};
  document.addEventListener(
    'click',
    (event) => {
      if (!event.target.closest('#nav button,.statCard')) return;
      if (unsaved && !confirm('Відкинути незбережені зміни цього блоку?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      unsaved = false;
      dispose();
    },
    true,
  );
  addEventListener('beforeunload', (event) => {
    if (unsaved) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.BelesSiteDesign = {
    async render(root) {
      dispose();
      let data = await api('/api/site-design');
      let part = data.parts.find((p) => p.id.startsWith('header-'))?.id || 'html';
      let timer,
        version = 0,
        active = true,
        publishing = false,
        previewPending = false;
      const box = el('section', undefined, 'design-studio'),
        top = el('div', undefined, 'studio-top');
      const title = el('div');
      title.append(
        el('h2', 'Редактор сайту'),
        el(
          'p',
          'Натисніть елемент у перегляді → змініть властивості → перевірте результат',
          'helper',
        ),
      );
      const publish = el('button', 'Опублікувати блок', 'primary');
      top.append(title, publish);
      const layout = el('div', undefined, 'studio-layout'),
        sidebar = el('aside', undefined, 'studio-blocks');
      const search = el('input');
      search.type = 'search';
      search.placeholder = 'Знайти блок…';
      search.setAttribute('aria-label', 'Пошук блоку');
      const list = el('div', undefined, 'studio-block-list');
      sidebar.append(el('h3', 'Блоки сайту'), search, list);
      const editor = el('section', undefined, 'studio-editor'),
        heading = el('h3'),
        state = el('span', 'Опубліковано', 'studio-state');
      const editorHead = el('div', undefined, 'studio-panel-head');
      editorHead.append(heading, state);
      const mode = el('select');
      mode.setAttribute('aria-label', 'Режим редактора');
      mode.add(new Option('Без коду · властивості', 'visual'));
      mode.add(new Option('Код елемента / блоку', 'code'));
      const properties = el('div', undefined, 'element-properties');
      let elementChanges = {};
      const colors = el('div', undefined, 'design-colors'),
        codeBox = el('div', undefined, 'studio-code');
      const lines = el('pre', '1', 'studio-lines');
      lines.setAttribute('aria-hidden', 'true');
      const code = el('textarea');
      code.className = 'design-code';
      code.spellcheck = false;
      code.wrap = 'off';
      code.setAttribute('aria-label', 'Код вибраного блоку');
      codeBox.append(lines, code);
      const tools = el('div', undefined, 'studio-tools');
      const original = el('a', '↓ Оригінал'),
        current = el('a', '↓ Опублікований код'),
        reset = el('button', 'Відновити оригінал');
      tools.append(original, current, reset);
      const hint = el(
        'p',
        'Властивості змінюють вибраний елемент без коду. Динамічні товари, бренди та переклади керуються також у розділах каталогу й текстів. Код доступний окремим режимом.',
        'helper',
      );
      editor.append(editorHead, mode, properties, colors, codeBox, tools, hint);
      const previewPanel = el('section', undefined, 'studio-result'),
        previewHead = el('div', undefined, 'studio-panel-head');
      const autoLabel = el('label', 'Автоперегляд'),
        auto = el('input');
      auto.type = 'checkbox';
      auto.checked = true;
      autoLabel.prepend(auto);
      const refresh = el('button', 'Оновити'),
        viewport = el('select');
      viewport.setAttribute('aria-label', 'Ширина перегляду');
      for (const [value, label] of [
        ['100%', 'За шириною панелі'],
        ['390px', 'Телефон · 390 px'],
        ['768px', 'Планшет · 768 px'],
        ['1440px', 'Комп’ютер · 1440 px'],
      ])
        viewport.add(new Option(label, value));
      previewHead.append(el('h3', 'Результат'), autoLabel, viewport, refresh);
      const status = el('p', 'Готуємо перегляд…', 'studio-preview-status');
      status.setAttribute('role', 'status');
      const stage = el('div', undefined, 'studio-preview-stage'),
        frame = el('iframe');
      frame.title = 'Живий перегляд сайту — натисніть блок, щоб редагувати';
      frame.className = 'design-preview';
      frame.sandbox = 'allow-scripts';
      stage.append(frame);
      previewPanel.append(
        previewHead,
        status,
        stage,
        el(
          'p',
          'Натисніть заголовок, кнопку, зображення чи інший елемент. Це чернетка: відвідувачі бачать лише опубліковану версію.',
          'helper',
        ),
      );
      layout.append(sidebar, editor, previewPanel);
      const safety = el('details', undefined, 'studio-safety');
      safety.append(el('summary', 'Історія та відновлення'));
      const undo = el('button', 'Скасувати останню публікацію'),
        restoreAll = el('button', 'Відновити весь початковий дизайн');
      safety.append(
        el('p', 'Відновлення дизайну не змінює товари, акаунти або звернення.', 'helper'),
        undo,
        restoreAll,
      );
      box.append(top, layout, safety);
      root.append(box);
      const nodeObserver = new MutationObserver(() => {
        if (!box.isConnected) dispose();
      });
      nodeObserver.observe(root, { childList: true });
      dispose = () => {
        active = false;
        version++;
        clearTimeout(timer);
        removeEventListener('message', receive);
        nodeObserver.disconnect();
      };

      function updateLines() {
        lines.textContent = Array.from(
          { length: code.value.split('\n').length },
          (_, i) => i + 1,
        ).join('\n');
      }
      code.onscroll = () => {
        lines.scrollTop = code.scrollTop;
      };
      code.onkeydown = (event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
          changed();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          publish.click();
        }
      };
      function renderList() {
        list.replaceChildren();
        for (const entry of data.parts.filter((p) =>
          p.label.toLowerCase().includes(search.value.toLowerCase()),
        )) {
          const button = el('button', entry.label);
          button.classList.toggle('active', entry.id === part);
          button.setAttribute('aria-pressed', String(entry.id === part));
          button.onclick = () => selectPart(entry.id);
          list.append(button);
        }
      }
      search.oninput = renderList;
      function propertyFields() {
        properties.replaceChildren();
        const selected = data.elements?.find((element) => element.id === part);
        mode.hidden = !selected;
        properties.hidden = !selected || mode.value !== 'visual';
        codeBox.hidden = part === 'colors' || (!!selected && mode.value === 'visual');
        if (!selected) return;
        for (const [key, title] of Object.entries({
          text: 'Текст українською / основний',
          textEN: 'Текст англійською (інші мови — цей текст або основний)',
          href: 'Посилання кнопки / посилання',
          src: 'Адреса зображення',
          alt: 'Опис зображення',
          title: 'Підказка',
          color: 'Колір тексту · #RRGGBB',
          background: 'Колір фону · #RRGGBB',
          fontSize: 'Розмір шрифту · наприклад 24px',
          padding: 'Внутрішній відступ · наприклад 16px',
          borderRadius: 'Заокруглення · наприклад 12px',
          hidden: 'Приховати елемент',
        })) {
          const value = selected.fields[key];
          if (value === null || value === undefined) continue;
          const label = el('label', title),
            input = el(key === 'text' || key === 'textEN' ? 'textarea' : 'input');
          input.dataset.property = key;
          input.disabled = !hasPermission('design.write');
          if (key === 'hidden') {
            input.type = 'checkbox';
            input.checked = elementChanges[key] ?? value;
          } else {
            input.value = elementChanges[key] ?? value;
            if (['color', 'background'].includes(key)) input.placeholder = '#ed008c';
          }
          input.oninput = () => {
            elementChanges[key] = key === 'hidden' ? input.checked : input.value;
            changed();
          };
          label.append(input);
          properties.append(label);
        }
        if (selected.fields.text === null)
          properties.prepend(
            el(
              'p',
              'Цей контейнер має вкладені елементи. Для тексту натисніть безпосередньо на його заголовок або абзац.',
              'helper',
            ),
          );
      }
      mode.onchange = () => {
        if (unsaved) {
          mode.value = mode.value === 'visual' ? 'code' : 'visual';
          note('Спочатку опублікуйте або відновіть чернетку, потім змініть режим.');
          return;
        }
        propertyFields();
      };
      function fill() {
        unsaved = false;
        version++;
        clearTimeout(timer);
        heading.textContent = data.parts.find((p) => p.id === part)?.label || part;
        state.textContent = 'Опубліковано';
        state.classList.remove('is-dirty');
        code.value = data.values[part] || '';
        code.scrollTop = 0;
        lines.scrollTop = 0;
        updateLines();
        codeBox.hidden = part === 'colors';
        elementChanges = {};
        propertyFields();
        colors.hidden = part !== 'colors';
        colors.replaceChildren();
        if (part === 'colors') {
          for (const [key, label] of Object.entries({
            background: 'Фон сторінки',
            text: 'Основний текст',
            accent: 'Кнопки / акцент',
            hero: 'Головний блок',
          })) {
            const wrapper = el('label', label),
              input = el('input');
            input.type = 'color';
            input.dataset.color = key;
            input.value = JSON.parse(code.value)[key];
            input.oninput = changed;
            wrapper.append(input);
            colors.append(wrapper);
          }
        }
        original.href = '/api/site-design/download?original=1&part=' + encodeURIComponent(part);
        original.hidden = !(part in data.originals);
        current.href = '/api/site-design/download?part=' + encodeURIComponent(part);
        reset.disabled = !(part in data.originals);
        undo.disabled = !data.canUndo;
        renderList();
        schedule();
      }
      function selectPart(id) {
        if (id === part || !data.parts.some((p) => p.id === id)) return;
        if (unsaved && !confirm('Відкинути незбережені зміни та перейти до іншого блоку?')) return;
        part = id;
        fill();
      }
      function payload() {
        if ((part.startsWith('element-') || part.startsWith('live-')) && mode.value === 'visual')
          return {
            revision: data.revision,
            part,
            element: elementChanges,
            runtime: data.elements?.find((element) => element.id === part)?.runtime,
          };
        return {
          revision: data.revision,
          part,
          runtime: data.elements?.find((element) => element.id === part)?.runtime,
          value:
            part === 'colors'
              ? JSON.stringify(
                  Object.fromEntries(
                    [...colors.querySelectorAll('input')].map((i) => [i.dataset.color, i.value]),
                  ),
                )
              : code.value,
        };
      }
      function changed() {
        unsaved = true;
        version++;
        state.textContent = 'Чернетка';
        state.classList.add('is-dirty');
        updateLines();
        status.textContent = auto.checked
          ? 'Зміни з’являться за мить…'
          : 'Автоперегляд вимкнено. Натисніть «Оновити».';
        schedule();
      }
      code.oninput = changed;
      function schedule() {
        clearTimeout(timer);
        if (auto.checked && active) timer = setTimeout(updatePreview, 650);
      }
      async function updatePreview() {
        if (!active || publishing) return;
        if (previewPending) {
          schedule();
          return;
        }
        const requested = version;
        previewPending = true;
        status.textContent = 'Оновлюємо перегляд…';
        try {
          const result = await api('/api/site-design/preview', 'POST', payload());
          if (!active || requested !== version) return;
          frame.src = result.url;
          status.textContent = 'Завантажуємо результат…';
        } catch (error) {
          if (active && requested === version)
            status.textContent = 'Перегляд не оновлено: ' + error.message;
        } finally {
          previewPending = false;
          if (active && requested !== version) schedule();
        }
      }
      async function receive(event) {
        if (!active || event.source !== frame.contentWindow) return;
        if (event.data?.type === 'beles:select-runtime') {
          const runtime = event.data.runtime;
          const hash = [
            ...new Uint8Array(
              await crypto.subtle.digest('SHA-256', new TextEncoder().encode(runtime.selector)),
            ),
          ]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 20);
          const id = 'live-' + hash;
          if (!active) return;
          if (!data.parts.some((entry) => entry.id === id)) {
            data.parts.push({ id, label: 'На сторінці · ' + runtime.label });
            data.elements.push({ id, fields: runtime.defaults, runtime });
            data.values[id] = '{}';
          }
          mode.value = 'visual';
          selectPart(id);
          return;
        }
        if (event.data?.type === 'beles:select-block') selectPart(event.data.id);
        if (event.data?.type === 'beles:preview-ready')
          status.textContent = 'Живий перегляд · форми та аналітика вимкнені';
      }
      addEventListener('message', receive);
      auto.onchange = () => {
        if (auto.checked) schedule();
        else clearTimeout(timer);
      };
      refresh.onclick = () => {
        clearTimeout(timer);
        updatePreview();
      };
      viewport.onchange = () => {
        frame.style.width = viewport.value;
      };
      async function save(change) {
        publishing = true;
        version++;
        clearTimeout(timer);
        publish.disabled = undo.disabled = restoreAll.disabled = true;
        try {
          data = await api('/api/site-design', 'POST', change);
          if (!active) return;
          if (!(part in data.values)) part = 'html';
          fill();
          status.textContent = 'Опубліковано. Попередня версія збережена.';
        } catch (error) {
          if (active) status.textContent = error.message;
        } finally {
          publishing = false;
          publish.disabled = restoreAll.disabled = false;
          undo.disabled = !data.canUndo;
          if (active) schedule();
        }
      }
      publish.onclick = () => {
        if (confirm('Опублікувати цей блок для відвідувачів сайту?')) save(payload());
      };
      reset.onclick = () => {
        if (!confirm('Повернути вихідний код цього блоку в чернетку?')) return;
        if (part.startsWith('element-') || part.startsWith('live-')) {
          mode.value = 'code';
          elementChanges = {};
          propertyFields();
        }
        code.value = data.originals[part];
        if (part === 'colors') {
          const values = JSON.parse(code.value);
          colors.querySelectorAll('input').forEach((i) => (i.value = values[i.dataset.color]));
        }
        changed();
      };
      undo.onclick = () => {
        if (confirm('Скасувати останню публікацію дизайну?'))
          save({ revision: data.revision, undo: true });
      };
      restoreAll.onclick = () => {
        if (confirm('Відновити весь початковий дизайн?'))
          save({ revision: data.revision, restoreAll: true });
      };
      const versions = el('select');
      versions.setAttribute('aria-label', 'Версія дизайну');
      versions.add(new Option('Історія публікацій', ''));
      for (const version of data.history || [])
        versions.add(new Option(new Date(version.at).toLocaleString('uk-UA'), version.id));
      const rollback = el('button', 'Відновити версію');
      rollback.type = 'button';
      rollback.onclick = () => {
        if (versions.value && confirm('Опублікувати вибрану версію?'))
          save({ revision: data.revision, version: versions.value });
      };
      root.append(versions, rollback);
      for (const button of [publish, reset, undo, restoreAll, rollback])
        button.hidden = !hasPermission('design.write');
      code.readOnly = !hasPermission('design.write');
      fill();
    },
  };
})();
