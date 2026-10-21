'use strict';
const crypto = require('node:crypto');
module.exports = (repository) => ({
  async record(action, actorId = null, targetId = null, result = 'ok') {
    if (!/^[a-z][a-z0-9_.-]{1,80}$/.test(action)) throw Error('Invalid audit action');
    await repository.mutate(
      'audit.json',
      (list) => {
        const cutoff = Date.now() - 30 * 86400000;
        const entry = {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          action,
          actorId,
          targetId,
          result,
        };
        return {
          value: [...list.filter((e) => Date.parse(e.at) > cutoff), entry].slice(-5000),
          result: entry.id,
        };
      },
      [],
    );
  },
  async list(limit = 50, offset = 0) {
    limit = Math.max(1, Math.min(100, limit));
    offset = Math.max(0, offset);
    const list = await repository.read('audit.json', []);
    return {
      total: list.length,
      items: list
        .slice()
        .reverse()
        .slice(offset, offset + limit),
    };
  },
});
