'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const permissions = require('./permissions.cjs');
const {
  fail,
  passwordHash,
  equal,
  base32,
  verifyTotp,
  encrypt,
  decrypt,
  tokenHash,
} = require('./security.cjs');
module.exports = (
  file,
  repository = require('./repository.cjs')(path.dirname(file), { databaseURL: '' }),
) => {
  function normalize(data) {
    const list = data ? data.users || [{ ...data, id: 'primary', createdAt: null }] : [];
    return list.map((u, i) => ({
      ...u,
      role: u.role || (i === 0 ? 'owner' : 'admin'),
      enabled: u.enabled !== false,
      name: u.name || u.username,
      avatar: u.avatar || '',
      permissions: permissions.normalize(
        u.permissions === undefined ? permissions.legacy : u.permissions,
        false,
      ),
    }));
  }
  async function users() {
    return normalize(await repository.read('admin.json', null));
  }
  const publicUser = ({
    id,
    username,
    name,
    role,
    enabled,
    avatar,
    createdAt,
    totp: factor,
    passkeys = [],
    permissions: grants,
  }) => ({
    id,
    username,
    name,
    role,
    enabled,
    avatar,
    createdAt,
    twoFactorEnabled: !!factor || passkeys.length > 0,
    totpEnabled: !!factor,
    passkeys: passkeys.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    permissions: permissions.effective({ role, permissions: grants }),
  });
  function validPassword(value) {
    return typeof value === 'string' && value.length >= 12 && value.length <= 1000;
  }
  async function verify(user, password) {
    if (!user || user.enabled === false || typeof password !== 'string' || password.length > 1000)
      return false;
    return equal(user.password, await passwordHash(password, user.salt, user.passwordVersion || 1));
  }
  async function mutate(action) {
    return repository.mutate(
      'admin.json',
      async (data) => {
        const list = normalize(data),
          result = await action(list);
        return { value: { version: 3, users: list }, result };
      },
      null,
    );
  }
  function owner(list, actorId) {
    const actor = list.find((u) => u.id === actorId);
    if (!actor || actor.role !== 'owner' || !actor.enabled)
      fail(403, 'Ця дія доступна лише головному адміністратору.');
    return actor;
  }
  async function create(username, password, actorId, grants = []) {
    grants = permissions.normalize(grants);
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_.@-]{3,80}$/u.test(username.trim()))
      fail(400, 'Username: 3–80 letters, digits, _, ., @ or -');
    if (!validPassword(password)) fail(400, 'Password: 12–1000 characters');
    const salt = crypto.randomBytes(16).toString('hex'),
      hashed = await passwordHash(password, salt, 2);
    return mutate((list) => {
      if (list.length) owner(list, actorId);
      username = username.trim();
      if (list.some((u) => u.username.toLowerCase() === username.toLowerCase()))
        fail(409, 'Username already exists');
      const user = {
        id: crypto.randomUUID(),
        username,
        name: username,
        avatar: '',
        role: list.length ? 'admin' : 'owner',
        permissions: grants,
        enabled: true,
        salt,
        password: hashed,
        passwordVersion: 2,
        createdAt: new Date().toISOString(),
      };
      list.push(user);
      return user;
    });
  }
  async function factor(id, code) {
    return mutate((list) => {
      const user = list.find((u) => u.id === id);
      if (!user || !user.enabled) fail(401, 'Login required');
      if (!user.totp && !(user.passkeys || []).length) return true;
      const hash = tokenHash(
        String(code || '')
          .replace(/\s/g, '')
          .toLowerCase(),
      );
      const recovery =
        [user.totp?.recovery, user.passkeyRecovery]
          .filter(Boolean)
          .find((list) => list.some((saved) => equal(saved, hash))) || [];
      const index = recovery.findIndex((saved) => equal(saved, hash));
      if (index >= 0) {
        recovery.splice(index, 1);
        return true;
      }
      const step = user.totp
        ? verifyTotp(decrypt(user.totp.secret), code, user.totp.lastStep ?? -1)
        : null;
      if (step !== null) {
        user.totp.lastStep = step;
        return true;
      }
      fail(401, 'Невірний або вже використаний код 2FA.');
    });
  }
  async function change(id, password) {
    if (!validPassword(password)) fail(400, 'Password: 12–1000 characters');
    const salt = crypto.randomBytes(16).toString('hex'),
      hash = await passwordHash(password, salt, 2);
    return mutate((list) => {
      const u = list.find((x) => x.id === id);
      if (!u) fail(401, 'Login required');
      u.salt = salt;
      u.password = hash;
      u.passwordVersion = 2;
    });
  }
  return {
    users,
    publicUser,
    verify,
    validPassword,
    create,
    change,
    factor,
    normalize,
    async addPasskey(id, key) {
      const recovery = Array.from({ length: 8 }, () => crypto.randomBytes(16).toString('hex'));
      return mutate((list) => {
        const user = list.find((user) => user.id === id && user.enabled);
        if (!user) fail(401, 'Login required');
        if ((user.passkeys || []).length >= 8) fail(400, 'Максимум 8 ключів.');
        if (list.some((user) => (user.passkeys || []).some((saved) => saved.id === key.id)))
          fail(409, 'Цей ключ уже додано.');
        (user.passkeys ||= []).push(key);
        user.passkeyRecovery = recovery.map(tokenHash);
        return { ok: true, recovery };
      });
    },
    async updatePasskey(id, keyId, counter, next) {
      return mutate((list) => {
        const user = list.find((user) => user.id === id && user.enabled);
        const key = user?.passkeys?.find((key) => key.id === keyId);
        if (!key || key.counter !== counter) fail(401, 'Ключ змінено. Увійдіть повторно.');
        key.counter = next;
      });
    },
    async removePasskey(id, keyId) {
      return mutate((list) => {
        const user = list.find((user) => user.id === id && user.enabled);
        if (!user) fail(401, 'Login required');
        user.passkeys = (user.passkeys || []).filter((key) => key.id !== keyId);
        if (!user.passkeys.length) delete user.passkeyRecovery;
        return { ok: true };
      });
    },
    async profile(id, changes) {
      if (changes.avatar !== undefined && typeof changes.avatar !== 'string')
        fail(400, 'Неправильний тип аватара.');
      if (Object.keys(changes).some((k) => !['name', 'avatar'].includes(k)))
        fail(400, 'Недозволені поля профілю.');
      if (
        typeof changes.name !== 'string' ||
        changes.name.trim().length < 1 ||
        changes.name.length > 100
      )
        fail(400, 'Вкажіть ім’я до 100 символів.');
      if (
        changes.avatar &&
        !/^(\/uploads\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif)|https:\/\/[^\s<>]+)$/i.test(
          changes.avatar,
        )
      )
        fail(400, 'Недозволене посилання аватара.');
      return mutate((list) => {
        const user = list.find((u) => u.id === id);
        if (!user) fail(401, 'Login required');
        if (
          process.env.MEDIA_DRIVER !== 's3' &&
          changes.avatar?.startsWith('/uploads/') &&
          !fs.existsSync(
            path.join(path.dirname(path.dirname(file)), 'uploads', path.basename(changes.avatar)),
          )
        )
          fail(400, 'Медіафайл аватара відсутній. Завантажте його знову.');
        user.name = changes.name.trim();
        user.avatar = changes.avatar || '';
        return publicUser(user);
      });
    },
    async manage(actorId, id, action, grants) {
      if (action === 'permissions') grants = permissions.normalize(grants);
      return mutate((list) => {
        owner(list, actorId);
        const index = list.findIndex((u) => u.id === id);
        if (index < 0) fail(404, 'Адміністратора не знайдено.');
        const user = list[index];
        if (user.role === 'owner')
          fail(409, 'Не можна вимкнути або видалити головного адміністратора.');
        if (action === 'delete') list.splice(index, 1);
        else if (action === 'permissions') user.permissions = grants;
        else if (['enable', 'disable'].includes(action)) user.enabled = action === 'enable';
        else fail(400, 'Недозволена дія.');
        return publicUser(user);
      });
    },
    async beginTotp(id) {
      const secret = base32(crypto.randomBytes(20)),
        encrypted = encrypt(secret);
      await mutate((list) => {
        const u = list.find((x) => x.id === id);
        if (!u) fail(401, 'Login required');
        if (u.totp) fail(409, '2FA вже увімкнено.');
        u.pendingTotp = { secret: encrypted, until: Date.now() + 600000 };
      });
      return {
        secret,
        uri:
          'otpauth://totp/' +
          encodeURIComponent('Beles:' + id) +
          '?secret=' +
          secret +
          '&issuer=Beles&algorithm=SHA1&digits=6&period=30',
      };
    },
    async confirmTotp(id, code) {
      const recovery = Array.from({ length: 8 }, () => crypto.randomBytes(16).toString('hex'));
      return mutate((list) => {
        const u = list.find((x) => x.id === id);
        if (!u?.pendingTotp || u.pendingTotp.until < Date.now())
          fail(400, 'Налаштування 2FA застаріло. Почніть знову.');
        const step = verifyTotp(decrypt(u.pendingTotp.secret), code);
        if (step === null) fail(400, 'Невірний код 2FA.');
        u.totp = {
          secret: u.pendingTotp.secret,
          lastStep: step,
          recovery: recovery.map(tokenHash),
        };
        delete u.pendingTotp;
        return { recovery };
      });
    },
    async disableTotp(id, code) {
      await factor(id, code);
      return mutate((list) => {
        const u = list.find((x) => x.id === id);
        delete u.totp;
        delete u.pendingTotp;
      });
    },
  };
};
