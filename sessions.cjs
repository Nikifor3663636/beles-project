'use strict';
const crypto = require('node:crypto');
const { tokenHash, fail } = require('./security.cjs');
module.exports = (repository, accounts) => {
  const timeout = Math.max(
    15 * 60000,
    Math.min(86400000, Number(process.env.SESSION_TTL_MS) || 8 * 3600000),
  );
  const read = () => repository.read('sessions.json', []);
  const mutate = (action) =>
    repository.mutate(
      'sessions.json',
      async (entries) => {
        entries = entries.filter(([, s]) => s.until > Date.now());
        const result = await action(entries);
        return { value: entries, result };
      },
      [],
    );
  return {
    async get(req) {
      const raw = (req.headers.cookie || '').match(
        /(?:^|;\s*)beles_session=([a-f0-9]{64})(?:;|$)/,
      )?.[1];
      if (!raw) return null;
      const id = tokenHash(raw);
      const entry = (await read()).find(([key, s]) => key === id && s.until > Date.now());
      if (!entry) return null;
      const user = (await accounts.users()).find((u) => u.id === entry[1].userId);
      if (!user || !user.enabled) return null;
      const s = entry[1];
      if (Date.now() - s.lastSeen > 30000)
        await mutate((entries) => {
          const match = entries.find(([key]) => key === id);
          if (match) match[1].lastSeen = Date.now();
        });
      return { ...s, id, user };
    },
    async create(userId, req) {
      const token = crypto.randomBytes(32).toString('hex'),
        id = tokenHash(token),
        now = Date.now();
      const value = {
        userId,
        csrf: crypto.randomBytes(24).toString('hex'),
        until: now + timeout,
        createdAt: now,
        lastSeen: now,
        reauthUntil: now + 300000,
        agent: String(req.headers['user-agent'] || 'Невідомий браузер').slice(0, 160),
      };
      await mutate((entries) => {
        const own = entries
          .filter(([, s]) => s.userId === userId)
          .sort((a, b) => a[1].createdAt - b[1].createdAt);
        while (own.length >= 10) {
          const expired = own.shift();
          entries.splice(
            entries.findIndex(([key]) => key === expired[0]),
            1,
          );
        }
        entries.push([id, value]);
      });
      return { token, ...value };
    },
    async logout(id) {
      await mutate((entries) => {
        const i = entries.findIndex(([key]) => key === id);
        if (i >= 0) entries.splice(i, 1);
      });
    },
    async revokeUser(userId) {
      await mutate((entries) => {
        for (let i = entries.length - 1; i >= 0; i--)
          if (entries[i][1].userId === userId) entries.splice(i, 1);
      });
    },
    async revoke(id, userId) {
      await mutate((entries) => {
        const i = entries.findIndex(([key]) => key === id);
        if (i < 0) return;
        if (entries[i][1].userId !== userId) fail(403, 'Недостатньо прав.');
        entries.splice(i, 1);
      });
    },
    async fresh(id) {
      await mutate((entries) => {
        const match = entries.find(([key]) => key === id);
        if (!match) fail(401, 'Login required');
        match[1].reauthUntil = Date.now() + 300000;
      });
    },
    async list(userId, currentId) {
      return (await read())
        .filter(([, s]) => s.userId === userId && s.until > Date.now())
        .map(([id, s]) => ({
          id,
          current: id === currentId,
          agent: s.agent,
          createdAt: s.createdAt,
          lastSeen: s.lastSeen,
          expiresAt: s.until,
        }));
    },
    async activity() {
      const result = {};
      for (const [, s] of await read())
        if (s.until > Date.now()) {
          const old = result[s.userId]?.lastSeen || 0;
          result[s.userId] = {
            lastSeen: Math.max(old, s.lastSeen),
            online: Math.max(old, s.lastSeen) > Date.now() - 120000,
          };
        }
      return result;
    },
  };
};
