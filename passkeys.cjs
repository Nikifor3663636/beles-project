'use strict';
const crypto = require('node:crypto');
const webauthn = require('@simplewebauthn/server');
const { fail } = require('./security.cjs');
// Short-lived, single-use challenges never become authenticated sessions.
module.exports = (accounts, clock = () => Date.now()) => {
  const pending = new Map();
  function origin(req) {
    const value = new URL(process.env.PUBLIC_URL || `http://${req.headers.host}`);
    if (value.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(value.hostname))
      fail(400, 'Для ключів доступу потрібен HTTPS та налаштований PUBLIC_URL.');
    return { expectedOrigin: value.origin, expectedRPID: value.hostname };
  }
  function remember(value) {
    for (const [id, item] of pending) if (item.until < clock()) pending.delete(id);
    if (pending.size >= 1000) fail(429, 'Спробуйте пізніше.');
    const ticket = crypto.randomBytes(32).toString('hex');
    pending.set(ticket, { ...value, until: clock() + 180000 });
    return ticket;
  }
  function consume(ticket, purpose, binding) {
    const value = pending.get(ticket);
    pending.delete(ticket);
    if (!value || value.until < clock() || value.purpose !== purpose || value.binding !== binding)
      fail(401, 'Підтвердження застаріло. Почніть знову.');
    return value;
  }
  return {
    async beginRegistration(req, session) {
      const user = session.user,
        expected = origin(req);
      const options = await webauthn.generateRegistrationOptions({
        rpName: 'Beles Brands',
        rpID: expected.expectedRPID,
        userName: user.username,
        userDisplayName: user.name,
        userID: new TextEncoder().encode(user.id),
        attestationType: 'none',
        supportedAlgorithmIDs: [-7, -257],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: (user.passkeys || []).map((key) => ({ id: key.id })),
      });
      return {
        options,
        ticket: remember({
          purpose: 'register',
          binding: session.id,
          userId: user.id,
          challenge: options.challenge,
          password: user.password,
          ...expected,
        }),
      };
    },
    async finishRegistration(session, value) {
      const item = consume(value.ticket, 'register', session.id);
      const user = (await accounts.users()).find((user) => user.id === item.userId && user.enabled);
      if (!user || user.password !== item.password) fail(401, 'Увійдіть повторно.');
      let result;
      try {
        result = await webauthn.verifyRegistrationResponse({
          response: value.response,
          expectedChallenge: item.challenge,
          expectedOrigin: item.expectedOrigin,
          expectedRPID: item.expectedRPID,
          requireUserVerification: true,
        });
      } catch {
        fail(400, 'Не вдалося перевірити ключ доступу.');
      }
      if (!result.verified) fail(400, 'Ключ не підтверджено.');
      const key = result.registrationInfo.credential;
      return accounts.addPasskey(user.id, {
        id: key.id,
        publicKey: Buffer.from(key.publicKey).toString('base64url'),
        counter: key.counter,
        transports: key.transports || [],
        rpID: item.expectedRPID,
        name: typeof value.name === 'string' ? value.name.slice(0, 80) : 'Ключ доступу',
        createdAt: new Date(clock()).toISOString(),
      });
    },
    async beginLogin(req, user) {
      const expected = origin(req);
      const keys = (user.passkeys || []).filter((key) => key.rpID === expected.expectedRPID);
      if (!keys.length)
        fail(401, 'Відкрийте сайт на домені, де додали ключ, або використайте резервний код.');
      const options = await webauthn.generateAuthenticationOptions({
        rpID: expected.expectedRPID,
        allowCredentials: keys.map((key) => ({ id: key.id, transports: key.transports })),
        userVerification: 'required',
      });
      return {
        requiresPasskey: true,
        options,
        ticket: remember({
          purpose: 'login',
          binding: '',
          userId: user.id,
          password: user.password,
          challenge: options.challenge,
          ...expected,
        }),
      };
    },
    async finishLogin(value) {
      const item = consume(value.ticket, 'login', '');
      const user = (await accounts.users()).find((user) => user.id === item.userId && user.enabled);
      if (!user || user.password !== item.password) fail(401, 'Увійдіть повторно.');
      const key = (user.passkeys || []).find(
        (key) => key.id === value.response?.id && key.rpID === item.expectedRPID,
      );
      if (!key) fail(401, 'Невідомий ключ доступу.');
      let result;
      try {
        result = await webauthn.verifyAuthenticationResponse({
          response: value.response,
          expectedChallenge: item.challenge,
          expectedOrigin: item.expectedOrigin,
          expectedRPID: item.expectedRPID,
          credential: {
            ...key,
            publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')),
          },
          requireUserVerification: true,
        });
      } catch {
        fail(401, 'Не вдалося підтвердити ключ доступу.');
      }
      if (!result.verified) fail(401, 'Ключ не підтверджено.');
      await accounts.updatePasskey(
        user.id,
        key.id,
        key.counter,
        result.authenticationInfo.newCounter,
      );
      return user;
    },
  };
};
