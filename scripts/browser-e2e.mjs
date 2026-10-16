/**
 * Browser end-to-end check using Edge headless over the Chrome DevTools Protocol.
 * No extra dependencies: uses Node's built-in WebSocket and fetch.
 *
 * Usage:  node scripts/browser-e2e.mjs [baseUrl]
 * Requires the API to be running (default http://localhost:8787).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = path.join(os.tmpdir(), 'entryout-e2e');
fs.mkdirSync(OUT, { recursive: true });

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('Edge not found; skipping browser check.');
  process.exit(0);
}

const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'entryout-profile-'));
const child = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1366,900',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('DevTools endpoint did not start');
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression, ...args) {
    // CDP only accepts source strings; functions are serialized and invoked
    // with the given JSON arguments.
    let source;
    if (typeof expression === 'function') {
      const argList = args.map((a) => JSON.stringify(a)).join(', ');
      source = `(${expression.toString()})(${argList})`;
    } else if (args.length) {
      throw new Error('evaluate(source) does not take extra arguments');
    } else {
      source = expression;
    }
    const result = await this.send('Runtime.evaluate', {
      expression: source,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result?.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(400);
    await this.waitFor("document.readyState === 'complete'", 15000).catch(() => {});
  }

  async waitFor(expression, timeout = 8000) {
    const started = Date.now();
    for (;;) {
      const value = await this.evaluate(`Boolean(${expression})`).catch(() => false);
      if (value) return true;
      if (Date.now() - started > timeout) throw new Error(`waitFor timed out: ${expression}`);
      await sleep(250);
    }
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 700,
    });
  }

  async screenshot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  await waitForDevtools();
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE)}/`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  const session = new Session(ws);
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  /* ---------- Landing page ---------- */
  await session.goto(`${BASE}/`);
  await session.setViewport(1366, 900);
  await session.waitFor("!!document.querySelector('.hero h1')", 20000);
  const heroText = await session.evaluate("document.querySelector('.hero h1')?.textContent || ''");
  check('landing hero renders', /Your exeat/.test(heroText), heroText.slice(0, 40));
  const steps = await session.evaluate("document.querySelectorAll('.step').length");
  check('landing shows 3 steps', steps === 3, `${steps} steps`);
  const announcementsLoaded = await session.evaluate("document.querySelectorAll('.announce').length");
  check('announcements fetched from API', announcementsLoaded > 0, `${announcementsLoaded} shown`);
  await session.screenshot('01-landing-desktop');
  await session.setViewport(375, 780);
  await sleep(400);
  await session.screenshot('02-landing-mobile');
  const noHScroll = await session.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
  check('landing has no horizontal scroll at 375px', noHScroll);

  /* ---------- Sign in ---------- */
  await session.setViewport(1366, 900);
  await session.goto(`${BASE}/#/signin?role=student`);
  await session.waitFor("!!document.querySelector('#identifier')", 20000);
  await session.evaluate(`
    document.querySelector('#identifier').value = 'MFS/26/0001';
    document.querySelector('#password').value = ${JSON.stringify(process.env.SEED_PASSWORD || 'Entryout!2026')};
    document.querySelector('form').requestSubmit();
  `);
  await session.waitFor("location.hash === '#/app'", 15000).catch(() => {});
  const hashAfterLogin = await session.evaluate('location.hash');
  check('student sign-in reaches dashboard', hashAfterLogin === '#/app', hashAfterLogin);
  await session.waitFor("document.querySelectorAll('.request-card').length >= 1 || document.querySelectorAll('.stat').length >= 3", 15000).catch(() => {});
  const stats = await session.evaluate("document.querySelectorAll('.stat').length");
  check('dashboard renders stat tiles', stats >= 3, `${stats} tiles`);
  const cards = await session.evaluate("document.querySelectorAll('.request-card').length");
  check('dashboard lists seeded requests', cards >= 1, `${cards} cards`);
  await session.screenshot('03-student-dashboard');

  /* ---------- Apply form: validation then submission ---------- */
  await session.goto(`${BASE}/#/app/new?type=internal`);
  await session.waitFor("!!document.querySelector('form')", 20000);
  await session.evaluate("document.querySelector('form').requestSubmit()");
  await sleep(400);
  const summaryShown = await session.evaluate("!!document.querySelector('.error-summary')");
  check('empty form shows an error summary', summaryShown);

  const applied = await session.evaluate(async () => {
    const set = (id, value) => {
      const el = document.querySelector(id);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#category', 'family');
    set('#reason', 'Visiting my guardian in town for the weekend.');
    set('#destination', 'Cape Coast — Ridge home');
    // Depart inside the 30-minute early window so the pass is usable at the gate.
    const depart = new Date(Date.now() + 15 * 60 * 1000);
    const back = new Date(Date.now() + 4 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const d = `${depart.getFullYear()}-${pad(depart.getMonth() + 1)}-${pad(depart.getDate())}`;
    const r = `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())}`;
    const hh = `${pad(depart.getHours())}:${pad(depart.getMinutes())}`;
    set('#departDate', d); set('#departTime', hh);
    set('#returnDate', r); set('#returnTime', '23:30');
    document.querySelector('form').requestSubmit();
    await new Promise((res) => setTimeout(res, 600));
    const reviewBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit request');
    if (!reviewBtn) return { ok: false, reason: 'review step missing' };
    reviewBtn.click();
    await new Promise((res) => setTimeout(res, 2500));
    return { ok: true, hash: location.hash };
  });
  check('student can submit a request through the UI', applied.ok && /#\/app\/requests\//.test(applied.hash || ''), JSON.stringify(applied));
  const newRequestId = (applied.hash || '').split('/').pop() || '';

  await session.evaluate("location.hash = '#/app'; 'nav'");
  await session.waitFor("document.querySelectorAll('.request-card').length >= 1", 15000).catch(() => {});
  const statsAfter = await session.evaluate("document.querySelectorAll('.stat').length");
  const cardsAfter = await session.evaluate("document.querySelectorAll('.request-card').length");
  console.log(`INFO  student dashboard after submit: ${statsAfter} tiles, ${cardsAfter} cards`);

  /* ---------- Housemaster approval ---------- */
  const loggedOut = await session.evaluate(async () => {
    const buttons = [...document.querySelectorAll('#header-actions button, #mobile-nav button')];
    const btn = buttons.find((b) => b.textContent.trim() === 'Sign out');
    if (!btn) return { ok: false, reason: 'no sign out button' };
    btn.click();
    await new Promise((res) => setTimeout(res, 2000));
    return { ok: true, hash: location.hash, stillSignedIn: !!document.querySelector('#header-actions a[href="#/app"]') };
  });
  check('student can sign out from the header', loggedOut.ok && !loggedOut.stillSignedIn, JSON.stringify(loggedOut));
  await session.waitFor("!!document.querySelector('#header-actions a[href=\"#/signin\"]')", 10000).catch(() => {});

  await session.evaluate("location.hash = '#/signin'; 'nav'");
  await session.waitFor("!!document.querySelector('#identifier')", 15000);
  await session.evaluate(`
    document.querySelector('#identifier').value = 'HM-BALMER';
    document.querySelector('#password').value = ${JSON.stringify(process.env.SEED_PASSWORD || 'Entryout!2026')};
    document.querySelector('form').requestSubmit();
  `);
  await session.waitFor("location.hash === '#/staff'", 15000).catch(() => {});
  const staffHash = await session.evaluate('location.hash');
  check('housemaster sign-in reaches the review queue', staffHash === '#/staff', staffHash);
  await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
  const rows = await session.evaluate("document.querySelectorAll('.table tbody tr').length");
  check('review queue shows table rows', rows >= 1, `${rows} rows`);
  await session.screenshot('05-staff-queue');

  // Open the request the student just submitted, directly, then approve it.
  await session.evaluate((id) => { location.hash = `#/staff/requests/${id}`; 'nav'; }, newRequestId);
  await session.waitFor("!!document.querySelector('button') && document.body.textContent.includes('Approve')", 15000)
    .catch(() => {});
  const approvedViaUi = await session.evaluate(async () => {
    const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
    if (!approve) return { ok: false, reason: 'no approve button' };
    approve.click();
    await new Promise((res) => setTimeout(res, 600));
    const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
    if (!confirm) return { ok: false, reason: 'no confirm dialog' };
    confirm.click();
    await new Promise((res) => setTimeout(res, 2500));
    const code = document.querySelector('.pass-code-value');
    return { ok: true, passCode: code ? code.textContent.trim() : null };
  });
  check('housemaster can approve through the UI dialog', approvedViaUi.ok, approvedViaUi.reason || 'approved');
  check('approval immediately issues a digital pass', !!approvedViaUi.passCode, approvedViaUi.passCode || 'no pass card');
  const passCode = approvedViaUi.passCode || '';
  const cleanCode = passCode.replace(/\s+/g, '');
  await session.screenshot('06-staff-decision');

  /* ---------- Student sees the approved pass ---------- */
  const loggedOutHm = await session.evaluate(async () => {
    const btn = [...document.querySelectorAll('#header-actions button')].find((b) => b.textContent.trim() === 'Sign out');
    if (!btn) return { ok: false, reason: 'no sign out button' };
    btn.click();
    await new Promise((res) => setTimeout(res, 2000));
    return { ok: true, stillSignedIn: !!document.querySelector('#header-actions a[href="#/staff"]') };
  });
  check('housemaster can sign out from the header', loggedOutHm.ok && !loggedOutHm.stillSignedIn, JSON.stringify(loggedOutHm));
  await session.waitFor("!!document.querySelector('#header-actions a[href=\"#/signin\"]')", 10000).catch(() => {});

  await session.evaluate("location.hash = '#/signin?role=student'; 'nav'");
  await session.waitFor("!!document.querySelector('#identifier')", 15000);
  await session.evaluate(`
    document.querySelector('#identifier').value = 'MFS/26/0001';
    document.querySelector('#password').value = ${JSON.stringify(process.env.SEED_PASSWORD || 'Entryout!2026')};
    document.querySelector('form').requestSubmit();
  `);
  await session.waitFor("location.hash === '#/app'", 15000).catch(() => {});
  await session.evaluate((id) => { location.hash = `#/app/requests/${id}`; 'nav'; }, newRequestId);
  await session.waitFor("!!document.querySelector('.pass-code-value') || !!document.querySelector('.status-panel')", 15000)
    .catch(() => {});
  const studentPass = await session.evaluate((expected) => {
    const code = document.querySelector('.pass-code-value');
    return {
      present: !!code,
      matches: code ? code.textContent.replace(/\s+/g, '') === expected : false,
      hasQr: !!document.querySelector('.pass-card svg, .pass-qr img, .pass-card img'),
    };
  }, cleanCode);
  check('student sees their digital pass after approval', studentPass.present && studentPass.matches, JSON.stringify(studentPass));
  await session.screenshot('04-student-pass');

  const loggedOut2 = await session.evaluate(async () => {
    const buttons = [...document.querySelectorAll('#header-actions button, #mobile-nav button')];
    const btn = buttons.find((b) => b.textContent.trim() === 'Sign out');
    if (!btn) return { ok: false, reason: 'no sign out button' };
    btn.click();
    await new Promise((res) => setTimeout(res, 2000));
    return { ok: true, stillSignedIn: !!document.querySelector('#header-actions a[href="#/app"]') };
  });
  check('student can sign out before the gate step', loggedOut2.ok && !loggedOut2.stillSignedIn, JSON.stringify(loggedOut2));
  await session.waitFor("!!document.querySelector('#header-actions a[href=\"#/signin\"]')", 10000).catch(() => {});

  await session.evaluate("location.hash = '#/signin'; 'nav'");
  await session.waitFor("!!document.querySelector('#identifier')", 15000);
  await session.evaluate(`
    document.querySelector('#identifier').value = 'GATE01';
    document.querySelector('#password').value = ${JSON.stringify(process.env.SEED_PASSWORD || 'Entryout!2026')};
    document.querySelector('form').requestSubmit();
  `);
  await session.waitFor("location.hash === '#/gate'", 15000).catch(() => {});
  const gateHash = await session.evaluate('location.hash');
  check('gate officer sign-in reaches the gate screen', gateHash === '#/gate', gateHash);

  if (cleanCode) {
    const gateResult = await session.evaluate(async (code) => {
      const input = document.querySelector('#pass-code');
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').requestSubmit();
      await new Promise((res) => setTimeout(res, 2500));
      const verdict = document.querySelector('.gate-verdict');
      return {
        verdict: verdict?.className || '',
        text: verdict?.textContent?.trim().slice(0, 120) || '',
        hasStudent: !!document.querySelector('.gate-result .detail-grid'),
        reasonHidden: document.body.textContent.includes('Reason for leaving is not shown at the gate'),
      };
    }, cleanCode);
    check('gate verification accepts the pass inside its window', gateResult.verdict.includes('is-valid'), gateResult.text);
    check('gate result shows student identity', gateResult.hasStudent);
    check('gate never shows the reason for leaving', gateResult.reasonHidden);
    await session.screenshot('07-gate-verify');

    const departure = await session.evaluate(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Record departure/.test(b.textContent));
      if (!btn) return { ok: false, reason: 'no departure button' };
      btn.click();
      await new Promise((res) => setTimeout(res, 2500));
      const verdict = document.querySelector('.gate-verdict');
      return {
        ok: true,
        verdict: verdict?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '',
        hasReturnAction: [...document.querySelectorAll('button')].some((b) => /Record return/.test(b.textContent)),
        logged: document.body.textContent.includes('Departed'),
      };
    });
    check('gate can record the departure in the UI', departure.ok, departure.reason || departure.verdict);
    check('departure switches the pass to “already departed” state', departure.ok && departure.hasReturnAction,
      departure.verdict || '');
    check('departure appears in recent gate activity', departure.ok && departure.logged);
    await session.screenshot('08-gate-departed');
  }

  /* ---------- Announcements + help + 404 ---------- */
  await session.goto(`${BASE}/#/announcements`);
  await session.waitFor("document.querySelectorAll('.announce').length >= 2", 15000).catch(() => {});
  const announceCount = await session.evaluate("document.querySelectorAll('.announce').length");
  check('announcements page lists notices', announceCount >= 2, `${announceCount} notices`);
  await session.goto(`${BASE}/#/help`);
  await session.waitFor("document.querySelectorAll('.help-step').length >= 5", 15000).catch(() => {});
  const helpSteps = await session.evaluate("document.querySelectorAll('.help-step').length");
  check('how-it-works page renders', helpSteps >= 5, `${helpSteps} steps`);
  await session.goto(`${BASE}/#/nonsense`);
  await session.waitFor("document.body.textContent.includes('Page not found')", 15000).catch(() => {});
  const nf = await session.evaluate("document.body.textContent.includes('Page not found')");
  check('unknown route shows the not-found page', nf);

  /* ---------- Access control in the browser ---------- */
  await session.goto(`${BASE}/#/admin`);
  await sleep(1500);
  const redirected = await session.evaluate('location.hash');
  check('gate session cannot open /#/admin', redirected !== '#/admin', redirected);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  console.log(`Screenshots: ${OUT}`);
  ws.close();
  child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Browser E2E failed:', err);
  child.kill();
  process.exit(1);
});
