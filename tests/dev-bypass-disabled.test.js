import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient } from './helpers.js';

// Simulates a production-style deployment where the temporary bypass is
// switched off: the dev-session route must not exist at all.
process.env.DEV_BYPASS_AUTH = 'false';

test('development dashboard bypass (disabled)', async (t) => {
  const server = await startTestServer();
  const client = createClient(server.base);

  t.after(() => server.close());

  await t.test('config reports the bypass as disabled', async () => {
    const { config } = await import('../backend/config.js');
    assert.equal(config.devBypassAuth, false);
  });

  await t.test('dev-session route does not exist', async () => {
    const res = await client.post('/api/auth/dev-session', { role: 'student' });
    assert.equal(res.status, 404, res.text);
    assert.match(res.text, /Not found/i);
  });

  await t.test('normal authentication is unaffected', async () => {
    const before = await client.get('/api/auth/me');
    assert.equal(before.status, 401, 'protected endpoints still require a session');

    const bad = await client.post('/api/auth/login', { identifier: 'anyone', password: 'wrong' });
    assert.equal(bad.status, 401, 'password login still enforces credentials');
  });
});
