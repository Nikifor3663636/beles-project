'use strict';
const $ = (id) => document.getElementById(id);
let csrf = '',
  rows = [],
  revision = '',
  kind = 'product',
  current = null,
  configured = true,
  dirty = false;
let listPage = 0,
  lastListFilter = '';
let currentUser = null;
function hasPermission(permission) {
  return currentUser?.role === 'owner' || (currentUser?.permissions || []).includes(permission);
}
function canView(section) {
  return hasPermission(section + '.read');
}
const types = {
  design: 'Дизайн і блоки сайту',
  storage: 'Сховище та журнал',
  product: 'Товари',
  brand: 'Бренди',
  partner: 'Партнери',
  presentation: 'Презентації PDF',
  content: 'Тексти та контакти',
  feedback: 'Звернення',
  analytics: 'Аналітика',
};
const fields = {
  name: 'Назва / ключ тексту',
  itemKey: 'Унікальний Item Key',
  slug: 'Slug',
  brand: 'Бренд',
  sort: 'Порядок',
  published: 'Показувати на сайті',
  nameEN: 'Назва англійською',
  descriptionUA: 'Опис українською',
  descriptionEN: 'Опис англійською',
  image: 'Зображення',
  imageAlt: 'Альтернативний текст зображення',
  categories: 'Категорії (ключі через ;)',
  accent: 'Акцентний колір',
  sku: 'Артикул',
  age: 'Вік',
  material: 'Матеріал',
  dimensions: 'Розміри',
  featuresUA: 'Характеристики UA (назва: значення, кожна з нового рядка)',
  featuresEN: 'Характеристики EN',
  focusUA: 'Напрям UA',
  focusEN: 'Напрям EN',
  assortmentUA: 'Асортимент UA',
  assortmentEN: 'Асортимент EN',
  url: 'Посилання',
  pdfFile: 'PDF-файл',
  textUA: 'Текст UA',
  textEN: 'Текст EN',
  sourceURL: 'Джерело',
  catalogLabel: 'Підпис у каталозі',
  presentationPage: 'Сторінка презентації',
};
const common = ['name', 'itemKey', 'slug', 'sort', 'published'];
const perType = {
  product: [
    'brand',
    'nameEN',
    'descriptionUA',
    'descriptionEN',
    'image',
    'imageAlt',
    'categories',
    'accent',
    'sku',
    'age',
    'material',
    'dimensions',
    'featuresUA',
    'featuresEN',
    'sourceURL',
    'catalogLabel',
    'url',
  ],
  brand: [
    'nameEN',
    'descriptionUA',
    'descriptionEN',
    'image',
    'categories',
    'accent',
    'focusUA',
    'focusEN',
    'assortmentUA',
    'assortmentEN',
    'url',
  ],
  partner: ['nameEN', 'image', 'imageAlt', 'textUA', 'textEN', 'url', 'accent'],
  presentation: ['brand', 'pdfFile', 'presentationPage', 'descriptionUA', 'descriptionEN'],
  content: ['textUA', 'textEN', 'url', 'image'],
};
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function note(t) {
  const translations = {
    'Maximum two administrators': 'Ліміт: лише два адміністратори.',
    'Username already exists': 'Такий логін уже використовується.',
    'Password: 12–1000 characters': 'Пароль: від 12 до 1000 символів.',
    'Username: 3–80 letters, digits, _, ., @ or -': 'Логін: 3–80 літер, цифр або _, ., @, -.',
    'Incorrect login or password': 'Неправильний логін або пароль',
    'Login required': 'Увійдіть до адмінки',
    'Already configured': 'Адміністратора вже створено. Повторна реєстрація закрита.',
    'Invalid setup code': 'Неправильний одноразовий код налаштування',
    'Catalog changed. Reload before saving.':
      'Каталог змінився в іншій вкладці. Оновіть сторінку перед збереженням.',
    'Move or delete linked products and presentations first':
      'Спочатку перенесіть товари та презентації цього бренду до іншого бренду.',
    'Duplicate Item Key': 'Запис із таким ключем уже існує',
    'Minimum 12 characters': 'Пароль має містити щонайменше 12 символів',
    'Incorrect current password': 'Неправильний поточний пароль',
    'Too many attempts. Try again in 15 minutes.': 'Забагато спроб входу. Спробуйте за 15 хвилин.',
  };
  $('notice').textContent = translations[t] || t;
  const activeDialog = document.querySelector('dialog[open]');
  if (activeDialog) {
    let status = activeDialog.querySelector('.dialog-notice');
    if (!status) {
      status = el('p', undefined, 'dialog-notice');
      status.setAttribute('role', 'status');
      activeDialog.prepend(status);
    }
    status.textContent = translations[t] || t;
    status.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  clearTimeout(note.timer);
  note.timer = setTimeout(() => ($('notice').textContent = ''), 6500);
}
async function api(url, method = 'GET', data) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const b = await r.json();
  if (r.ok && b.csrf) csrf = b.csrf;
  if (b.reason === 'reauth_required' && window.BelesSecurity) {
    await window.BelesSecurity.reauthenticate();
    return api(url, method, data);
  }
  if (b.requiresTwoFactor) $('twoFactorLabel').hidden = false;
  if (!r.ok) {
    if (r.status === 401) {
      $('auth').hidden = false;
      $('workspace').hidden = true;
      $('actions').hidden = true;
    }
    throw Error(b.error || 'Помилка запиту');
  }
  return b;
}
async function start() {
  try {
    const s = await api('/api/status');
    configured = s.configured;
    csrf = s.csrf || '';
    $('tokenLabel').hidden = configured;
    $('confirmLabel').hidden = configured;
    $('authTitle').textContent = configured ? 'З поверненням' : 'Створення адміністратора';
    $('setupInfo').textContent = configured
      ? 'Увійдіть, щоб редагувати каталог та отримані звернення.'
      : 'Створіть адміністратора. Код налаштування показано в консолі запуску сервера. Пароль — від 12 символів.';
    $('loginForm').querySelector('button').textContent = configured
      ? 'Увійти'
      : 'Створити адміністратора';
    if (s.authenticated) await load();
  } catch (e) {
    note(e.message);
  }
}
async function load() {
  const identity = await api('/api/status');
  currentUser = identity.user;
  document.querySelectorAll('#nav [data-kind]').forEach((button) => {
    button.hidden = !canView(button.dataset.kind);
  });
  document.querySelector('a[href="/api/backup"]').hidden = !hasPermission('backup.export');
  if (!canView(kind)) kind = Object.keys(types).find(canView) || '';
  const c = await api('/api/catalog');
  rows = c.rows;
  revision = c.revision;
  $('auth').hidden = true;
  $('workspace').hidden = false;
  $('actions').hidden = false;
  const filter = $('brandFilter');
  const previous = filter.value;
  filter.replaceChildren(new Option('Усі бренди', ''));
  for (const b of rows
    .filter((r) => r.kind === 'brand')
    .sort((a, b) => a.name.localeCompare(b.name)))
    filter.add(new Option(b.name, b.name));
  filter.value = previous;
  await show();
  renderStats();
}
$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (!configured && f.password !== f.confirmPassword) {
    note('Паролі не збігаються');
    return;
  }
  try {
    let r = await api(configured ? '/api/login' : '/api/setup', 'POST', f);
    if (r.requiresPasskey) {
      $('twoFactorLabel').hidden = false;
      if (!window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn())
        throw Error('Цей браузер не підтримує ключі доступу. Введіть резервний код.');
      const response = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: r.options,
      });
      r = await api('/api/passkey-login', 'POST', { ticket: r.ticket, response });
    }
    if (!configured) {
      configured = true;
      await start();
      note('Адміністратора створено. Увійдіть.');
    } else {
      csrf = r.csrf;
      await load();
    }
    e.target.password.value = '';
  } catch (x) {
    note(x.message);
  }
};
for (const [k, v] of Object.entries(types)) {
  const b = el('button', v);
  b.onclick = () => {
    kind = k;
    $('search').value = '';
    show().catch((e) => note(e.message));
  };
  b.dataset.kind = k;
  $('nav').append(b);
}
async function show() {
  if (!kind || !canView(kind)) {
    $('sectionTitle').textContent = 'Мій робочий простір';
    $('sectionHint').textContent =
      'Доступ до розділів ще не надано. Зверніться до головного адміністратора.';
    $('list').replaceChildren();
    $('stats').hidden = true;
    document.querySelector('.toolbar').hidden = true;
    document.querySelector('.resultsLine').hidden = true;
    $('new').hidden = true;
    $('importProduct').hidden = true;
    return;
  }
  $('importProduct').hidden = kind !== 'product' || !hasPermission('product.write');
  window.BelesAnalytics.stop();
  const analyticsMode = ['analytics', 'design', 'storage'].includes(kind);
  $('stats').hidden = analyticsMode;
  document.querySelector('.toolbar').hidden = analyticsMode;
  document.querySelector('.resultsLine').hidden = analyticsMode;
  document
    .querySelectorAll('nav button')
    .forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  $('sectionTitle').textContent = types[kind];
  $('sectionHint').textContent = hints[kind];
  $('statusFilter').hidden = kind === 'feedback';
  $('new').hidden = kind === 'feedback' || analyticsMode || !hasPermission(kind + '.write');
  $('brandFilter').hidden = !['product', 'presentation'].includes(kind);
  $('list').replaceChildren();
  if (kind === 'storage') {
    await window.BelesStorage.render($('list'));
    return;
  }
  if (kind === 'design') {
    await window.BelesSiteDesign.render($('list'));
    return;
  }
  if (analyticsMode) {
    await window.BelesAnalytics.render($('list'));
    return;
  }
  if (kind === 'feedback') {
    await window.BelesFeedback.render($('list'));
    return;
  }
  if (kind === 'partner') {
    const incomplete = rows.filter((r) => r.kind === 'partner' && (!r.nameEN || !r.textEN)).length;
    if (incomplete)
      $('list').append(
        el(
          'p',
          'Партнери без повного перекладу EN: ' +
            incomplete +
            '. До заповнення зберігаємо офіційні назви.',
          'helper',
        ),
      );
  }
  const q = $('search').value.toLowerCase(),
    brand = $('brandFilter').value;
  const selected = rows
    .filter(
      (r) =>
        r.kind === kind &&
        (!$('statusFilter').value ||
          ($('statusFilter').value === 'published' ? r.published : !r.published)) &&
        (!brand || !['product', 'presentation'].includes(kind) || r.brand === brand) &&
        [r.name, r.brand, r.sku, r.itemKey].join(' ').toLowerCase().includes(q),
    )
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  $('count').textContent = `Знайдено: ${selected.length}`;
  if (!selected.length) {
    $('list').append(
      el('div', 'Записів не знайдено. Змініть пошук або додайте новий запис.', 'empty'),
    );
    return;
  }
  const table = el('table'),
    head = el('tr');
  for (const t of ['Фото', 'Назва', 'Бренд / ключ', 'Порядок', 'Статус', ''])
    head.append(el('th', t));
  table.append(head);
  const filterKey = JSON.stringify([kind, q, brand, $('statusFilter').value]);
  if (filterKey !== lastListFilter) {
    lastListFilter = filterKey;
    listPage = 0;
  }
  listPage = Math.min(listPage, Math.max(0, Math.ceil(selected.length / 40) - 1));
  const pager = el('div', undefined, 'pagination'),
    previousPage = el('button', '← Попередня'),
    nextPage = el('button', 'Наступна →');
  previousPage.disabled = listPage === 0;
  nextPage.disabled = (listPage + 1) * 40 >= selected.length;
  previousPage.onclick = () => {
    listPage--;
    show().catch((e) => note(e.message));
  };
  nextPage.onclick = () => {
    listPage++;
    show().catch((e) => note(e.message));
  };
  pager.append(
    previousPage,
    el('span', ' Сторінка ' + (listPage + 1) + ' / ' + Math.ceil(selected.length / 40) + ' '),
    nextPage,
  );
  $('list').append(pager);
  for (const r of selected.slice(listPage * 40, (listPage + 1) * 40)) {
    const tr = el('tr'),
      pic = el('td');
    if (r.image && /^(https?:\/\/|\/uploads\/)/.test(r.image)) {
      const img = el('img');
      img.src = r.image;
      img.alt = '';
      img.loading = 'lazy';
      pic.append(img);
    }
    const title = el('td');
    title.append(
      el('div', kind === 'content' ? contentNames[r.name] || r.name : r.name, 'name'),
      el('div', r.sku || r.itemKey, 'sub'),
    );
    const state = el('td');
    state.append(
      el(
        'span',
        r.published ? 'Опубліковано' : 'Приховано',
        'badge' + (r.published ? '' : ' draft'),
      ),
    );
    const action = el('td'),
      b = el('button', hasPermission(kind + '.write') ? 'Редагувати' : 'Переглянути');
    b.onclick = () => edit(r);
    action.append(b);
    tr.append(
      pic,
      title,
      el('td', r.brand || r.itemKey),
      el('td', String(r.sort || 0)),
      state,
      action,
    );
    table.append(tr);
  }
  $('list').append(table);
}
$('search').oninput = () => show().catch((e) => note(e.message));
$('brandFilter').onchange = () => show().catch((e) => note(e.message));
$('new').onclick = () => edit(null);
$('close').onclick = closeEditor;
$('editor').addEventListener('cancel', (e) => {
  if (dirty && !confirm('Закрити без збереження змін?')) e.preventDefault();
});
$('statusFilter').onchange = () => show().catch((e) => note(e.message));
const hints = {
  design: 'Блоки, кольори та код. Завантажуйте оригінали перед змінами.',
  analytics:
    'Аудиторія, відвідуваність і популярність каталогу. Історія починається з моменту встановлення.',
  product: 'Фото, описи, характеристики й доступність кожного товару.',
  brand: 'Логотипи брендів, категорії та описи українською й англійською.',
  partner: 'Логотипи партнерів, назви та порядок відображення.',
  presentation: 'Завантажуйте PDF та прив’язуйте презентації до брендів.',
  content: 'Редагуйте готові тексти головної сторінки й контактну інформацію.',
  feedback: 'Повідомлення відвідувачів із форми сайту. Позначайте опрацьовані звернення.',
};
const contentNames = {
  company_since: 'Рік заснування',
  hero_w1: 'Головний заголовок · рядок 1',
  hero_w2: 'Головний заголовок · рядок 2',
  hero_w3: 'Головний заголовок · рядок 3',
  hero_desc: 'Опис на головному екрані',
  hero_btn_brands: 'Кнопка «Бренди»',
  hero_btn_contact: 'Кнопка «Контакти»',
  intro_h2: 'Заголовок вступу',
  intro_lead: 'Текст вступу',
  about_h2: 'Заголовок «Про нас»',
  about_text: 'Текст «Про нас»',
  contacts_h2: 'Заголовок контактів',
  footer_slogan: 'Слоган у футері',
  footer_copy: 'Авторські права',
  phone: 'Номер телефону',
  email: 'Електронна пошта',
  telegram: 'Telegram',
  feedback_endpoint: 'Адреса форми (налаштовується автоматично)',
  benefit_1_title: 'Перевага 1 · заголовок',
  benefit_1_body: 'Перевага 1 · текст',
  benefit_2_title: 'Перевага 2 · заголовок',
  benefit_2_body: 'Перевага 2 · текст',
  benefit_3_title: 'Перевага 3 · заголовок',
  benefit_3_body: 'Перевага 3 · текст',
};
const categories = {
  large: 'Великогабаритні іграшки',
  vehicles: 'Транспорт',
  outdoors: 'Активні ігри',
  dolls: 'Ляльки',
  baby: 'Для малюків',
  learning: 'Навчання та розвиток',
  creative: 'Творчість',
};
function renderStats() {
  const box = $('stats');
  box.replaceChildren();
  for (const k of ['product', 'brand', 'partner', 'presentation'].filter(canView)) {
    const card = el('button', undefined, 'statCard');
    card.append(el('b', String(rows.filter((r) => r.kind === k).length)), el('span', types[k]));
    card.onclick = () => {
      kind = k;
      $('search').value = '';
      $('brandFilter').value = '';
      $('statusFilter').value = '';
      show().catch((e) => note(e.message));
    };
    box.append(card);
  }
}
function closeEditor() {
  if (!dirty || confirm('Закрити без збереження змін?')) $('editor').close();
}
window.addEventListener('beforeunload', (e) => {
  if (dirty && $('editor').open) {
    e.preventDefault();
    e.returnValue = '';
  }
});
function edit(record, draft) {
  current = record ? structuredClone(record) : null;
  dirty = false;
  const r = record || {
    kind,
    published: true,
    sort: rows.filter((x) => x.kind === kind).length + 1,
    itemKey: kind + '-' + crypto.randomUUID(),
    slug: kind + '-' + crypto.randomUUID(),
    ...draft,
  };
  $('editTitle').textContent = record
    ? kind === 'content'
      ? contentNames[r.name] || r.name
      : r.name
    : 'Новий запис';
  $('delete').hidden = !record || !hasPermission(kind + '.write');
  $('saveHint').textContent = 'Після збереження зміни одразу доступні на сайті';
  $('fields').replaceChildren();
  const groups = [
    {
      title: 'Основна інформація',
      hint: 'Назва, прив’язка до бренду та видимість на сайті.',
      keys: ['name', 'brand', 'sku', 'sort', 'published'],
    },
    {
      title: 'Фото та файли',
      hint: 'Виберіть файл з комп’ютера або вставте посилання.',
      keys: ['image', 'imageAlt', 'pdfFile', 'presentationPage'],
    },
    {
      title: 'Опис і тексти',
      hint: 'UA — українська версія сайту, EN — англійська.',
      keys: [
        'nameEN',
        'descriptionUA',
        'descriptionEN',
        'textUA',
        'textEN',
        'focusUA',
        'focusEN',
        'assortmentUA',
        'assortmentEN',
      ],
    },
    {
      title: 'Характеристики й категорії',
      hint: 'Для характеристик використовуйте формат «Назва: значення», кожна з нового рядка.',
      keys: ['categories', 'age', 'material', 'dimensions', 'featuresUA', 'featuresEN', 'accent'],
    },
    {
      title: 'Посилання',
      hint: 'Повна адреса https://, а для контактів — tel: або mailto:.',
      keys: ['url', 'sourceURL', 'catalogLabel'],
    },
    {
      title: 'Технічні поля',
      hint: 'Службові ідентифікатори створюються автоматично. Для існуючих записів ключ зафіксовано.',
      keys: ['itemKey', 'slug'],
      advanced: true,
    },
  ];
  const allowed = new Set([...common, ...perType[kind]]);
  for (const group of groups) {
    const keys = group.keys.filter((k) => allowed.has(k));
    if (!keys.length) continue;
    const section = el(group.advanced ? 'details' : 'section', undefined, 'fieldSection');
    if (group.advanced) section.append(el('summary', group.title));
    else section.append(el('h3', group.title));
    section.append(el('p', group.hint, 'helper'));
    const grid = el('div', undefined, 'sectionGrid');
    section.append(grid);
    for (const key of keys) {
      const label = el('label', fields[key]);
      const multiline = /description|features|focus|assortment|textUA|textEN/.test(key);
      if (multiline || ['image', 'pdfFile', 'url', 'sourceURL', 'categories'].includes(key))
        label.className = 'wide';
      let input;
      if (key === 'brand') {
        input = el('select');
        input.add(new Option('Оберіть бренд', ''));
        for (const b of rows.filter((x) => x.kind === 'brand'))
          input.add(new Option(b.name, b.name));
        if (r.brand && !rows.some((x) => x.kind === 'brand' && x.name === r.brand))
          input.add(new Option(r.brand, r.brand));
        input.required = true;
      } else input = el(multiline ? 'textarea' : 'input');
      input.name = key;
      if (key === 'published') {
        input.type = 'checkbox';
        input.checked = r[key] !== false;
        label.className = 'publishedLabel';
      } else {
        input.value = r[key] ?? '';
        if (['sort', 'presentationPage'].includes(key)) input.type = 'number';
        if (['name', 'itemKey'].includes(key)) input.required = true;
        if (key === 'itemKey' && record) input.readOnly = true;
        if (key === 'name' && kind === 'content' && record) input.readOnly = true;
      }
      input.addEventListener('input', () => {
        dirty = true;
        $('saveHint').textContent = 'Є незбережені зміни';
      });
      input.addEventListener('change', () => {
        dirty = true;
      });
      label.append(input);
      if (key === 'categories') {
        input.type = 'hidden';
        const choices = el('div', undefined, 'categoryChoices');
        for (const [value, text] of Object.entries(categories)) {
          const l = el('label', text),
            check = el('input');
          check.type = 'checkbox';
          check.value = value;
          check.checked = (r.categories || '').split(';').includes(value);
          check.onchange = () => {
            input.value = [...choices.querySelectorAll('input:checked')]
              .map((x) => x.value)
              .join(';');
            dirty = true;
          };
          l.prepend(check);
          choices.append(l);
        }
        label.append(choices);
      }
      if (['image', 'pdfFile'].includes(key)) {
        const preview = el('div', undefined, 'mediaPreview');
        function updatePreview() {
          preview.replaceChildren();
          if (!input.value) {
            preview.append(el('span', 'Файл ще не додано', 'helper'));
            return;
          }
          if (!/^(https?:\/\/|\/uploads\/)/.test(input.value)) return;
          if (key === 'image') {
            const img = el('img');
            img.src = input.value;
            img.alt = 'Попередній перегляд';
            preview.append(img);
          } else {
            const a = el('a', 'Відкрити PDF ↗');
            a.href = input.value;
            a.target = '_blank';
            a.rel = 'noopener';
            preview.append(a);
          }
        }
        input.addEventListener('input', updatePreview);
        updatePreview();
        label.append(preview);
        const line = el('div', undefined, 'upload'),
          file = el('input');
        file.type = 'file';
        file.accept = key === 'pdfFile' ? '.pdf' : '.png,.jpg,.jpeg,.webp,.gif,.avif';
        file.onchange = async () => {
          const f = file.files[0];
          if (!f) return;
          if (f.size > (key === 'pdfFile' ? 60 : 20) * 1024 * 1024) {
            note('Максимум: зображення 20 МБ, PDF 60 МБ');
            return;
          }
          const save = $('save');
          try {
            file.disabled = true;
            save.disabled = true;
            note('Завантаження файла…');
            const response = await fetch('/api/upload', {
              method: 'POST',
              headers: {
                'X-CSRF-Token': csrf,
                'Content-Type': f.type || 'application/octet-stream',
              },
              body: f,
            });
            const u = await response.json();
            if (!response.ok) throw Error(u.error || 'Помилка завантаження');
            input.value = u.url;
            dirty = true;
            updatePreview();
            note('Файл завантажено. Збережіть зміни.');
          } catch (e) {
            note(e.message);
          } finally {
            file.disabled = false;
            save.disabled = false;
          }
        };
        line.append(file);
        label.append(line);
      }
      grid.append(label);
    }
    $('fields').append(section);
  }
  $('save').hidden = !hasPermission(kind + '.write');
  if (!hasPermission(kind + '.write'))
    $('fields')
      .querySelectorAll('input,textarea,select,button')
      .forEach((field) => (field.disabled = true));
  $('editor').showModal();
  if (draft) {
    dirty = true;
    $('saveHint').textContent = 'Імпортована чернетка: перевірте дані й виберіть бренд';
  }
}
$('editForm').onsubmit = async (e) => {
  e.preventDefault();
  $('save').disabled = true;
  const r = current ? structuredClone(current) : { kind };
  for (const input of $('fields').querySelectorAll('[name]'))
    r[input.name] =
      input.type === 'checkbox'
        ? input.checked
        : input.type === 'number'
          ? Number(input.value)
          : input.value;
  r.title = r.name;
  try {
    const out = await api('/api/catalog', 'POST', {
      record: r,
      originalKey: current?.itemKey,
      originalKind: current?.kind,
      revision,
    });
    rows = out.rows;
    revision = out.revision;
    dirty = false;
    $('editor').close();
    await load();
    note('Зміни збережено');
  } catch (e) {
    note(e.message);
  } finally {
    $('save').disabled = false;
  }
};
$('delete').onclick = async () => {
  if (!current || !confirm('Видалити цей запис?')) return;
  try {
    await api('/api/catalog', 'DELETE', {
      originalKey: current.itemKey,
      originalKind: current.kind,
      revision,
    });
    $('editor').close();
    await load();
    note('Запис видалено');
  } catch (e) {
    note(e.message);
  }
};
$('logout').onclick = async () => {
  if (dirty && $('editor').open && !confirm('Вийти без збереження змін?')) return;
  await api('/api/logout', 'POST', {});
  dirty = false;
  location.reload();
};
let refreshAccount = async () => {
  throw Error('Зачекайте завантаження профілю.');
};
$('password').onclick = async () => {
  try {
    await refreshAccount();
    $('accountForm').reset();
    $('addAdminForm').reset();
    $('account').showModal();
  } catch (e) {
    note(e.message);
  }
};
$('addAdminForm').onsubmit = async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData);
  data.permissions = formData.getAll('permissions');
  if (data.password !== data.confirm) {
    note('Паролі не збігаються');
    return;
  }
  $('addAdminSubmit').disabled = true;
  try {
    await api('/api/admins', 'POST', data);
    e.target.reset();
    await refreshAccount();
    note('Адміністратора створено з обраними правами');
  } catch (error) {
    note(error.message);
  } finally {
    $('addAdminSubmit').disabled = false;
  }
};
$('accountClose').onclick = () => $('account').close();
$('accountForm').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  if (data.password !== data.confirm) {
    note('Нові паролі не збігаються');
    return;
  }
  try {
    await api('/api/password', 'POST', data);
    location.reload();
  } catch (e) {
    note(e.message);
  }
};
start();
