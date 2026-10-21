'use strict';
const { body, json } = require('./http-utils.cjs');
const { fail } = require('./security.cjs');
const access = require('./request-security.cjs');
const permissions = require('./permissions.cjs');

module.exports =
  ({ accounts, sessions, audit, passkeys }) =>
  async (req, res, route, s) => {
    if (
      ![
        '/api/account',
        '/api/profile',
        '/api/reauth',
        '/api/admins',
        '/api/sessions',
        '/api/totp',
        '/api/passkeys',
        '/api/audit',
      ].includes(route)
    )
      return false;
    const send = (value, status = 200) => {
      json(res, status, value);
      return true;
    };
    async function rotate(all = false) {
      if (all) await sessions.revokeUser(s.userId);
      const created = await sessions.create(s.userId, req);
      if (!all) await sessions.logout(s.id);
      res.setHeader(
        'Set-Cookie',
        `beles_session=${created.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((created.until - Date.now()) / 1000))}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
      );
      return created.csrf;
    }
    async function authenticate(b) {
      access.limit('reauth:' + s.userId, 8, 900000);
      if (!(await accounts.verify(s.user, b.currentPassword || b.current)))
        fail(401, 'Incorrect current password');
      await accounts.factor(s.userId, b.code);
    }
    if (route === '/api/account' && req.method === 'GET') {
      const own = accounts.publicUser(s.user);
      const result = { ...own, user: own, sessions: await sessions.list(s.userId, s.id) };
      if (s.user.role === 'owner') {
        const users = await accounts.users(),
          activity = await sessions.activity();
        Object.assign(result, {
          administrators: users.length,
          maxAdministrators: null,
          permissionGroups: permissions.groups,
          users: users.map((u) => ({ ...accounts.publicUser(u), ...activity[u.id] })),
        });
      }
      return send(result);
    }
    if (route === '/api/reauth' && req.method === 'POST') {
      await authenticate(await body(req, 8192));
      const csrf = await rotate();
      await audit.record('auth.reauth', s.userId);
      return send({ ok: true, csrf });
    }
    if (route === '/api/profile' && req.method === 'PATCH')
      return send({ user: await accounts.profile(s.userId, await body(req, 8192)) });
    if (route === '/api/admins') {
      access.owner(s);
      if (req.method === 'GET')
        return send({ users: (await accounts.users()).map(accounts.publicUser) });
      const b = await body(req, 8192);
      access.limit('manage-admins:' + s.userId, 30, 60000);
      if (req.method === 'POST') {
        const user = await accounts.create(b.username, b.password, s.userId, b.permissions);
        await audit.record('admin.create', s.userId, user.id);
        return send({ ok: true, user: accounts.publicUser(user) }, 201);
      }
      if (req.method === 'PATCH') {
        const user = await accounts.manage(s.userId, b.id, b.action, b.permissions);
        if (['disable', 'delete'].includes(b.action)) await sessions.revokeUser(b.id);
        await audit.record('admin.' + b.action, s.userId, b.id);
        return send({ ok: true, user });
      }
    }
    if (route === '/api/sessions') {
      if (req.method === 'GET') return send({ sessions: await sessions.list(s.userId, s.id) });
      if (req.method === 'DELETE') {
        const b = await body(req, 8192);
        await sessions.revoke(b.id, s.userId);
        await audit.record('session.revoke', s.userId, s.userId);
        return send({ ok: true });
      }
    }
    if (route === '/api/passkeys') {
      const value = await body(req, 32768);
      access.limit('passkeys:' + s.userId, 10, 900000);
      let result;
      if (req.method === 'POST' && value.action === 'begin') {
        await authenticate(value);
        result = await passkeys.beginRegistration(req, s);
      } else if (req.method === 'POST' && value.action === 'confirm') {
        result = await passkeys.finishRegistration(s, value);
        result.csrf = await rotate(true);
        await audit.record('passkey.add', s.userId);
      } else if (req.method === 'DELETE') {
        await authenticate(value);
        result = await accounts.removePasskey(s.userId, value.id);
        result.csrf = await rotate(true);
        await audit.record('passkey.delete', s.userId);
      } else fail(400, 'Invalid passkey action');
      return send(result);
    }
    if (route === '/api/totp') {
      const b = await body(req, 8192);
      // Each change requires a password, and disabling also requires the current second factor.
      access.limit('totp:' + s.userId, 8, 900000);
      if (!(await accounts.verify(s.user, b.currentPassword)))
        fail(401, 'Incorrect current password');
      let result;
      if (req.method === 'POST' && b.action === 'begin') {
        if ((s.user.passkeys || []).length) await accounts.factor(s.userId, b.code);
        result = await accounts.beginTotp(s.userId);
      } else if (req.method === 'POST' && b.action === 'confirm')
        result = await accounts.confirmTotp(s.userId, b.code);
      else if (req.method === 'DELETE') {
        await accounts.disableTotp(s.userId, b.code);
        result = { ok: true };
      } else fail(400, 'Invalid 2FA action');
      await audit.record('totp.' + (b.action || 'disable'), s.userId);
      if (b.action === 'confirm' || req.method === 'DELETE') result.csrf = await rotate(true);
      return send(result);
    }
    if (route === '/api/audit' && req.method === 'GET') {
      permissions.requirePermission(s, 'storage.read');
      const url = new URL(req.url, 'http://localhost');
      return send(
        await audit.list(
          Number(url.searchParams.get('limit')) || 50,
          Number(url.searchParams.get('offset')) || 0,
        ),
      );
    }
    fail(405, 'Method not allowed');
  };
