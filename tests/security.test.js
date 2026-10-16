import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient, applicationPayload, when, departParts, returnParts } from './helpers.js';
import { createFixtures } from './fixtures.js';

let server;
let fixtures;
let ids;

test.before(async () => {
  server = await startTestServer();
  fixtures = await createFixtures();
  ids = fixtures.users;
});

test.after(async () => {
  await server.close();
});

async function loginAs(username) {
  const c = createClient(server.base);
  await c.login(username, fixtures.password);
  return c;
}

async function submitAs(client, overrides = {}) {
  const res = await client.post('/api/requests', applicationPayload(overrides));
  assert.equal(res.status, 201, res.text);
  return res.json.request;
}

test('a student cannot read another student\'s request, even with the exact id', async () => {
  const studentA = await loginAs('TEST/26/0001');
  const studentB = await loginAs('TEST/26/0002');
  const request = await submitAs(studentA);

  const peek = await studentB.get(`/api/requests/${request.id}`);
  assert.equal(peek.status, 404, 'cross-student access must look like "not found"');

  const pass = await studentB.get(`/api/requests/${request.id}/pass`);
  assert.equal(pass.status, 404);

  const patch = await studentB.patch(`/api/requests/${request.id}`, applicationPayload());
  assert.equal(patch.status, 404);

  const cancel = await studentB.post(`/api/requests/${request.id}/cancel`, { reason: 'trying to interfere' });
  assert.equal(cancel.status, 404);
});

test('the request list only contains the signed-in student\'s records', async () => {
  const studentA = await loginAs('TEST/26/0001');
  const studentB = await loginAs('TEST/26/0002');
  await submitAs(studentA);
  const mineB = await studentB.get('/api/requests/mine');
  assert.equal(mineB.status, 200);
  assert.equal(mineB.json.requests.length, 0);
});

test('a student cannot approve or reject anything', async () => {
  const student = await loginAs('TEST/26/0001');
  const request = await submitAs(student);
  for (const decision of ['approved', 'rejected', 'returned']) {
    const res = await student.post(`/api/staff/requests/${request.id}/decision`, { decision, comment: 'self service' });
    assert.equal(res.status, 403, `student ${decision} must be forbidden`);
  }
  const detail = await student.get(`/api/requests/${request.id}`);
  assert.equal(detail.json.request.status, 'pending', 'status unchanged');
});

test('admin accounts cannot approve requests either', async () => {
  const student = await loginAs('TEST/26/0001');
  const admin = await loginAs('TEST-ADMIN');
  const request = await submitAs(student);
  const res = await admin.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'admin override' });
  assert.equal(res.status, 403);
});

test('a housemaster of another house cannot see or decide the request', async () => {
  const student = await loginAs('TEST/26/0001'); // Balmer-Acquaah
  const otherHm = await loginAs('TEST-HM2'); // Pickard-Parker
  const request = await submitAs(student);

  const detail = await otherHm.get(`/api/staff/requests/${request.id}`);
  assert.equal(detail.status, 403);

  const decision = await otherHm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'not my student' });
  assert.equal(decision.status, 403);

  const queue = await otherHm.get('/api/staff/requests?status=pending');
  assert.equal(queue.status, 200);
  assert.ok(!queue.json.requests.some((r) => r.id === request.id), 'queue is scoped by house');
});

test('a senior cannot approve at the housemaster stage', async () => {
  const student = await loginAs('TEST/26/0001');
  const senior = await loginAs('TEST-SENIOR');
  const request = await submitAs(student, {
    type: 'external',
    reason: 'Family event that requires travelling outside campus this week.',
    ...departParts(when(72).toISOString()),
    ...returnParts(when(80).toISOString()),
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
  });
  const res = await senior.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'skip ahead' });
  assert.equal(res.status, 403);
});

test('mutations without a CSRF token are rejected', async () => {
  const student = await loginAs('TEST/26/0001');
  const res = await student.post('/api/requests', applicationPayload(), { allowCsrf: false });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /security token/i);
});

test('staff endpoints are closed to anonymous callers', async () => {
  const anon = createClient(server.base);
  const cases = [
    ['get', '/api/staff/requests'],
    ['post', '/api/staff/whatever/decision'],
    ['post', '/api/admin/users'],
    ['get', '/api/admin/users'],
    ['post', '/api/gate/depart'],
    ['post', '/api/gate/return'],
    ['get', '/api/requests/mine'],
  ];
  for (const [method, path] of cases) {
    const res = await anon[method](path, method === 'get' ? undefined : {});
    assert.equal(res.status, 401, `${method.toUpperCase()} ${path} must be 401 for anonymous users`);
  }
});

test('gate verification requires an account and never returns the private reason', async () => {
  const student = await loginAs('TEST/26/0001');
  const hm = await loginAs('TEST-HM1');
  const gate = await loginAs('TEST-GATE');

  const request = await submitAs(student, {
    reason: 'Medical appointment at the clinic for a confidential matter that must stay private.',
  });
  const decision = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  const code = decision.json.pass.code;

  const anon = createClient(server.base);
  const anonVerify = await anon.post('/api/gate/verify', { code });
  assert.equal(anonVerify.status, 401);

  const res = await gate.post('/api/gate/verify', { code });
  assert.equal(res.status, 200);
  const body = JSON.stringify(res.json);
  assert.ok(!body.includes('confidential'), 'gate response must not leak the reason for leaving');
  assert.equal(res.json.student.fullName, 'Test Student One');
});

test('guessing or fabricating a pass code does not produce a valid pass', async () => {
  const gate = await loginAs('TEST-GATE');
  for (const code of ['NOTREAL1234', '000000000000', 'AAAAAAAAAAAA']) {
    const res = await gate.post('/api/gate/verify', { code });
    assert.equal(res.status, 404);
    assert.equal(res.json.valid, false);
  }
});

test('a student cannot record departures or returns', async () => {
  const student = await loginAs('TEST/26/0001');
  const hm = await loginAs('TEST-HM1');
  const request = await submitAs(student, {
    ...departParts(when(0.25).toISOString()),
    ...returnParts(when(6).toISOString()),
  });
  const decision = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  const code = decision.json.pass.code;

  const depart = await student.post('/api/gate/depart', { code });
  assert.equal(depart.status, 403);
  const ret = await student.post('/api/gate/return', { code });
  assert.equal(ret.status, 403);
});

test('students cannot reach admin endpoints', async () => {
  const student = await loginAs('TEST/26/0001');
  for (const [method, path, body] of [
    ['get', '/api/admin/stats', undefined],
    ['get', '/api/admin/users', undefined],
    ['post', '/api/admin/users', { username: 'HACK', fullName: 'Hacker', role: 'admin', password: 'Password123' }],
    ['put', '/api/admin/settings', { external_min_notice_hours: '0' }],
  ]) {
    const res = await student[method](path, body);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} must be forbidden for students`);
  }
});

test('staff cannot see students outside their assigned house via search', async () => {
  const hm = await loginAs('TEST-HM1'); // Balmer only
  const res = await hm.get('/api/staff/requests?q=Test Student Two');
  assert.equal(res.status, 200);
  assert.equal(res.json.requests.length, 0);
});

test('admin cannot change approval statuses through settings', async () => {
  const admin = await loginAs('TEST-ADMIN');
  const res = await admin.put('/api/admin/settings', { status: 'approved', external_min_notice_hours: '1' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.updated, ['external_min_notice_hours'], 'only whitelisted settings change');
});
