import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient } from './helpers.js';

// Must be set before the server boots: backend/config.js reads env at import
// time (helpers only load it lazily inside startTestServer).
process.env.DEV_BYPASS_AUTH = 'true';

test('development dashboard bypass (enabled)', async (t) => {
  const server = await startTestServer();
  const client = createClient(server.base);

  t.after(() => server.close());

  await t.test('config exposes the bypass flag outside production', async () => {
    const { config } = await import('../backend/config.js');
    assert.equal(config.devBypassAuth, true);
    assert.equal(config.isProduction, false);
  });

  await t.test('student dev-session issues a real session for the test identity', async () => {
    const res = await client.post('/api/auth/dev-session', { role: 'student' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'student');
    assert.ok(res.json.user.username, 'returns a username');
    assert.ok(res.json.profile, 'returns a student profile');
    assert.ok(res.json.profile.house, 'profile includes a house');

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, res.json.user.id);
    assert.equal(me.json.user.role, 'student');
    assert.ok(me.json.csrfToken, 'csrf token is re-issued for cross-origin frontends');
  });

  await t.test('student dev-session reaches real student data endpoints only', async () => {
    const mine = await client.get('/api/requests/mine');
    assert.equal(mine.status, 200, mine.text);
    assert.ok(Array.isArray(mine.json.requests), 'own request list loads');

    const staff = await client.get('/api/staff/requests');
    assert.equal(staff.status, 403, 'authorization checks elsewhere are untouched');
  });

  await t.test('logout ends the dev session', async () => {
    const out = await client.logout();
    assert.equal(out.status, 200);
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 401);
  });

  await t.test('staff dev-session issues a housemaster session (staff dashboard)', async () => {
    const staffClient = createClient(server.base);
    const res = await staffClient.post('/api/auth/dev-session', { role: 'staff' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.user.role, 'housemaster');
    assert.equal(res.json.profile, null, 'staff have no student profile');

    const me = await staffClient.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.ok(me.json.houses.includes('Balmer-Acquaah'), 'house assignment is loaded');

    const queue = await staffClient.get('/api/staff/requests');
    assert.equal(queue.status, 200, queue.text);
    assert.ok(Array.isArray(queue.json.requests), 'review queue loads');
  });

  await t.test('unknown identity kind is rejected', async () => {
    const fresh = createClient(server.base);
    const res = await fresh.post('/api/auth/dev-session', { role: 'admin' });
    assert.equal(res.status, 400);
    const missing = await fresh.post('/api/auth/dev-session', {});
    assert.equal(missing.status, 400);
  });
});
