/**
 * Browser check for the temporary development dashboard bypass.
 *
 * Usage:
 *   EXPECT_BYPASS=on  node scripts/dev-bypass-e2e.mjs [baseUrl]  # default
 *   EXPECT_BYPASS=off node scripts/dev-bypass-e2e.mjs [baseUrl]
 *
 * "on"  : homepage portal buttons open the real dashboards directly (dev).
 * "off" : same buttons fall back to the original sign-in pages (restored flow).
 *
 * Requires the API running locally (default http://localhost:8787).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] || 'http://localhost:8787';
const EXPECT = (process.env.EXPECT_BYPASS || 'on').toLowerCase() === 'off' ? 'off' : 'on';
const OUT = path.join(os.tmpdir(), 'entryout-e2e');
fs.mkdirSync(OUT, { recursive: true });

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));
if (!EDGE) {
  console.error('Edge not found; skipping browser check.');
  process.exit(0);
}

const PORT = 9351;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'entryout-bypass-'));
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1366,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleErrors = [];
const badResponses = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForDevtools() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up */ }
    await sleep(200);
  }
  throw new Error('DevTools did not start');
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
      if (msg.method === 'Network.responseReceived') {
        const { status, url } = msg.params.response;
        const benignAuthProbe = status === 401 && url.includes('/api/auth/me');
        // In "off" mode the server's 404 on dev-session is the intended,
        // tested behaviour (frontend falls back to sign-in).
        const expectedBypassRejection = EXPECT === 'off' && status === 404 && url.includes('/api/auth/dev-session');
        if (status >= 400 && !benignAuthProbe && !expectedBypassRejection) badResponses.push(`${status} ${url}`);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async ev(source) {
    const r = await this.send('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }

  async evFn(fn, ...args) {
    const source = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(', ')})`;
    return this.ev(source);
  }

  async waitFor(expression, timeout = 20000) {
    const started = Date.now();
    for (;;) {
      const value = await this.ev(`Boolean(${expression})`).catch(() => false);
      if (value) return true;
      if (Date.now() - started > timeout) return false;
      await sleep(250);
    }
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(400);
    await this.waitFor("document.readyState === 'complete'", 15000).catch(() => {});
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }
}

async function clickText(session, selector, text) {
  return session.evFn((sel, label) => {
    const btn = [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().includes(label));
    if (!btn) return false;
    btn.click();
    return true;
  }, selector, text);
}

async function signOutIfSignedIn(session, expectedHashWhenDone = '#/') {
  const clicked = await session.evFn(() => {
    const btn = [...document.querySelectorAll('#header-actions button')].find((b) => b.textContent.trim() === 'Sign out');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) return false;
  await session.waitFor(`location.hash === '${expectedHashWhenDone}'`, 12000);
  return session.waitFor("!!document.querySelector('#header-actions a[href=\"#/signin\"]')", 10000);
}

async function main() {
  await waitForDevtools();
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}/`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  const s = new Session(ws);
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Network.enable');

  console.log(`\n== dev-bypass browser check (expect bypass: ${EXPECT}) ==\n`);

  /* ---- Test A: homepage intact ---- */
  await s.goto(`${BASE}/`);
  await s.waitFor("!!document.querySelector('.hero h1')", 25000);
  const hero = await s.ev("document.querySelector('.hero h1')?.textContent || ''");
  check('A: homepage hero renders unchanged', /Your exeat/.test(hero), hero.slice(0, 40));
  const buttons = await s.ev("[...document.querySelectorAll('.hero-actions button')].map(b => b.textContent.trim()).join('|')");
  check('A: both portal buttons present in hero',
    buttons.includes('Student portal') && buttons.includes('Staff sign in'), buttons);
  const headerBtns = await s.ev("[...document.querySelectorAll('#header-actions a')].map(a => a.textContent.trim()).join('|')");
  check('A: header portal buttons present', headerBtns.includes('Student portal') && headerBtns.includes('Staff sign in'), headerBtns);
  check('A: three how-it-works steps', await s.ev("document.querySelectorAll('.step').length") === 3);
  await s.waitFor("document.querySelectorAll('.announce').length >= 1", 15000).catch(() => {});
  check('A: announcements section loads', await s.ev("document.querySelectorAll('.announce').length") >= 1,
    `${await s.ev("document.querySelectorAll('.announce').length")} shown`);
  await s.screenshot('bypass-01-home');

  if (EXPECT === 'on') {
    /* ---- Test B: Student portal → student dashboard ---- */
    check('B: Student portal click is wired', await clickText(s, '.hero-actions button', 'Student portal'));
    const onDashboard = await s.waitFor("location.hash === '#/app'", 20000);
    check('B: Student portal opens the student dashboard directly', onDashboard,
      await s.ev('location.hash'));
    check('B: no sign-in form shown', await s.ev("!document.querySelector('#identifier')"));
    await s.waitFor("document.querySelectorAll('.stat').length >= 3 || document.querySelectorAll('.request-card').length >= 1", 20000);
    check('B: dashboard stats render', await s.ev("document.querySelectorAll('.stat').length") >= 3,
      `${await s.ev("document.querySelectorAll('.stat').length")} tiles`);
    check('B: request list renders', await s.ev("document.querySelectorAll('.request-card').length") >= 1,
      `${await s.ev("document.querySelectorAll('.request-card').length")} cards`);
    check('B: notifications section present', await s.ev("document.body.textContent.includes('Notifications')"));
    const nav = await s.ev("[...document.querySelectorAll('.main-nav a')].map(a => a.textContent).join(', ')");
    check('B: student navigation intact', nav.includes('Dashboard') && nav.includes('Apply'), nav);

    await s.ev("location.hash = '#/app/new'; 'nav'");
    await s.waitFor("!!document.querySelector('form')", 20000);
    check('B: exeat application form opens', await s.ev("document.querySelector('h1')?.textContent.includes('Apply')"),
      await s.ev("document.querySelector('h1')?.textContent || ''"));
    await s.screenshot('bypass-02-student-apply');

    await s.ev("location.hash = '#/app'; 'nav'");
    await s.waitFor("document.querySelectorAll('.request-card').length >= 1", 15000);
    const openedDetail = await s.evFn(async () => {
      const card = document.querySelector('.request-card a.row-link, .request-card a[href*="#/app/requests/"], .request-card');
      const link = document.querySelector('.request-card a[href*="#/app/requests/"]');
      (link || card)?.click();
      await new Promise((r) => setTimeout(r, 1500));
      return document.body.textContent.includes('Request details');
    });
    check('B: request detail (status, timeline, pass) opens', openedDetail);
    await s.screenshot('bypass-03-student-detail');
    check('B: student can sign out again', await signOutIfSignedIn(s), await s.ev('location.hash'));

    /* ---- Test C: Staff sign in → staff dashboard ---- */
    check('C: Staff sign in click is wired', await clickText(s, '.hero-actions button', 'Staff sign in'));
    const onStaff = await s.waitFor("location.hash === '#/staff'", 20000);
    check('C: Staff sign in opens the staff dashboard directly', onStaff, await s.ev('location.hash'));
    check('C: no sign-in form shown', await s.ev("!document.querySelector('#identifier')"));
    await s.waitFor("document.querySelectorAll('.table tbody tr').length >= 1 || !!document.querySelector('#staff-search')", 20000);
    check('C: review queue table + filters render',
      await s.ev("!!document.querySelector('#staff-search')") && await s.ev("document.querySelectorAll('.table tbody tr').length") >= 1,
      `${await s.ev("document.querySelectorAll('.table tbody tr').length")} rows`);
    const staffNav = await s.ev("[...document.querySelectorAll('.main-nav a')].map(a => a.textContent).join(', ')");
    check('C: staff navigation intact', staffNav.includes('Review queue'), staffNav);
    const openedStaffDetail = await s.evFn(async () => {
      const link = document.querySelector('.table tbody tr a[href*="#/staff/requests/"]');
      if (!link) return { found: false };
      link.click();
      await new Promise((r) => setTimeout(r, 1500));
      return {
        found: true,
        detail: document.body.textContent.includes('Decision history') || document.body.textContent.includes('Timeline'),
        decisionTools: !!document.querySelector('#decision-comment') ||
          [...document.querySelectorAll('button')].some((b) => /Approve|Reject|Return/.test(b.textContent)),
        studentCard: document.body.textContent.includes('Index number'),
      };
    });
    check('C: staff request detail opens', openedStaffDetail.found && openedStaffDetail.detail, JSON.stringify(openedStaffDetail));
    check('C: decision tools or history visible for review', openedStaffDetail.decisionTools, JSON.stringify(openedStaffDetail));
    check('C: student information shown to staff', openedStaffDetail.studentCard);
    await s.screenshot('bypass-04-staff-detail');
    check('C: staff can sign out again', await signOutIfSignedIn(s), await s.ev('location.hash'));
  } else {
    /* ---- EXPECT=off: original sign-in flow restored ---- */
    check('B(off): Student portal falls back to student sign-in',
      await clickText(s, '.hero-actions button', 'Student portal'));
    const studentFallback = await s.waitFor("location.hash === '#/signin?role=student'", 20000);
    check('B(off): lands on the original student sign-in page', studentFallback, await s.ev('location.hash'));
    await s.waitFor("!!document.querySelector('#identifier')", 15000);
    check('B(off): student sign-in form is present', await s.ev("!!document.querySelector('#identifier')"));
    await s.screenshot('bypass-02-off-student-signin');

    await s.goto(`${BASE}/`);
    await s.waitFor("!!document.querySelector('.hero h1')", 20000);
    check('C(off): Staff sign in falls back to staff sign-in',
      await clickText(s, '.hero-actions button', 'Staff sign in'));
    const staffFallback = await s.waitFor("location.hash === '#/signin'", 20000);
    check('C(off): lands on the original staff sign-in page', staffFallback, await s.ev('location.hash'));
    await s.waitFor("!!document.querySelector('#identifier')", 15000);
    check('C(off): staff sign-in form is present', await s.ev("!!document.querySelector('#identifier')"));
    await s.screenshot('bypass-03-off-staff-signin');
  }

  /* ---- Test D: authentication pages preserved ---- */
  await s.goto(`${BASE}/#/signin`);
  await s.waitFor("!!document.querySelector('#identifier')", 15000);
  check('D: student/staff sign-in page still exists', await s.ev("!!document.querySelector('#identifier')"));
  await s.goto(`${BASE}/#/signin?role=student`);
  await s.waitFor("!!document.querySelector('#identifier')", 15000);
  check('D: student sign-in variant still exists', await s.ev("!!document.querySelector('#identifier')"));
  await s.goto(`${BASE}/#/register`);
  await s.waitFor("document.body.textContent.includes('Create your student account')", 15000);
  check('D: account registration page still exists',
    await s.ev("document.body.textContent.includes('Create your student account')"));

  /* ---- Test E: unrelated pages + console health ---- */
  await s.goto(`${BASE}/#/announcements`);
  await s.waitFor("document.querySelectorAll('.announce').length >= 2", 15000).catch(() => {});
  check('E: announcements page works', await s.ev("document.querySelectorAll('.announce').length") >= 2);
  await s.goto(`${BASE}/#/help`);
  await s.waitFor("document.querySelectorAll('.help-step').length >= 5", 15000).catch(() => {});
  check('E: how-it-works page works', await s.ev("document.querySelectorAll('.help-step').length") >= 5);
  await s.goto(`${BASE}/#/nonsense`);
  await s.waitFor("document.body.textContent.includes('Page not found')", 15000).catch(() => {});
  check('E: 404 route works', await s.ev("document.body.textContent.includes('Page not found')"));

  check('E: no JavaScript console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('E: no failed (4xx/5xx) requests', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (bypass: ${EXPECT})`);
  ws.close();
  child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Dev-bypass browser check failed:', err);
  child.kill();
  process.exit(1);
});
