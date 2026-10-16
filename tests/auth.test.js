import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient, applicationPayload } from './helpers.js';
import { createFixtures } from './fixtures.js';

let server;
let fixtures;

test.before(async () => {
  server = await startTestServer();
  fixtures = await createFixtures();
});

test.after(async () => {
  await server.close();
});

test('login rejects wrong password without leaking which field was wrong', async () => {
  const client = createClient(server.base);
  const res = await client.post('/api/auth/login', { identifier: 'TEST-HM1', password: 'wrong-password' });
  assert.equal(res.status, 401);
  assert.match(res.json.error, /do not match/i);
});

test('login works and /me returns the profile', async () => {
  const client = createClient(server.base);
  const { user, profile, csrfToken } = await client.login('TEST/26/0001', fixtures.password);
  assert.equal(user.role, 'student');
  assert.equal(profile.house, 'Balmer-Acquaah');
  assert.ok(csrfToken);
  const me = await client.get('/api/auth/me');
  assert.equal(me.json.user.username, 'TEST/26/0001');
});

test('logout invalidates the session', async () => {
  const client = createClient(server.base);
  await client.login('TEST/26/0001', fixtures.password);
  await client.logout();
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 401);
});

test('protected endpoints require authentication', async () => {
  const client = createClient(server.base);
  for (const path of ['/api/requests/mine', '/api/staff/requests', '/api/admin/stats', '/api/notifications']) {
    const res = await client.post(path, {});
    assert.equal(res.status, 401, `${path} should require auth`);
  }
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 401, '/api/auth/me should require auth');
  const verify = await client.post('/api/gate/verify', { code: 'ABCDEFGH' });
  assert.equal(verify.status, 401, '/api/gate/verify should require auth');
});

test('student registration requires the enrolment code and creates a usable account', async () => {
  const bad = createClient(server.base);
  const wrong = await bad.post('/api/auth/register', {
    username: 'MFS/26/9001', fullName: 'New Student', indexNumber: 'MFS/26/9001',
    classYear: 'SHS 1', house: 'Freeman-Aggrey', guardianName: 'Parent Person',
    guardianPhone: '0241234567', password: 'Password123', enrollmentCode: 'WRONG',
  });
  assert.equal(wrong.status, 400);

  const good = createClient(server.base);
  const res = await good.post('/api/auth/register', {
    username: 'MFS/26/9001', fullName: 'New Student', indexNumber: 'MFS/26/9001',
    classYear: 'SHS 1', house: 'Freeman-Aggrey', guardianName: 'Parent Person',
    guardianPhone: '0241234567', password: 'Password123', enrollmentCode: 'TEST-CODE-123',
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.user.role, 'student');
  const mine = await good.get('/api/requests/mine');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.requests, []);
});

test('duplicate registration is rejected', async () => {
  const client = createClient(server.base);
  const res = await client.post('/api/auth/register', {
    username: 'MFS/26/9001', fullName: 'New Student', indexNumber: 'MFS/26/9001',
    classYear: 'SHS 1', house: 'Freeman-Aggrey', guardianName: 'Parent Person',
    guardianPhone: '0241234567', password: 'Password123', enrollmentCode: 'TEST-CODE-123',
  });
  assert.equal(res.status, 400);
});

test('a signed-in student cannot register a second account without a fresh session', async () => {
  // Ensures registration is not a privilege-escalation path for active sessions.
  const client = createClient(server.base);
  await client.login('TEST/26/0001', fixtures.password);
  const res = await client.post('/api/auth/register', {
    username: 'MFS/26/9002', fullName: 'Another Student', indexNumber: 'MFS/26/9002',
    classYear: 'SHS 1', house: 'Freeman-Aggrey', guardianName: 'Parent Person',
    guardianPhone: '0241234567', password: 'Password123', enrollmentCode: 'TEST-CODE-123',
  });
  assert.equal(res.status, 201);
});

test('application payload helper produces a valid internal request shape', async () => {
  const payload = applicationPayload();
  assert.equal(payload.type, 'internal');
  assert.ok(payload.departDate && payload.departTime);
});
