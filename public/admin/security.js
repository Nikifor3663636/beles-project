'use strict';
// This module shares the small DOM/API helpers from app.js, but never renders user HTML.
window.BelesSecurity = {
  async download(url, retried = false) {
    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json();
      if (error.reason === 'reauth_required' && !retried) {
        await this.reauthenticate();
        return this.download(url, true);
      }
      throw Error(error.error || 'Завантаження не вдалося');
    }
    const blob = URL.createObjectURL(await response.blob()),
      link = el('a');
    link.href = blob;
    link.download = (
      response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ||
      'beles-export.json'
    ).replace(/[^a-z0-9_.-]/gi, '_');
    link.click();
    setTimeout(() => URL.revokeObjectURL(blob), 1000);
  },
  credentials(title = 'Підтвердіть вашу особу') {
    return new Promise((resolve) => {
      const dialog = el('dialog', undefined, 'credential-dialog'),
        form = el('form', undefined, 'credential-form'),
        heading = el('h2', title);
      const password = el('input'),
        code = el('input'),
        submit = el('button', 'Підтвердити', 'primary'),
        cancel = el('button', 'Скасувати');
      password.type = 'password';
      password.autocomplete = 'current-password';
      password.required = true;
      code.autocomplete = 'one-time-code';
      code.name = 'code';
      code.setAttribute('aria-label', 'Код 2FA або резервний код');
      password.name = 'currentPassword';
      code.placeholder = 'Код 2FA або резервний код (якщо увімкнено)';
      const label = el('label', 'Ваш поточний пароль');
      label.append(password);
      const status = el('p');
      status.setAttribute('role', 'status');
      cancel.type = 'button';
      cancel.onclick = () => dialog.close();
      form.append(heading, label, code, status, submit, cancel);
      dialog.append(form);
      document.body.append(dialog);
      let value = null;
      form.onsubmit = (e) => {
        e.preventDefault();
        value = { currentPassword: password.value, code: code.value };
        dialog.close();
      };
      dialog.onclose = () => {
        dialog.remove();
        resolve(value);
      };
      dialog.showModal();
      password.focus();
    });
  },
  async reauthenticate() {
    const credentials = await this.credentials();
    if (!credentials) throw Error('Підтвердження скасовано');
    await api('/api/reauth', 'POST', credentials);
  },
};
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="/api/backup"],a[href^="/api/site-design/download"]');
  if (!link) return;
  event.preventDefault();
  window.BelesSecurity.download(link.getAttribute('href')).catch((error) => note(error.message));
});

function permissionPicker(groups, selected = []) {
  const picker = el('div', undefined, 'permission-grid');
  const presets = el('div', undefined, 'permission-presets');
  for (const [title, mode] of [
    ['Лише перегляд', 'read'],
    ['Усі права до розділів', 'all'],
    ['Очистити', 'none'],
  ]) {
    const button = el('button', title);
    button.type = 'button';
    button.onclick = () =>
      picker.querySelectorAll('input').forEach((input) => {
        input.checked = mode === 'all' || (mode === 'read' && input.value.endsWith('.read'));
      });
    presets.append(button);
  }
  picker.append(presets);
  for (const group of groups) {
    const fieldset = el('fieldset');
    fieldset.append(el('legend', group.label));
    const inputs = {};
    for (const operation of group.single ? [group.single] : ['read', 'write']) {
      const label = el(
        'label',
        operation === 'read'
          ? 'Перегляд'
          : operation === 'export'
            ? 'Дозволити експорт'
            : group.writeLabel || 'Редагування',
      );
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'permissions';
      checkbox.value = group.id + '.' + operation;
      checkbox.checked = selected.includes(checkbox.value);
      inputs[operation] = checkbox;
      checkbox.onchange = () => {
        if (operation === 'write' && checkbox.checked) inputs.read.checked = true;
        if (operation === 'read' && !checkbox.checked && inputs.write) inputs.write.checked = false;
      };
      label.prepend(checkbox);
      fieldset.append(label);
    }
    picker.append(fieldset);
  }
  return picker;
}

function accountTabs(account, profile, protection, sessionPanel, owner) {
  let security = document.getElementById('accountSecurity');
  if (!security) {
    security = el('section', undefined, 'account-tab-panel');
    security.id = 'accountSecurity';
    account.append(security);
  }
  security.replaceChildren(document.getElementById('accountForm'), protection);
  const admins = account.querySelector('.admin-users');
  admins.id = 'accountAdmins';
  const panels = [
    ['profile', 'Профіль', profile],
    ['security', 'Пароль і 2FA', security],
    ['sessions', 'Сеанси', sessionPanel],
    ...(owner ? [['admins', 'Адміністратори та права', admins]] : []),
  ];
  let navigation = document.getElementById('accountTabs');
  if (!navigation) {
    navigation = el('nav', undefined, 'account-tabs');
    navigation.id = 'accountTabs';
    account.append(navigation);
  }
  navigation.replaceChildren();
  navigation.setAttribute('role', 'tablist');
  navigation.setAttribute('aria-label', 'Налаштування акаунта');
  let chosen = panels.some(([key]) => key === account.dataset.tab)
    ? account.dataset.tab
    : 'profile';
  const buttons = [];
  function activate(key, focus = false) {
    chosen = key;
    account.dataset.tab = key;
    panels.forEach(([id, , panel], index) => {
      panel.hidden = id !== key;
      buttons[index].setAttribute('aria-selected', String(id === key));
      buttons[index].tabIndex = id === key ? 0 : -1;
      if (focus && id === key) buttons[index].focus();
    });
  }
  for (const [key, title, panel] of panels) {
    panel.classList.add('account-tab-panel');
    panel.setAttribute('role', 'tabpanel');
    const button = el('button', title);
    button.type = 'button';
    button.id = 'account-tab-' + key;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-labelledby', button.id);
    button.onclick = () => activate(key);
    buttons.push(button);
    navigation.append(button);
  }
  navigation.onkeydown = (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    activate(panels[next][0], true);
  };
  if (!owner) admins.hidden = true;
  activate(chosen);
}

refreshAccount = async function () {
  const a = await api('/api/account');
  document.getElementById('accountSummary')?.remove();
  const summary = el('header', undefined, 'account-summary');
  summary.id = 'accountSummary';
  const portrait = el('div', undefined, 'profile-portrait');
  const initials = (a.name || a.username)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  portrait.append(el('span', initials));
  if (a.avatar) {
    const photo = el('img');
    photo.src = a.avatar;
    photo.alt = a.name || a.username;
    photo.onerror = () => photo.remove();
    portrait.append(photo);
  }
  const identity = el('div', undefined, 'profile-identity');
  identity.append(
    el('p', '@' + a.username, 'profile-handle'),
    el('h2', a.name || a.username),
    el(
      'span',
      a.role === 'owner' ? 'Головний адміністратор' : 'Адміністратор · Beles Brands',
      'profile-role',
    ),
  );
  const stats = el('div', undefined, 'profile-stats');
  for (const [value, label] of [
    [String(a.sessions.length), 'активних сеансів'],
    [a.twoFactorEnabled ? 'Увімкнено' : 'Налаштувати', 'захист 2FA'],
    ['Beles', 'ваш робочий простір'],
  ]) {
    const item = el('div');
    item.append(el('strong', value), el('span', label));
    stats.append(item);
  }
  const close = el('button', 'Закрити', 'profile-close');
  close.type = 'button';
  close.onclick = () => document.getElementById('accountClose').click();
  summary.append(portrait, identity, stats, close);
  document.getElementById('account').prepend(summary);
  document.querySelector('#accountForm .dialogHead h2').textContent = 'Пароль і вхід';
  $('accountInfo').textContent =
    a.username + ' · ' + (a.role === 'owner' ? 'Головний адміністратор' : 'Адміністратор');
  document.querySelector('.admin-users').hidden = a.role !== 'owner';
  const old = $('securityProfile');
  if (old) old.remove();
  document.getElementById('accountSessions')?.remove();
  const section = el('section', undefined, 'accountBody');
  section.id = 'securityProfile';
  const profile = el('form'),
    name = el('input'),
    avatar = el('input');
  name.value = a.name;
  name.required = true;
  name.maxLength = 100;
  name.setAttribute('aria-label', 'Ім’я');
  avatar.value = a.avatar || '';
  avatar.placeholder = 'Посилання на аватар';
  avatar.setAttribute('aria-label', 'Аватар');
  name.name = 'profileName';
  avatar.name = 'profileAvatar';
  const avatarLabel = el('label', 'Завантажити аватар'),
    avatarFile = el('input'),
    avatarStatus = el('p');
  avatarFile.type = 'file';
  avatarFile.accept = 'image/png,image/jpeg,image/webp,image/avif,image/gif';
  avatarFile.name = 'avatarFile';
  avatarLabel.append(avatarFile);
  avatarStatus.setAttribute('role', 'status');
  avatarFile.onchange = async () => {
    const file = avatarFile.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      avatarStatus.textContent = 'Максимум 20 МБ';
      return;
    }
    avatarFile.disabled = true;
    try {
      avatarStatus.textContent = 'Завантажуємо…';
      const response = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-CSRF-Token': csrf,
          },
          body: file,
        }),
        result = await response.json();
      if (!response.ok) throw Error(result.error);
      avatar.value = result.url;
      avatarStatus.textContent = 'Файл готовий. Натисніть «Зберегти профіль».';
    } catch (error) {
      avatarStatus.textContent = error.message;
    } finally {
      avatarFile.disabled = false;
    }
  };
  const nameLabel = el('label', 'Ім’я профілю');
  nameLabel.append(name);
  const avatarUrlLabel = el('label', 'Посилання на фото');
  avatarUrlLabel.append(avatar);
  profile.append(
    el('h3', 'Редагування профілю'),
    nameLabel,
    avatarUrlLabel,
    el('button', 'Зберегти профіль'),
  );
  profile.append(avatarLabel, avatarStatus);
  profile.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/profile', 'PATCH', { name: name.value, avatar: avatar.value });
      await refreshAccount();
      note('Профіль збережено');
    } catch (error) {
      note(error.message);
    }
  };
  section.append(profile);
  const twoFactor = el('button', a.totpEnabled ? 'Вимкнути TOTP' : 'Налаштувати TOTP-застосунок');
  twoFactor.type = 'button';
  twoFactor.onclick = async () => {
    try {
      const credentials = await window.BelesSecurity.credentials('Захист акаунта');
      if (!credentials) return;
      if (a.totpEnabled) {
        await api('/api/totp', 'DELETE', credentials);
        await refreshAccount();
        return;
      }
      const setup = await api('/api/totp', 'POST', { ...credentials, action: 'begin' });
      const box = el('div'),
        secret = el('code', setup.secret),
        code = el('input'),
        confirm = el('button', 'Увімкнути 2FA');
      code.placeholder = '6 цифр з застосунку';
      code.autocomplete = 'one-time-code';
      code.inputMode = 'numeric';
      code.setAttribute('aria-label', 'Код 2FA');
      box.append(
        el(
          'p',
          'Додайте цей секрет у Google Authenticator, 2FAS або інший TOTP-застосунок. Нікому його не надсилайте.',
        ),
        secret,
        code,
        confirm,
      );
      protection.append(box);
      confirm.type = 'button';
      confirm.onclick = async () => {
        try {
          const result = await api('/api/totp', 'POST', {
            ...credentials,
            action: 'confirm',
            code: code.value,
          });
          box.replaceChildren(
            el('h3', '2FA увімкнено'),
            el(
              'p',
              'Збережіть резервні коди у захищеному місці. Кожен працює один раз. Повторно їх показати неможливо.',
            ),
            el('pre', result.recovery.join('\n')),
          );
          twoFactor.remove();
        } catch (error) {
          note(error.message);
        }
      };
    } catch (error) {
      note(error.message);
    }
  };
  const protection = el('section', undefined, 'accountProtection');
  const keyPanel = el('section', undefined, 'passkey-panel');
  const keyName = el('input');
  keyName.placeholder = 'Назва пристрою, наприклад Робочий ноутбук';
  keyName.maxLength = 80;
  keyName.setAttribute('aria-label', 'Назва ключа доступу');
  const addKey = el('button', 'Додати Windows Hello / Face ID / ключ');
  addKey.type = 'button';
  keyPanel.append(
    el('h3', 'Підтвердження входу на сайті'),
    el(
      'p',
      'Пароль + ключ доступу пристрою. Браузер запросить відбиток, Face ID, Windows Hello або PIN пристрою. Google Authenticator не потрібен.',
    ),
    keyName,
    addKey,
  );
  const keyStatus = el('div');
  keyStatus.setAttribute('role', 'status');
  keyPanel.append(keyStatus);
  addKey.onclick = async () => {
    try {
      if (!window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn())
        throw Error('Потрібен сучасний браузер з підтримкою ключів доступу та HTTPS.');
      const credentials = await window.BelesSecurity.credentials(
        a.passkeys.length
          ? 'Пароль і резервний код чинного захисту'
          : 'Підтвердіть пароль для додавання ключа',
      );
      if (!credentials) return;
      addKey.disabled = true;
      const setup = await api('/api/passkeys', 'POST', { ...credentials, action: 'begin' });
      const response = await window.SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: setup.options,
      });
      const result = await api('/api/passkeys', 'POST', {
        action: 'confirm',
        ticket: setup.ticket,
        response,
        name: keyName.value || 'Мій пристрій',
      });
      keyStatus.replaceChildren(
        el('h3', 'Ключ додано. Збережіть резервні коди'),
        el(
          'p',
          'Коди показано лише зараз. Кожен працює один раз. Нові коди замінюють попередні коди ключів доступу.',
        ),
        el('pre', result.recovery.join('\n')),
      );
      addKey.hidden = true;
    } catch (error) {
      keyStatus.textContent =
        error.name === 'NotAllowedError' ? 'Підтвердження скасовано або час минув.' : error.message;
    } finally {
      addKey.disabled = false;
    }
  };
  for (const key of a.passkeys) {
    const row = el('div', undefined, 'sessionRow'),
      remove = el('button', 'Видалити ключ');
    remove.type = 'button';
    row.append(
      el('span', key.name + ' · ' + new Date(key.createdAt).toLocaleDateString('uk-UA')),
      remove,
    );
    remove.onclick = async () => {
      try {
        const credentials = await window.BelesSecurity.credentials(
          'Пароль і код захисту для видалення ключа',
        );
        if (!credentials) return;
        await api('/api/passkeys', 'DELETE', { ...credentials, id: key.id });
        await refreshAccount();
      } catch (error) {
        note(error.message);
      }
    };
    keyPanel.append(row);
  }
  protection.append(
    keyPanel,
    el('h3', 'Додатковий варіант: TOTP-застосунок'),
    el('p', a.totpEnabled ? 'TOTP увімкнено' : 'TOTP не увімкнено'),
    twoFactor,
  );
  const sessionPanel = el('section', undefined, 'accountBody');
  sessionPanel.id = 'accountSessions';
  sessionPanel.append(el('h3', 'Ваші активні сеанси'));
  for (const session of a.sessions) {
    const row = el('div', undefined, 'sessionRow'),
      button = el('button', session.current ? 'Вийти з цього сеансу' : 'Завершити');
    button.type = 'button';
    row.append(
      el(
        'p',
        session.agent +
          (session.current ? ' · поточний' : '') +
          ' · ' +
          new Date(session.lastSeen).toLocaleString('uk-UA'),
      ),
      button,
    );
    button.onclick = async () => {
      try {
        await api('/api/sessions', 'DELETE', { id: session.id });
        if (session.current) location.reload();
        else await refreshAccount();
      } catch (error) {
        note(error.message);
      }
    };
    sessionPanel.append(row);
  }
  $('account').append(section, sessionPanel);
  accountTabs($('account'), section, protection, sessionPanel, a.role === 'owner');
  if (a.role !== 'owner') return;
  $('adminUsers').replaceChildren();
  for (const user of a.users) {
    const row = el('li', undefined, 'admin-profile-card');
    const avatar = el('div', undefined, 'admin-profile-avatar');
    avatar.append(el('span', (user.name || user.username).slice(0, 1).toUpperCase()));
    if (user.avatar) {
      const photo = el('img');
      photo.src = user.avatar;
      photo.alt = user.name || user.username;
      photo.onerror = () => photo.remove();
      avatar.append(photo);
    }
    const details = el('div', undefined, 'admin-profile-details');
    details.append(
      el('strong', user.name || user.username),
      el('small', '@' + user.username),
      el(
        'span',
        user.role === 'owner' ? 'Головний адміністратор' : 'Адміністратор',
        'profile-role',
      ),
      el(
        'small',
        !user.enabled
          ? 'Доступ вимкнено'
          : user.online
            ? 'Зараз онлайн'
            : user.lastSeen
              ? 'Був(-ла) ' + new Date(user.lastSeen).toLocaleString('uk-UA')
              : 'Ще не входив(-ла)',
      ),
    );
    row.append(avatar, details);
    if (user.role !== 'owner')
      for (const action of ['enable', 'disable', 'delete']) {
        const button = el(
          'button',
          { enable: 'Увімкнути', disable: 'Вимкнути', delete: 'Видалити' }[action],
        );
        button.type = 'button';
        button.onclick = async () => {
          try {
            if (action === 'delete' && !confirm('Видалити цей обліковий запис?')) return;
            await api('/api/admins', 'PATCH', { id: user.id, action });
            await refreshAccount();
          } catch (error) {
            note(error.message);
          }
        };
        row.append(button);
      }
    if (user.role !== 'owner') {
      const details = el('details', undefined, 'admin-permissions');
      details.append(el('summary', 'Права доступу · ' + user.permissions.length));
      const form = el('form');
      form.append(
        permissionPicker(a.permissionGroups, user.permissions),
        el('button', 'Зберегти права', 'primary'),
      );
      form.onsubmit = async (event) => {
        event.preventDefault();
        try {
          await api('/api/admins', 'PATCH', {
            id: user.id,
            action: 'permissions',
            permissions: new FormData(form).getAll('permissions'),
          });
          await refreshAccount();
          note('Права оновлено. Зміни діють одразу.');
        } catch (error) {
          note(error.message);
        }
      };
      details.append(form);
      row.append(details);
    }
    $('adminUsers').append(row);
  }
  $('addAdminForm').hidden = false;
  document.getElementById('newAdminPermissions')?.remove();
  const grants = permissionPicker(a.permissionGroups);
  grants.id = 'newAdminPermissions';
  grants.prepend(el('h3', 'Права нового адміністратора'));
  $('addAdminSubmit').before(grants);
  $('adminLimit').textContent =
    'Акаунтів: ' +
    a.administrators +
    '. Кількість не обмежена. Лише головний адміністратор керує доступом.';
};
