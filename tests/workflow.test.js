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

async function studentClient() {
  const c = createClient(server.base);
  await c.login('TEST/26/0001', fixtures.password);
  return c;
}

async function submit(client, overrides = {}, key) {
  const res = await client.post('/api/requests', applicationPayload(overrides), key ? { headers: { 'idempotency-key': key } } : {});
  assert.equal(res.status, 201, res.text);
  return res.json.request;
}

test('internal exeat: submit → housemaster approves → pass issued → gate departure and return', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const gate = createClient(server.base);
  await gate.login('TEST-GATE', fixtures.password);

  const request = await submit(student, {
    ...departParts(when(0.25).toISOString()),
    ...returnParts(when(6).toISOString()),
  });
  assert.equal(request.status, 'pending');
  assert.equal(request.requiresSenior, false);
  assert.match(request.reference, /^EXE-\d{4}-\d{4}$/);

  const queue = await hm.get('/api/staff/requests?status=pending');
  assert.equal(queue.status, 200);
  assert.ok(queue.json.requests.some((r) => r.id === request.id), 'housemaster sees the pending request');

  const decision = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'Approved, travel safely.' });
  assert.equal(decision.status, 200, decision.text);
  assert.equal(decision.json.request.status, 'approved');
  assert.ok(decision.json.pass.code.length >= 8, 'a pass code is issued');

  const detail = await student.get(`/api/requests/${request.id}`);
  assert.equal(detail.json.request.status, 'approved');
  assert.ok(detail.json.pass, 'student sees the pass');
  assert.ok(detail.json.timeline.some((e) => /Approved by/.test(e.label)), 'timeline records the approval');

  const verify = await gate.post('/api/gate/verify', { code: decision.json.pass.code });
  assert.equal(verify.status, 200);
  assert.equal(verify.json.valid, true);
  assert.equal(verify.json.student.fullName, 'Test Student One');
  assert.equal(verify.json.request.destination, 'Cape Coast — Ridge home');
  assert.equal(verify.json.reason, undefined, 'gate response does not include the private reason');

  const depart = await gate.post('/api/gate/depart', { code: decision.json.pass.code });
  assert.equal(depart.status, 200, depart.text);
  assert.ok(depart.json.pass.departedAt);

  const departAgain = await gate.post('/api/gate/depart', { code: decision.json.pass.code });
  assert.equal(departAgain.status, 409, 'double departure is blocked');

  const ret = await gate.post('/api/gate/return', { code: decision.json.pass.code });
  assert.equal(ret.status, 200, ret.text);
  assert.equal(ret.json.request.status, 'completed');
  assert.equal(ret.json.valid, false, 'a completed pass is no longer valid');

  const departAfterReturn = await gate.post('/api/gate/depart', { code: decision.json.pass.code });
  assert.equal(departAfterReturn.status, 409, 'completed passes cannot be reused');
});

test('external exeat requires senior approval before a pass exists', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const senior = createClient(server.base);
  await senior.login('TEST-SENIOR', fixtures.password);

  const depart = when(72);
  const back = when(80);
  const request = await submit(student, {
    type: 'external',
    category: 'family',
    reason: 'Attending a family funeral ceremony with my guardian.',
    destination: 'Elmina',
    ...departParts(depart.toISOString()),
    ...returnParts(back.toISOString()),
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
  });
  assert.equal(request.requiresSenior, true);

  const seniorTooEarly = await senior.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  assert.equal(seniorTooEarly.status, 403, 'senior cannot act before the housemaster stage');

  const hmOk = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'Checked with parent.' });
  assert.equal(hmOk.status, 200);
  assert.equal(hmOk.json.request.status, 'pending_senior');
  assert.equal(hmOk.json.pass, null, 'no pass until the senior approves');

  const detail = await student.get(`/api/requests/${request.id}`);
  assert.equal(detail.json.pass, null);

  const seniorOk = await senior.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'Approved.' });
  assert.equal(seniorOk.status, 200);
  assert.equal(seniorOk.json.request.status, 'approved');
  assert.ok(seniorOk.json.pass?.code);
});

test('rejection records a reason and never issues a pass', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);

  const request = await submit(student);
  const res = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'rejected', comment: 'Midterm exams are in progress.' });
  assert.equal(res.status, 200);
  assert.equal(res.json.request.status, 'rejected');

  const detail = await student.get(`/api/requests/${request.id}`);
  assert.equal(detail.json.pass, null);
  assert.ok(detail.json.timeline.some((e) => /Rejected by/.test(e.label) && /Midterm/.test(e.detail)));
});

test('return for correction lets the student fix and resubmit', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);

  const request = await submit(student);
  const returned = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'returned', comment: 'Add the exact destination area.' });
  assert.equal(returned.json.request.status, 'returned');

  const fixed = await student.patch(`/api/requests/${request.id}`, applicationPayload({ destination: 'Cape Coast — Chapel Hill' }));
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.request.status, 'pending', 'resubmitted requests go back to the housemaster stage');
  assert.equal(fixed.json.request.destination, 'Cape Coast — Chapel Hill');

  const editBlocked = await student.patch(`/api/requests/${request.id}`, applicationPayload());
  assert.equal(editBlocked.status, 409, 'students cannot edit a pending request');
});

test('student can cancel a pending request', async () => {
  const student = await studentClient();
  const request = await submit(student);
  const res = await student.post(`/api/requests/${request.id}/cancel`, { reason: 'Plans changed, staying on campus.' });
  assert.equal(res.status, 200);
  assert.equal(res.json.request.status, 'cancelled');
});

test('cancelled approval can no longer be decided', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const request = await submit(student);
  await student.post(`/api/requests/${request.id}/cancel`, { reason: 'Changed my mind about the trip.' });
  const res = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  assert.equal(res.status, 409);
});

test('duplicate submission with the same idempotency key creates one request', async () => {
  const student = await studentClient();
  const key = `idem-${Date.now()}-abc`;
  const first = await submit(student, {}, key);
  const second = await submit(student, {}, key);
  assert.equal(first.id, second.id);
});

test('external exeat inside the 24-hour notice window is rejected', async () => {
  const student = await studentClient();
  const depart = when(6);
  const back = when(10);
  const res = await student.post('/api/requests', applicationPayload({
    type: 'external',
    reason: 'Urgent family matter that I need to attend with my guardian today.',
    ...departParts(depart.toISOString()),
    ...returnParts(back.toISOString()),
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
  }));
  assert.equal(res.status, 400);
  assert.match(res.json.errors.departAt, /24 hours/);
});

test('an expired pass cannot be verified as valid', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const gate = createClient(server.base);
  await gate.login('TEST-GATE', fixtures.password);

  const request = await submit(student);
  const decision = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  const code = decision.json.pass.code;

  // Age the request past the return window (simulates time passing).
  const { getDb } = await import('../backend/db.js');
  const db = getDb();
  const past = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  db.prepare('UPDATE passes SET expires_at = ? WHERE code = ?').run(past, code);
  db.prepare('UPDATE exeat_requests SET return_at = ? WHERE id = ?').run(past, request.id);

  const verify = await gate.post('/api/gate/verify', { code });
  assert.equal(verify.json.valid, false);
  assert.equal(verify.json.state, 'expired');

  const depart = await gate.post('/api/gate/depart', { code });
  assert.equal(depart.status, 409);
});

test('student notifications are created for key events', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const request = await submit(student);
  await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'ok' });
  const notes = await student.get('/api/notifications');
  assert.equal(notes.status, 200);
  assert.ok(notes.json.notifications.some((n) => n.type === 'pass_issued'));
});

test('housemaster can shorten the schedule when approving; senior finalises the dates', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const senior = createClient(server.base);
  await senior.login('TEST-SENIOR', fixtures.password);

  const request = await submit(student, {
    type: 'external',
    reason: 'Attending a family gathering with my guardian.',
    destination: 'Elmina — family home',
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
    ...departParts(when(30).toISOString()),
    ...returnParts(when(50).toISOString()),
  });
  assert.equal(request.status, 'pending');

  const shorterReturn = new Date(Date.now() + 34 * 3600 * 1000);
  const decision = await hm.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'approved',
    comment: 'Shortening the visit.',
    proposedDepartAt: request.departAt,
    proposedReturnAt: shorterReturn.toISOString(),
    dateReason: 'The weekend visit does not need five days.',
  });
  assert.equal(decision.status, 200, decision.text);
  assert.equal(decision.json.request.status, 'pending_senior', 'external approval forwards to the senior');
  assert.equal(decision.json.request.departAt, request.departAt, 'original departure is never overwritten');
  assert.equal(decision.json.request.returnAt, request.returnAt, 'original return is never overwritten');
  assert.ok(decision.json.request.proposedReturnAt, 'proposal recorded on the request');

  // The senior sees the proposal and the housemaster's decision before acting.
  const detail = await senior.get(`/api/staff/requests/${request.id}`);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.request.status, 'pending_senior');
  assert.ok(detail.json.request.proposedReturnAt, 'senior sees the proposed dates');
  assert.equal(detail.json.approvals.length, 1);
  assert.equal(detail.json.approvals[0].stage, 'housemaster');
  assert.ok(detail.json.approvals[0].dateReason, 'senior sees the adjustment reason');

  // Senior approves, forwarding the same proposal � no new reason required.
  const final = await senior.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'approved',
    comment: 'Approved.',
    proposedDepartAt: detail.json.request.proposedDepartAt,
    proposedReturnAt: detail.json.request.proposedReturnAt,
  });
  assert.equal(final.status, 200, final.text);
  assert.equal(final.json.request.status, 'approved');
  assert.ok(final.json.request.approvedReturnAt, 'final approval freezes the authorised schedule');
  assert.equal(
    new Date(final.json.request.approvedReturnAt).getTime(),
    new Date(shorterReturn.toISOString()).getTime(),
    'authorised return matches the shortened proposal');

  // The pass expires at the authorised return, not the student's original.
  const passRes = await student.get(`/api/requests/${request.id}/pass`);
  assert.equal(passRes.status, 200, passRes.text);
  assert.equal(passRes.json.pass.expiresAt, final.json.request.approvedReturnAt);

  // Student view: original dates preserved, approved schedule visible, not completed.
  const mine = await student.get(`/api/requests/${request.id}`);
  assert.equal(mine.json.request.status, 'approved', 'approved is not completed');
  assert.equal(mine.json.request.returnAt, request.returnAt, 'original dates still shown to the student');
  assert.equal(mine.json.request.approvedReturnAt, final.json.request.approvedReturnAt);
  assert.ok(mine.json.approvals.some((a) => a.dateReason), 'student sees the adjustment reason');
});

test('changed proposed dates require a reason; long schedules are never auto-blocked', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);

  const request = await submit(student, {
    type: 'external',
    reason: 'Attending a family gathering with my guardian.',
    destination: 'Elmina — family home',
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
    ...departParts(when(30).toISOString()),
    ...returnParts(when(50).toISOString()),
  });
  const proposedDepartAt = request.departAt;

  const noReason = await hm.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'approved',
    proposedDepartAt,
    proposedReturnAt: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
  });
  assert.equal(noReason.status, 400, noReason.text);

  const beforeDepart = await hm.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'approved',
    proposedDepartAt,
    proposedReturnAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
    dateReason: 'Trying an invalid range.',
  });
  assert.equal(beforeDepart.status, 400, beforeDepart.text);

  // None of the invalid attempts consumed the decision.
  const detail = await hm.get(`/api/staff/requests/${request.id}`);
  assert.equal(detail.json.request.status, 'pending');
  assert.equal(detail.json.approvals.length, 0, 'no partial approval was recorded');

  // A 100-hour proposal with a reason is accepted — no universal duration cap.
  const longOk = await hm.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'approved',
    proposedDepartAt,
    proposedReturnAt: new Date(Date.now() + 130 * 3600 * 1000).toISOString(),
    dateReason: 'Family requested the full weekend stay after consultation.',
  });
  assert.equal(longOk.status, 200, longOk.text);
  assert.equal(longOk.json.request.status, 'pending_senior', 'external forwards to senior');
  const hours = (new Date(longOk.json.request.proposedReturnAt)
    - new Date(longOk.json.request.proposedDepartAt)) / 3600000;
  assert.ok(hours > 72, 'the stored proposal itself exceeds 72 hours');
});

test('senior housemaster rejection overrides the housemaster approval', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);
  const senior = createClient(server.base);
  await senior.login('TEST-SENIOR', fixtures.password);

  const request = await submit(student, {
    type: 'external',
    category: 'family',
    reason: 'Attending an extended family naming ceremony with my guardian.',
    destination: 'Takoradi — family home',
    ...departParts(when(40).toISOString()),
    ...returnParts(when(90).toISOString()),
    guardianName: 'Guardian Person',
    guardianPhone: '0240000000',
  });

  const hmOk = await hm.post(`/api/staff/requests/${request.id}/decision`,
    { decision: 'approved', comment: 'Checked with the guardian.' });
  assert.equal(hmOk.status, 200, hmOk.text);
  assert.equal(hmOk.json.request.status, 'pending_senior');

  const noReason = await senior.post(`/api/staff/requests/${request.id}/decision`,
    { decision: 'rejected', comment: '' });
  assert.equal(noReason.status, 400, 'senior rejection also requires a reason');

  const seniorNo = await senior.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'rejected',
    comment: 'Guardian travel plans cannot be confirmed this week.',
  });
  assert.equal(seniorNo.status, 200, seniorNo.text);
  assert.equal(seniorNo.json.request.status, 'rejected', 'final outcome is rejected, not approved');
  assert.equal(seniorNo.json.pass, null, 'no pass is ever issued');

  // Both decisions stay in the history, in order — the HM approval is
  // preserved but does not override the senior's final rejection.
  const staffDetail = await hm.get(`/api/staff/requests/${request.id}`);
  assert.equal(staffDetail.status, 200, staffDetail.text);
  const decisions = staffDetail.json.approvals.map((a) => `${a.stage}:${a.decision}`);
  assert.deepEqual(decisions, ['housemaster:approved', 'senior:rejected']);

  // The request leaves the active approval queues.
  const seniorQueue = await senior.get('/api/staff/requests?status=pending_senior');
  assert.equal(seniorQueue.status, 200);
  assert.ok(!seniorQueue.json.requests.some((r) => r.id === request.id), 'leaves the senior queue');

  // The student sees the final status and the senior's reason.
  const mine = await student.get(`/api/requests/${request.id}`);
  assert.equal(mine.json.request.status, 'rejected');
  assert.ok(mine.json.approvals.some((a) => a.stage === 'senior' && a.decision === 'rejected'
    && a.comment.includes('Guardian travel plans')), 'student sees the senior rejection reason');
});

test('rejected requests show the reason to the student and cannot proceed', async () => {
  const student = await studentClient();
  const hm = createClient(server.base);
  await hm.login('TEST-HM1', fixtures.password);

  const request = await submit(student);

  const noReason = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'rejected', comment: '' });
  assert.equal(noReason.status, 400, 'rejection without a reason is blocked');

  const rejected = await hm.post(`/api/staff/requests/${request.id}/decision`, {
    decision: 'rejected',
    comment: 'Midterm exams block this outing.',
  });
  assert.equal(rejected.status, 200, rejected.text);
  assert.equal(rejected.json.request.status, 'rejected');

  const mine = await student.get(`/api/requests/${request.id}`);
  assert.equal(mine.json.request.status, 'rejected');
  assert.ok(
    mine.json.approvals.some((a) => a.decision === 'rejected' && a.comment.includes('Midterm')),
    'student sees the rejection reason');

  const again = await hm.post(`/api/staff/requests/${request.id}/decision`, { decision: 'approved', comment: 'changed my mind' });
  assert.equal(again.status, 409, 'a rejected request cannot be approved afterwards');

  const queue = await hm.get('/api/staff/requests?status=pending');
  assert.ok(!queue.json.requests.some((r) => r.id === request.id), 'rejected request left the active queue');
});
