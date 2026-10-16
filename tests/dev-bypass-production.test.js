import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient } from './helpers.js';

// Production hard-off: even with DEV_BYPASS_AUTH explicitly requested, the
// bypass must stay disabled whenever NODE_ENV=production.
process.env.NODE_ENV = 'production';
process.env.DEV_BYPASS_AUTH = 'true';

test('development dashboard bypass (production hard-off)', async (t) => {
  const server = await startTestServer();
  const client = createClient(server.base);

  t.after(() => server.close());

  await t.test('bypass stays off in production even when the env var asks for it', async () => {
    const { config } = await import('../backend/config.js');
    assert.equal(config.isProduction, true);
    assert.equal(config.devBypassAuth, false);
  });

  await t.test('dev-session does not exist in production', async () => {
    const res = await client.post('/api/auth/dev-session', { role: 'student' });
    assert.equal(res.status, 404, res.text);
  });

  await t.test('protected endpoints still demand real authentication', async () => {
    const res = await client.get('/api/requests/mine');
    assert.equal(res.status, 401);
  });
});
