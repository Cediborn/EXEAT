/**
 * Demo-mode browser end-to-end check.
 *
 * Serves the repository as a static site with a demo-mode config.js
 * (apiBase '', demoMode true) — exactly what the Vercel/GitHub Pages
 * demonstration builds ship — then drives the full §14 flows headless in
 * Edge over the Chrome DevTools Protocol, no extra dependencies:
 *
 *   student apply → confirmation → staff decisions (internal + external)
 *   → pass issued → gate depart/return → completed; admin announcement;
 *   draft persistence; role picker; access control; responsive check.
 *
 * Also runs the §10 approval-workflow scenarios against the demo adapter:
 * return-date adjustment (reason required), rejection (reason required,
 * queue removal, student visibility), return-for-correction + resubmit,
 * senior visibility of the housemaster's decision, authorised vs original
 * dates, approved ≠ completed, queue search/filters, and a page-error check.
 * Plus: contextual duration review (no universal 72-hour cap — long requests
 * get a warning and can be approved as submitted), senior rejection
 * overriding the housemaster's earlier approval (history preserved, student
 * sees the reason), and the charcoal dark theme (default dark, labelled
 * toggle, persistence across reloads).
 *
 * Usage:  node scripts/demo-e2e.mjs
 *         DEMO_E2E_BASE=https://exeat-inky.vercel.app node scripts/demo-e2e.mjs
 *         (the BASE form drives an already-deployed demo build instead of a
 *         local static server; browser profile is still fresh)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'entryout-demo-e2e');
fs.mkdirSync(OUT, { recursive: true });

const DEMO_CONFIG = "window.ENTRYOUT_CONFIG = { apiBase: '', appName: 'Entryout', devBypassAuth: false, demoMode: true };\n";
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (urlPath === '/config.js') {
    res.writeHead(200, { 'content-type': MIME['.js'] });
    res.end(DEMO_CONFIG);
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p));

if (!EDGE) {
  console.error('Edge not found; skipping demo browser check.');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 4173;
const stopServer = () => { try { server.close(); } catch { /* never started (remote base) */ } };

async function listen() {
  for (let p = PORT; p < PORT + 20; p += 1) {
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(p, '127.0.0.1', () => resolve(true));
      setTimeout(() => {}, 0);
    });
    if (ok) return p;
  }
  throw new Error('Could not bind a port for the static demo server');
}

const browserPort = 9444;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'entryout-demo-profile-'));

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const REMOTE = process.env.DEMO_E2E_BASE ? process.env.DEMO_E2E_BASE.replace(/\/+$/, '') : null;
  let BASE;
  if (REMOTE) {
    BASE = REMOTE;
    console.log(`Using deployed demo at ${BASE}`);
  } else {
    const basePort = await listen();
    BASE = `http://127.0.0.1:${basePort}`;
    console.log(`Demo static server on ${BASE} (config.js → demoMode: true)`);
  }

  const child = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${browserPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1366,900',
    'about:blank',
  ], { stdio: 'ignore' });

  async function waitForDevtools() {
    for (let i = 0; i < 50; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${browserPort}/json/version`);
        if (res.ok) return;
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

  async function signOut(session) {
    const done = await session.evaluate(async () => {
      const btn = [...document.querySelectorAll('#header-actions button, #mobile-nav button')]
        .find((b) => b.textContent.trim() === 'Sign out');
      if (!btn) return { ok: false, reason: 'no sign out button' };
      btn.click();
      await new Promise((res) => setTimeout(res, 1500));
      return { ok: true, stillSignedIn: !!document.querySelector('#header-actions a[href^="#/app"], #header-actions a[href^="#/staff"], #header-actions a[href^="#/gate"], #header-actions a[href^="#/admin"]') };
    });
    await session.waitFor("!!document.querySelector('#header-actions a[href=\"#/signin\"]')", 10000).catch(() => {});
    return done;
  }

  async function staffSignIn(session, roleValue) {
    await session.evaluate("location.hash = '#/signin'; 'nav'");
    await sleep(300);
    // Use the header/landing portal path: click "Staff sign in" in header.
    const opened = await session.evaluate(async () => {
      const btn = [...document.querySelectorAll('#header-actions a')].find((b) => /Staff sign in/.test(b.textContent));
      if (!btn) return { ok: false, reason: 'no staff sign in button' };
      btn.click();
      await new Promise((res) => setTimeout(res, 800));
      return { ok: !!document.querySelector('.dialog') };
    });
    if (!opened.ok) return { ok: false, reason: opened.reason || 'dialog did not open' };
    const picked = await session.evaluate(async (value) => {
      const radio = document.querySelector(`.dialog input[value="${value}"]`);
      if (!radio) return { ok: false, reason: `no radio for ${value}` };
      radio.checked = true;
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Enter workspace/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no confirm button' };
      confirm.click();
      await new Promise((res) => setTimeout(res, 2000));
      return { ok: true, hash: location.hash };
    }, roleValue);
    return picked;
  }

  /**
   * Student submits a request through the real form, then opens its detail
   * via "Track this request" so the caller gets { ok, reference, id }.
   */
  async function submitRequest(session, opts) {
    return session.evaluate(async (o) => {
      location.hash = '#/app/new';
      await new Promise((r) => setTimeout(r, 900));
      if (!document.querySelector('#reason')) {
        const want = o.type === 'external' ? 'External' : 'Internal';
        const card = [...document.querySelectorAll('.type-card')].find((c) => c.textContent.includes(want));
        if (!card) return { ok: false, reason: `no ${want} type card` };
        card.click();
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!document.querySelector('#reason')) return { ok: false, reason: 'form not shown' };
      const set = (id, value) => {
        const el = document.querySelector(id);
        if (!el) return;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('#category', o.category || 'family');
      set('#reason', o.reason);
      set('#destination', o.destination);
      const depart = new Date(Date.now() + o.departInHours * 3600 * 1000);
      const back = new Date(Date.now() + o.returnInHours * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      set('#departDate', dstr(depart)); set('#departTime', hm(depart));
      set('#returnDate', dstr(back)); set('#returnTime', hm(back));
      if (o.type === 'external') {
        set('#guardianName', 'Ama Mensah');
        set('#guardianPhone', '0241234567');
      }
      document.querySelector('form').requestSubmit();
      await new Promise((r) => setTimeout(r, 700));
      const submitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit request');
      if (!submitBtn) return { ok: false, reason: 'review step missing submit' };
      submitBtn.click();
      await new Promise((r) => setTimeout(r, 1800));
      if (!document.body.textContent.includes('Request submitted')) return { ok: false, reason: 'no confirmation' };
      const reference = (document.body.textContent.match(/EXE-\d{4}-\d{4}/) || [null])[0];
      const track = [...document.querySelectorAll('button')].find((b) => /Track this request/.test(b.textContent));
      if (!track) return { ok: false, reason: 'no track button', reference };
      track.click();
      await new Promise((r) => setTimeout(r, 1200));
      const id = (location.hash.match(/#\/app\/requests\/(.+)$/) || [null, null])[1];
      return { ok: true, reference, id };
    }, opts);
  }

  try {
    await waitForDevtools();
    const target = await fetch(`http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(BASE)}/`, { method: 'PUT' }).then((r) => r.json());
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    const session = new Session(ws);
    await session.send('Page.enable');
    await session.send('Runtime.enable');

    // Page-error collector for the §10 regression check.
    let pageErrors = 0;
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Runtime.exceptionThrown') {
          pageErrors += 1;
          console.log('PAGE EXCEPTION:',
            msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || '');
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
          pageErrors += 1;
          console.log('PAGE ERROR:',
            (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
        }
      } catch { /* ignore malformed frames */ }
    });

    /* ---------- 1. Landing: demo banner + SVG icons, no feature emoji ---------- */
    await session.goto(`${BASE}/`);
    await session.setViewport(1366, 900);
    await session.waitFor("!!document.querySelector('.hero h1')", 20000);
    const hero = await session.evaluate("document.querySelector('.hero h1')?.textContent || ''");
    check('landing hero renders', /Your exeat/.test(hero), hero.slice(0, 40));
    const demoBanner = await session.evaluate("document.body.textContent.includes('Demo mode')");
    check('demo-mode banner is shown', demoBanner);
    const iconSvgs = await session.evaluate("document.querySelectorAll('.feature-icon svg').length");
    check('feature icons are inline SVGs', iconSvgs === 3, `${iconSvgs} svgs`);
    const featureEmoji = await session.evaluate("(/[⏱🔐📱]/.test(document.querySelector('.feature-grid')?.textContent || ''))");
    check('feature section has no emoji illustrations', !featureEmoji);
    const annCount = await session.evaluate("document.querySelectorAll('.announce').length");
    check('seeded announcements render on landing', annCount >= 2, `${annCount} notices`);
    await session.screenshot('01-landing');

    /* ---------- 2. Student portal button → empty dashboard ---------- */
    const studentEntry = await session.evaluate(async () => {
      const btn = [...document.querySelectorAll('.hero-actions button')].find((b) => /Student portal/.test(b.textContent));
      if (!btn) return { ok: false, reason: 'no student portal button' };
      btn.click();
      await new Promise((res) => setTimeout(res, 2000));
      return { ok: true, hash: location.hash };
    });
    check('student portal button opens the dashboard directly', studentEntry.ok && studentEntry.hash === '#/app', JSON.stringify(studentEntry));
    await session.waitFor("!!document.querySelector('.empty-state') || document.querySelectorAll('.request-card').length > 0", 15000).catch(() => {});
    const emptyDash = await session.evaluate(() => ({
      empty: document.body.textContent.includes('No exeat requests yet'),
      stats: document.querySelectorAll('.stat').length,
      badge: document.querySelector('.demo-role-badge')?.textContent || '',
    }));
    check('fresh demo dashboard shows the empty state', emptyDash.empty, JSON.stringify(emptyDash));
    check('dashboard renders stat tiles from real records', emptyDash.stats >= 3, `${emptyDash.stats} tiles`);
    check('header shows the active demo role badge', /Demo · Student/.test(emptyDash.badge), emptyDash.badge);
    await session.screenshot('02-student-empty');

    /* ---------- 3. Apply form: validation, draft persistence, submit ---------- */
    await session.goto(`${BASE}/#/app/new`);
    await session.waitFor("document.querySelectorAll('.type-card').length === 2", 15000);
    await session.evaluate(async () => {
      const card = [...document.querySelectorAll('.type-card')].find((c) => /Internal exeat/.test(c.textContent));
      card.click();
      await new Promise((res) => setTimeout(res, 500));
    });
    await session.waitFor("!!document.querySelector('#reason')", 15000);

    // Draft persistence: type a reason, reload, value must survive.
    const draftOk = await session.evaluate(async () => {
      const el = document.querySelector('#reason');
      el.value = 'Draft check — visiting family in town this weekend with plans confirmed.';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 300));
      location.reload();
      return true;
    });
    await sleep(2500);
    await session.waitFor("!!document.querySelector('#reason') || !!document.querySelector('.type-card')", 15000).catch(() => {});
    const draftRestored = await session.evaluate(() => {
      const el = document.querySelector('#reason');
      return el ? el.value.slice(0, 20) : null;
    });
    check('apply draft survives a page reload', draftRestored === 'Draft check — visti' || (draftRestored || '').startsWith('Draft check'), String(draftRestored));

    // Full submit: internal, departing inside the early window so the gate can verify it.
    const applied = await session.evaluate(async () => {
      const set = (id, value) => {
        const el = document.querySelector(id);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('#category', 'family');
      set('#reason', 'Visiting my guardian in town for the weekend with confirmed plans.');
      set('#destination', 'Cape Coast — Ridge home');
      const depart = new Date(Date.now() + 10 * 60 * 1000);
      const back = new Date(Date.now() + 4 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      set('#departDate', `${depart.getFullYear()}-${pad(depart.getMonth() + 1)}-${pad(depart.getDate())}`);
      set('#departTime', hhmm(depart));
      set('#returnDate', `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())}`);
      set('#returnTime', hhmm(back));
      // "Review request" is this form's submit; the next screen is the review step.
      document.querySelector('form').requestSubmit();
      await new Promise((res) => setTimeout(res, 800));
      const submitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit request');
      if (!submitBtn) return { ok: false, reason: 'review step missing submit', hash: location.hash };
      submitBtn.click();
      await new Promise((res) => setTimeout(res, 2000));
      return {
        ok: true,
        confirmed: document.body.textContent.includes('Request submitted'),
        reference: (document.body.textContent.match(/EXE-\d{4}-\d{4}/) || [null])[0],
      };
    });
    check('student can submit through form → review → confirmation', applied.ok && applied.confirmed, JSON.stringify(applied));
    check('confirmation shows the human-readable reference', /^EXE-\d{4}-\d{4}$/.test(applied.reference || ''), applied.reference || 'none');
    await session.screenshot('03-confirmation');
    const internalRef = applied.reference;

    // Track from the confirmation step.
    const tracked = await session.evaluate(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Track this request/.test(b.textContent));
      if (!btn) return { ok: false, reason: 'no track button' };
      btn.click();
      await new Promise((res) => setTimeout(res, 1500));
      return { ok: /#\/app\/requests\//.test(location.hash), hash: location.hash };
    });
    check('confirmation “Track this request” opens the detail page', tracked.ok, JSON.stringify(tracked));

    /* ---------- 4. Housemaster approves via the staff role picker ---------- */
    const out1 = await signOut(session);
    check('student can sign out', out1.ok && !out1.stillSignedIn, JSON.stringify(out1));

    const hmSignIn = await staffSignIn(session, 'housemaster');
    check('staff role picker signs in the housemaster', hmSignIn.ok && hmSignIn.hash === '#/staff', JSON.stringify(hmSignIn));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1 || !!document.querySelector('.empty-state')", 15000).catch(() => {});
    const queueRows = await session.evaluate("document.querySelectorAll('.table tbody tr').length");
    check('review queue lists the submitted request', queueRows >= 1, `${queueRows} rows`);
    const queueChip = await session.evaluate("document.querySelector('.summary-chip')?.textContent || ''");
    check('summary chips show the pending count', /1/.test(queueChip), queueChip);
    await session.screenshot('04-staff-queue');

    await session.evaluate(() => { location.hash = '#/staff'; 'nav'; });
    await sleep(600);
    const approved = await session.evaluate(async () => {
      const link = [...document.querySelectorAll('.table tbody a')][0];
      if (!link) return { ok: false, reason: 'no queue link' };
      link.click();
      await new Promise((res) => setTimeout(res, 1500));
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button' };
      approve.click();
      await new Promise((res) => setTimeout(res, 600));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no confirm dialog' };
      confirm.click();
      await new Promise((res) => setTimeout(res, 2000));
      const code = document.querySelector('.pass-code-value');
      return { ok: true, passCode: code ? code.textContent.trim() : null };
    });
    check('housemaster approves through the confirmation dialog', approved.ok, approved.reason || 'approved');
    check('approval immediately issues a digital pass', !!approved.passCode, approved.passCode || 'no pass');
    const passCode = (approved.passCode || '').replace(/\s+/g, '');
    await session.screenshot('05-staff-approved');

    /* ---------- 5. Gate: verify, depart, return ---------- */
    const out2 = await signOut(session);
    check('housemaster can sign out', out2.ok && !out2.stillSignedIn, JSON.stringify(out2));

    const gateSignIn = await staffSignIn(session, 'gate');
    check('role picker signs in the gate officer', gateSignIn.ok && gateSignIn.hash === '#/gate', JSON.stringify(gateSignIn));

    if (passCode) {
      const gateFlow = await session.evaluate(async (code) => {
        const input = document.querySelector('#pass-code');
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('form').requestSubmit();
        await new Promise((res) => setTimeout(res, 1500));
        const verdict = document.querySelector('.gate-verdict');
        const valid = verdict?.className.includes('is-valid') || false;
        const reasonHidden = document.body.textContent.includes('Reason for leaving is not shown at the gate');
        const departBtn = [...document.querySelectorAll('button')].find((b) => /Record departure/.test(b.textContent));
        if (!departBtn) return { valid, reasonHidden, departed: false, reason: 'no departure button' };
        departBtn.click();
        await new Promise((res) => setTimeout(res, 1500));
        const returnBtn = [...document.querySelectorAll('button')].find((b) => /Record return/.test(b.textContent));
        if (!returnBtn) return { valid, reasonHidden, departed: true, returned: false, reason: 'no return button' };
        returnBtn.click();
        await new Promise((res) => setTimeout(res, 1500));
        const finalVerdict = document.querySelector('.gate-verdict')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) || '';
        const logged = document.body.textContent.includes('Returned');
        return { valid, reasonHidden, departed: true, returned: true, logged, finalVerdict };
      }, passCode);
      check('gate verification accepts the issued pass', gateFlow.valid, gateFlow.finalVerdict || '');
      check('gate result never shows the reason for leaving', gateFlow.reasonHidden);
      check('gate records the departure', gateFlow.departed);
      check('gate records the return and completes the exeat', gateFlow.returned, gateFlow.finalVerdict || '');
      check('return appears in recent gate activity', gateFlow.logged);
      await session.screenshot('06-gate-done');
    } else {
      check('gate verification accepts the issued pass', false, 'no pass code from approval step');
    }

    /* ---------- 6. Student sees the completed exeat + notifications ---------- */
    const out3 = await signOut(session);
    check('gate officer can sign out', out3.ok && !out3.stillSignedIn, JSON.stringify(out3));

    const backToStudent = await session.evaluate(async () => {
      let b2 = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (!b2) {
        location.hash = '#/';
        await new Promise((res) => setTimeout(res, 1000));
        b2 = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      }
      if (!b2) return { hash: null, reason: 'no student portal button' };
      b2.click();
      await new Promise((res) => setTimeout(res, 2000));
      return { hash: location.hash };
    });
    check('student portal button works after sign-out', backToStudent.hash === '#/app', JSON.stringify(backToStudent));
    await session.waitFor("document.querySelectorAll('.request-card').length >= 1", 15000).catch(() => {});
    const completedStat = await session.evaluate(() => {
      const tiles = [...document.querySelectorAll('.stat')];
      const completed = tiles.find((t) => /Completed exeats/.test(t.textContent));
      return completed ? completed.querySelector('.stat-value')?.textContent : null;
    });
    check('student dashboard stats reflect the completed exeat', completedStat === '1', `completed=${completedStat}`);
    await session.screenshot('07-student-completed');

    /* ---------- 7. External flow: housemaster then senior ---------- */
    const createdExternal = await session.evaluate(async () => {
      location.hash = '#/app/new';
      await new Promise((res) => setTimeout(res, 1000));
      if (!document.querySelector('#reason')) {
        const card = [...document.querySelectorAll('.type-card')].find((c) => /External/.test(c.textContent));
        if (card) {
          card.click();
          await new Promise((res) => setTimeout(res, 500));
        } else {
          const edit = [...document.querySelectorAll('button')].find((b) => /Edit details/.test(b.textContent));
          if (edit) {
            edit.click();
            await new Promise((res) => setTimeout(res, 500));
            const back = [...document.querySelectorAll('button')].find((b) => /Change type/.test(b.textContent));
            if (back) {
              back.click();
              await new Promise((res) => setTimeout(res, 500));
            }
          }
        }
      }
      const card2 = [...document.querySelectorAll('.type-card')].find((c) => /External/.test(c.textContent));
      if (!document.querySelector('#reason') && card2) {
        card2.click();
        await new Promise((res) => setTimeout(res, 500));
      }
      if (!document.querySelector('#reason')) return { ok: false, reason: 'external form not shown' };
      const set = (id, value) => {
        const el = document.querySelector(id);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('#category', 'family');
      set('#reason', 'Family outing with my guardian to Kumasi for the weekend, supervised throughout.');
      set('#destination', 'Kumasi — family home');
      const depart = new Date(Date.now() + 30 * 3600 * 1000);
      const backAt = new Date(Date.now() + 50 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      set('#departDate', `${depart.getFullYear()}-${pad(depart.getMonth() + 1)}-${pad(depart.getDate())}`);
      set('#departTime', hhmm(depart));
      set('#returnDate', `${backAt.getFullYear()}-${pad(backAt.getMonth() + 1)}-${pad(backAt.getDate())}`);
      set('#returnTime', hhmm(backAt));
      set('#guardianName', 'Ama Mensah');
      set('#guardianPhone', '0241234567');
      document.querySelector('form').requestSubmit();
      await new Promise((res) => setTimeout(res, 800));
      const submitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit request');
      if (!submitBtn) return { ok: false, reason: 'review step missing submit' };
      submitBtn.click();
      await new Promise((res) => setTimeout(res, 2000));
      return {
        ok: document.body.textContent.includes('Request submitted'),
        reference: (document.body.textContent.match(/EXE-\d{4}-\d{4}/) || [null])[0],
      };
    });
    check('external exeat can be submitted', createdExternal.ok && createdExternal.reference, JSON.stringify(createdExternal));

    await signOut(session);
    const hm2 = await staffSignIn(session, 'housemaster');
    check('housemaster signs in for the external review', hm2.ok && hm2.hash === '#/staff', JSON.stringify(hm2));
    const hmApproved = await session.evaluate(async () => {
      await new Promise((res) => setTimeout(res, 800));
      const link = [...document.querySelectorAll('.table tbody a')].find((a) => a.closest('tr')?.textContent.includes('Kumasi'))
        || [...document.querySelectorAll('.table tbody a')][0];
      if (!link) return { ok: false, reason: 'no queue link' };
      link.click();
      await new Promise((res) => setTimeout(res, 1500));
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button' };
      approve.click();
      await new Promise((res) => setTimeout(res, 600));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      confirm.click();
      await new Promise((res) => setTimeout(res, 2000));
      return {
        ok: true,
        awaitingSenior: document.body.textContent.includes('Pending senior housemaster approval')
          || document.body.textContent.includes('Waiting for the Senior'),
      };
    });
    check('housemaster approval of an external routes to the senior', hmApproved.ok && hmApproved.awaitingSenior, JSON.stringify(hmApproved));

    await signOut(session);
    const snr = await staffSignIn(session, 'senior');
    check('role picker signs in the senior housemaster', snr.ok && snr.hash === '#/staff', JSON.stringify(snr));
    const snrApproved = await session.evaluate(async () => {
      await new Promise((res) => setTimeout(res, 800));
      const link = [...document.querySelectorAll('.table tbody a')][0];
      if (!link) return { ok: false, reason: 'no senior queue link' };
      link.click();
      await new Promise((res) => setTimeout(res, 1500));
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button for senior' };
      approve.click();
      await new Promise((res) => setTimeout(res, 600));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      confirm.click();
      await new Promise((res) => setTimeout(res, 2000));
      return { ok: true, passIssued: !!document.querySelector('.pass-code-value') };
    });
    check('senior approval completes the external flow and issues a pass', snrApproved.ok && snrApproved.passIssued, JSON.stringify(snrApproved));

    /* ---------- 7b. §10 Tests A–D: date adjustment, rejection, correction, authorisation ---------- */
    await signOut(session);
    const stuA = await session.evaluate(async () => {
      const b = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (!b) { location.hash = '#/'; await new Promise((r) => setTimeout(r, 800)); }
      const b2 = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (!b2) return { ok: false, reason: 'no student portal button' };
      b2.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: location.hash === '#/app' };
    });
    check('scenario setup: student session opens', stuA.ok, JSON.stringify(stuA));

    const tak = await submitRequest(session, {
      type: 'external',
      reason: 'Weekend home visit with my guardian, supervised throughout.',
      destination: 'Takoradi — aunt’s home',
      departInHours: 30,
      returnInHours: 50,
    });
    check('scenario: external request submitted', tak.ok && tak.id, JSON.stringify(tak));
    const accra = await submitRequest(session, {
      type: 'internal',
      reason: 'Visiting my cousin in Accra for a family event.',
      destination: 'Accra — cousin’s home',
      departInHours: 4,
      returnInHours: 10,
    });
    check('scenario: first internal request submitted', accra.ok && accra.id, JSON.stringify(accra));
    const uncle = await submitRequest(session, {
      type: 'internal',
      reason: 'Staying with my uncle while my parents travel.',
      destination: 'Cape Coast — uncle’s home',
      departInHours: 5,
      returnInHours: 12,
    });
    check('scenario: second internal request submitted', uncle.ok && uncle.id, JSON.stringify(uncle));

    // Senior scope: internals are not listed and their detail is forbidden.
    await signOut(session);
    const snrScope = await staffSignIn(session, 'senior');
    check('scenario: senior signs in', snrScope.ok && snrScope.hash === '#/staff', JSON.stringify(snrScope));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
    const seniorRows = await session.evaluate((ids) => ({
      anyInternal: [...document.querySelectorAll('.table tbody a')]
        .some((a) => ids.includes((a.getAttribute('href') || '').split('/').pop())),
      count: document.querySelectorAll('.table tbody tr').length,
    }), [accra.id, uncle.id]);
    check('senior queue lists only requests that need senior review', !seniorRows.anyInternal, JSON.stringify(seniorRows));
    await session.evaluate((id) => { location.hash = `#/staff/requests/${id}`; }, accra.id);
    await sleep(1200);
    const seniorForbidden = await session.evaluate("document.body.textContent.includes('Outside your access')");
    check('senior cannot open an internal request detail', seniorForbidden === true);
    await session.screenshot('11-senior-scope');

    // Housemaster: filters/search, row click, date adjustment, reject, return.
    await signOut(session);
    const hm3 = await staffSignIn(session, 'housemaster');
    check('scenario: housemaster signs in for the workflow tests', hm3.ok && hm3.hash === '#/staff', JSON.stringify(hm3));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 3", 15000).catch(() => {});
    const searchCheck = await session.evaluate(async () => {
      const input = document.querySelector('#staff-search');
      input.value = 'Takoradi';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      const rows = [...document.querySelectorAll('.table tbody tr')];
      const onlyTak = rows.length >= 1 && rows.every((tr) => tr.textContent.includes('Takoradi'));
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      return { onlyTak, rows: rows.length };
    });
    check('queue search filters by destination', searchCheck.onlyTak === true, JSON.stringify(searchCheck));

    const chipCheck = await session.evaluate(async () => {
      const awaiting = [...document.querySelectorAll('.summary-chip')].find((c) => /Awaiting my review/.test(c.textContent));
      if (!awaiting) return { ok: false, reason: 'no awaiting-my-review chip' };
      awaiting.click();
      await new Promise((r) => setTimeout(r, 700));
      const rows = [...document.querySelectorAll('.table tbody tr')];
      const allActionable = rows.length >= 1 && rows.every((tr) => /Action needed/.test(tr.textContent));
      const hasRejectedChip = [...document.querySelectorAll('.summary-chip')]
        .some((c) => /Rejected/.test(c.textContent));
      const all = [...document.querySelectorAll('.summary-chip')].find((c) => c.textContent.startsWith('All'));
      all?.click();
      await new Promise((r) => setTimeout(r, 500));
      return { ok: true, allActionable, hasRejectedChip };
    });
    check('awaiting-my-review filter shows only actionable rows', chipCheck.ok && chipCheck.allActionable, JSON.stringify(chipCheck));
    check('rejected filter chip is available to staff', chipCheck.hasRejectedChip === true);

    const rowOpen = await session.evaluate(async (id) => {
      const row = [...document.querySelectorAll('tr.staff-row')]
        .find((tr) => tr.querySelector(`a[href="#/staff/requests/${id}"]`));
      if (!row) return { ok: false, reason: 'queue row not found' };
      row.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: location.hash === `#/staff/requests/${id}`, hash: location.hash };
    }, tak.id);
    check('clicking anywhere on a queue row opens the request', rowOpen.ok, JSON.stringify(rowOpen));

    const dateAdjust = await session.evaluate(async () => {
      const retDate = document.querySelector('#prop-returnDate');
      const retTime = document.querySelector('#prop-returnTime');
      if (!retDate || !retTime) return { ok: false, reason: 'no proposed date fields' };
      const originalShown = document.body.textContent.includes('Dates under review')
        && !!document.querySelector('#prop-departDate');
      const back = new Date(Date.now() + 34 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      retDate.value = `${back.getFullYear()}-${pad(back.getMonth() + 1)}-${pad(back.getDate())}`;
      retTime.value = `${pad(back.getHours())}:${pad(back.getMinutes())}`;
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button', originalShown };
      approve.click();
      await new Promise((r) => setTimeout(r, 500));
      const dialogOpenedWithoutReason = !!document.querySelector('.dialog');
      if (dialogOpenedWithoutReason) {
        document.querySelector('.dialog button')?.click();
        return { ok: false, reason: 'dialog opened without a date reason', originalShown };
      }
      const reasonError = [...document.querySelectorAll('.field-error')]
        .some((e) => !e.hidden && /changing the proposed/i.test(e.textContent));
      const reason = document.querySelector('#prop-dateReason');
      reason.value = 'The requested visit is longer than needed — return two days earlier.';
      const comment = document.querySelector('#decision-comment');
      comment.value = 'Shortened to a weekend trip.';
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve').click();
      await new Promise((r) => setTimeout(r, 500));
      const dialogShowsProposal = document.body.textContent.includes('Proposed schedule:')
        && document.body.textContent.includes('Date adjustment');
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no approve confirm', dialogShowsProposal, reasonError, originalShown };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      const awaitingSenior = document.body.textContent.includes('Pending senior housemaster approval');
      return { ok: true, reasonError, dialogShowsProposal, awaitingSenior, originalShown };
    });
    check('staff detail shows the original request dates', dateAdjust.originalShown === true, JSON.stringify(dateAdjust));
    check('changing proposed dates without a reason is blocked', dateAdjust.reasonError === true);
    check('approval dialog confirms the proposed schedule', dateAdjust.dialogShowsProposal === true);
    check('housemaster approval forwards the shortened proposal to the senior', dateAdjust.awaitingSenior === true);

    const rejectFlow = await session.evaluate(async (id) => {
      location.hash = `#/staff/requests/${id}`;
      await new Promise((r) => setTimeout(r, 1500));
      const reject = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reject');
      if (!reject) return { ok: false, reason: 'no reject button' };
      reject.click();
      await new Promise((r) => setTimeout(r, 400));
      const dialogOpened = !!document.querySelector('.dialog');
      if (dialogOpened) {
        document.querySelector('.dialog button')?.click();
        return { ok: false, reason: 'reject dialog opened without a reason' };
      }
      const commentError = [...document.querySelectorAll('.field-error')]
        .some((e) => !e.hidden && /clear reason/.test(e.textContent));
      const comment = document.querySelector('#decision-comment');
      comment.value = 'This clashes with the prep timetable.';
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reject').click();
      await new Promise((r) => setTimeout(r, 400));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, reject/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no reject confirm', commentError };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      const rejectedShown = document.body.textContent.includes('Rejected');
      location.hash = '#/staff';
      await new Promise((r) => setTimeout(r, 1200));
      const awaiting = [...document.querySelectorAll('.summary-chip')].find((c) => /Awaiting my review/.test(c.textContent));
      awaiting?.click();
      await new Promise((r) => setTimeout(r, 800));
      const inActive = [...document.querySelectorAll('.table tbody tr')].some((tr) => tr.textContent.includes('Accra'));
      return { ok: true, commentError, rejectedShown, inActive };
    }, accra.id);
    check('rejection without a reason is blocked', rejectFlow.commentError === true, JSON.stringify(rejectFlow));
    check('rejection with a reason is recorded', rejectFlow.rejectedShown === true);
    check('rejected request leaves the active approval queue', rejectFlow.inActive === false);

    const returnFlow = await session.evaluate(async (id) => {
      location.hash = `#/staff/requests/${id}`;
      await new Promise((r) => setTimeout(r, 1500));
      const comment = document.querySelector('#decision-comment');
      if (!comment) return { ok: false, reason: 'no decision panel' };
      comment.value = 'Add the guardian phone number you will travel with.';
      const ret = [...document.querySelectorAll('button')].find((b) => /Return for correction/.test(b.textContent));
      if (!ret) return { ok: false, reason: 'no return button' };
      ret.click();
      await new Promise((r) => setTimeout(r, 400));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, return/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no return confirm' };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      return { ok: true, returned: document.body.textContent.includes('Returned for correction') };
    }, uncle.id);
    check('return for correction is recorded', returnFlow.ok && returnFlow.returned, JSON.stringify(returnFlow));

    // Student: rejection reason, correction explanation, resubmit with preserved data.
    await signOut(session);
    await session.evaluate(async () => {
      const b = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (b) { b.click(); await new Promise((r) => setTimeout(r, 1500)); }
    });
    await session.evaluate((id) => { location.hash = `#/app/requests/${id}`; }, accra.id);
    await sleep(1500);
    const studentRejectView = await session.evaluate(() =>
      document.body.textContent.includes('Rejected — reason')
      && document.body.textContent.includes('prep timetable'));
    check('student sees the rejection reason', studentRejectView === true);

    await session.evaluate((id) => { location.hash = `#/app/requests/${id}`; }, uncle.id);
    await sleep(1500);
    const studentReturnView = await session.evaluate(async () => {
      const explanation = document.body.textContent.includes('What needs changing')
        && document.body.textContent.includes('guardian phone number');
      const dest = document.querySelector('#fix-destination');
      const preserved = !!dest && /uncle/.test(dest.value);
      if (!dest) return { explanation, preserved, resubmitted: false };
      dest.value = 'Cape Coast — uncle’s house (updated)';
      dest.dispatchEvent(new Event('input', { bubbles: true }));
      const save = [...document.querySelectorAll('button')].find((b) => /Save and resubmit/.test(b.textContent));
      save.click();
      await new Promise((r) => setTimeout(r, 1800));
      const pendingAgain = document.body.textContent.includes('Pending housemaster approval');
      const updatedKept = document.body.textContent.includes('uncle’s house (updated)');
      return { explanation, preserved, resubmitted: true, pendingAgain, updatedKept };
    });
    check('student sees the correction explanation', studentReturnView.explanation === true, JSON.stringify(studentReturnView));
    check('returned form preserves previously entered information', studentReturnView.preserved === true);
    check('resubmitted request returns to the housemaster stage', studentReturnView.pendingAgain === true && studentReturnView.updatedKept === true);

    // Senior finalises the shortened proposal; sees the housemaster's decision.
    await signOut(session);
    const snrFinal = await staffSignIn(session, 'senior');
    check('senior signs in for the final decision', snrFinal.ok && snrFinal.hash === '#/staff', JSON.stringify(snrFinal));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
    const seniorFinal = await session.evaluate(async (id) => {
      const link = document.querySelector(`a[href="#/staff/requests/${id}"]`)
        || [...document.querySelectorAll('.table tbody a')][0];
      if (!link) return { ok: false, reason: 'no senior queue link' };
      link.click();
      await new Promise((r) => setTimeout(r, 1500));
      const history = document.body.textContent.includes('Shortened to a weekend trip.')
        && document.body.textContent.includes('Date adjustment');
      const prefilledEl = document.querySelector('#prop-returnDate');
      const prefilled = !!prefilledEl && !!prefilledEl.value;
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button', history, prefilled };
      approve.click();
      await new Promise((r) => setTimeout(r, 500));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      confirm.click();
      await new Promise((r) => setTimeout(r, 2000));
      return { ok: true, history, prefilled, passIssued: !!document.querySelector('.pass-code-value') };
    }, tak.id);
    check('senior sees the housemaster decision and adjustment reason', seniorFinal.history === true, JSON.stringify(seniorFinal));
    check('senior sees the proposal pre-filled', seniorFinal.prefilled === true);
    check('senior approval issues the pass', seniorFinal.ok && seniorFinal.passIssued === true, JSON.stringify(seniorFinal));

    // Student: authorised schedule, original dates preserved, approved ≠ completed, persistence.
    await signOut(session);
    await session.evaluate(async () => {
      const b = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (b) { b.click(); await new Promise((r) => setTimeout(r, 1500)); }
    });
    await session.evaluate((id) => { location.hash = `#/app/requests/${id}`; }, tak.id);
    await sleep(1500);
    const studentApproved = await session.evaluate(() => ({
      authorised: document.body.textContent.includes('Authorised schedule'),
      original: document.body.textContent.includes('Your original request'),
      completed: document.body.textContent.includes('This exeat is complete'),
    }));
    check('student sees the authorised schedule after final approval', studentApproved.authorised === true, JSON.stringify(studentApproved));
    check('student still sees the original requested dates', studentApproved.original === true);
    check('approved is not marked completed before any gate movement', studentApproved.completed === false);
    await session.goto(`${BASE}/#/app/requests/${tak.id}`);
    await session.waitFor("document.body.textContent.includes('Authorised schedule')", 15000).catch(() => {});
    const persistedSchedule = await session.evaluate("document.body.textContent.includes('Authorised schedule')");
    check('authorised schedule survives a page reload', persistedSchedule === true);
    await session.screenshot('12-authorised-schedule');

    /* ---------- 7c. Duration review: no universal cap, staff judgement ---------- */
    // The student session is still active. Submit a five-day internal outing.
    const longTrip = await submitRequest(session, {
      type: 'internal',
      category: 'personal',
      reason: 'Purchasing provisions in town and visiting relatives before term resumes.',
      destination: 'Cape Coast — town',
      departInHours: 6,
      returnInHours: 6 + 5 * 24,
    });
    check('unusually long internal request is accepted (no automatic 72-hour rejection)',
      longTrip.ok && longTrip.id, JSON.stringify(longTrip));

    await signOut(session);
    const hmDur = await staffSignIn(session, 'housemaster');
    check('housemaster signs in for the duration-review test', hmDur.ok && hmDur.hash === '#/staff', JSON.stringify(hmDur));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
    const durationReview = await session.evaluate(async (id) => {
      location.hash = `#/staff/requests/${id}`;
      await new Promise((r) => setTimeout(r, 1500));
      const alertShown = [...document.querySelectorAll('.alert-warning')]
        .some((a) => /Duration review recommended/.test(a.textContent));
      const showsDuration = document.body.textContent.includes('Duration');
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button', alertShown, showsDuration };
      approve.click();
      await new Promise((r) => setTimeout(r, 500));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no approve confirm', alertShown, showsDuration };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      return {
        ok: true,
        alertShown,
        showsDuration,
        approved: document.body.textContent.includes('Approved'),
        passIssued: !!document.querySelector('.pass-code-value'),
      };
    }, longTrip.id);
    check('staff detail shows the duration-review warning for long requests',
      durationReview.alertShown === true, JSON.stringify(durationReview));
    check('long request can be approved as submitted without date changes',
      durationReview.ok && durationReview.approved && durationReview.passIssued === true,
      JSON.stringify(durationReview));
    await session.screenshot('13-duration-review');

    /* ---------- 7d. Senior rejection overrides the HM approval (demo) ---------- */
    await signOut(session);
    await session.evaluate(async () => {
      const b = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (b) { b.click(); await new Promise((r) => setTimeout(r, 1500)); }
    });
    const ext2 = await submitRequest(session, {
      type: 'external',
      reason: 'Guardian family meeting in Kumasi this half-term.',
      destination: 'Kumasi — family house',
      departInHours: 30,
      returnInHours: 80,
    });
    check('second external request submitted for the senior-rejection test',
      ext2.ok && ext2.id, JSON.stringify(ext2));

    await signOut(session);
    const hm4 = await staffSignIn(session, 'housemaster');
    check('housemaster signs in (rejection scenario)', hm4.ok && hm4.hash === '#/staff', JSON.stringify(hm4));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
    const hm4Approved = await session.evaluate(async (id) => {
      location.hash = `#/staff/requests/${id}`;
      await new Promise((r) => setTimeout(r, 1500));
      const approve = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve');
      if (!approve) return { ok: false, reason: 'no approve button' };
      approve.click();
      await new Promise((r) => setTimeout(r, 500));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, approve/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no approve confirm' };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      return { ok: true, awaiting: document.body.textContent.includes('Pending senior housemaster approval') };
    }, ext2.id);
    check('housemaster approval forwards to senior (rejection scenario)',
      hm4Approved.ok && hm4Approved.awaiting === true, JSON.stringify(hm4Approved));

    await signOut(session);
    const snrRej = await staffSignIn(session, 'senior');
    check('senior signs in for the rejection test', snrRej.ok && snrRej.hash === '#/staff', JSON.stringify(snrRej));
    await session.waitFor("document.querySelectorAll('.table tbody tr').length >= 1", 15000).catch(() => {});
    const seniorReject = await session.evaluate(async (id) => {
      location.hash = `#/staff/requests/${id}`;
      await new Promise((r) => setTimeout(r, 1500));
      const histShowsApproval = document.body.textContent.includes('Approved by');
      const comment = document.querySelector('#decision-comment');
      if (!comment) return { ok: false, reason: 'no decision panel', histShowsApproval };
      comment.value = 'The guardian travel plans cannot be confirmed.';
      const reject = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reject');
      if (!reject) return { ok: false, reason: 'no reject button', histShowsApproval };
      reject.click();
      await new Promise((r) => setTimeout(r, 400));
      const confirm = [...document.querySelectorAll('.dialog button')].find((b) => /Yes, reject/.test(b.textContent));
      if (!confirm) return { ok: false, reason: 'no reject confirm', histShowsApproval };
      confirm.click();
      await new Promise((r) => setTimeout(r, 1800));
      const rejected = document.body.textContent.includes('Rejected');
      location.hash = '#/staff';
      await new Promise((r) => setTimeout(r, 1500));
      const awaiting = [...document.querySelectorAll('.summary-chip')]
        .find((c) => /Awaiting my review/.test(c.textContent));
      awaiting?.click();
      await new Promise((r) => setTimeout(r, 800));
      const rows = [...document.querySelectorAll('.table tbody tr')];
      const stillQueued = rows.some((tr) => tr.textContent.includes('Kumasi'));
      return { ok: true, histShowsApproval, rejected, stillQueued };
    }, ext2.id);
    check('senior sees the housemaster approval in history before deciding',
      seniorReject.histShowsApproval === true, JSON.stringify(seniorReject));
    check('senior rejection overrides the approval (final status rejected)',
      seniorReject.ok && seniorReject.rejected === true, JSON.stringify(seniorReject));
    check('rejected request leaves the senior queue', seniorReject.stillQueued === false);

    await signOut(session);
    await session.evaluate(async () => {
      const b = [...document.querySelectorAll('.hero-actions button')].find((x) => /Student portal/.test(x.textContent));
      if (b) { b.click(); await new Promise((r) => setTimeout(r, 1500)); }
    });
    await session.evaluate((id) => { location.hash = `#/app/requests/${id}`; }, ext2.id);
    await sleep(1500);
    const seniorReasonView = await session.evaluate(() =>
      document.body.textContent.includes('cannot be confirmed')
      && document.body.textContent.includes('Rejected'));
    check('student sees the senior rejection reason', seniorReasonView === true);

    /* ---------- 8. Admin: announcements CRUD ---------- */
    await signOut(session);
    const adminIn = await staffSignIn(session, 'admin');
    check('role picker signs in the administrator', adminIn.ok && adminIn.hash === '#/admin', JSON.stringify(adminIn));
    await session.waitFor("!!document.querySelector('#an-title')", 15000).catch(() => {});
    const announced = await session.evaluate(async () => {
      const title = document.querySelector('#an-title');
      const body = document.querySelector('#an-body');
      const level = document.querySelector('#an-level');
      if (!title || !body) return { ok: false, reason: 'announcement form missing' };
      title.value = 'Demo e2e notice';
      body.value = 'Published by the demo end-to-end test run.';
      level.value = 'policy';
      const form = title.closest('form');
      form.requestSubmit();
      await new Promise((res) => setTimeout(res, 1500));
      return { ok: document.body.textContent.includes('Demo e2e notice') };
    });
    check('admin can publish an announcement', announced.ok, announced.reason || 'published');
    await session.screenshot('08-admin');

    await session.goto(`${BASE}/#/announcements`);
    await session.waitFor("document.querySelectorAll('.announce').length >= 3", 15000).catch(() => {});
    const annPage = await session.evaluate(() => ({
      count: document.querySelectorAll('.announce').length,
      hasNew: document.body.textContent.includes('Demo e2e notice'),
    }));
    check('new announcement appears on the public announcements page', annPage.hasNew, JSON.stringify(annPage));

    /* ---------- 9. Access control + sign-in form + responsive ---------- */
    await signOut(session);
    const gateIn = await staffSignIn(session, 'gate');
    check('gate role picker sign-in works', gateIn.ok, JSON.stringify(gateIn));
    await session.goto(`${BASE}/#/admin`);
    await sleep(1500);
    const notAdmin = await session.evaluate('location.hash');
    check('gate session cannot open the admin area', notAdmin !== '#/admin', notAdmin);

    await signOut(session);
    await session.goto(`${BASE}/#/signin?role=student`);
    await session.waitFor("!!document.querySelector('#identifier')", 15000);
    await session.evaluate(`
      document.querySelector('#identifier').value = 'MFS/26/0001';
      document.querySelector('#password').value = 'Entryout!2026';
      document.querySelector('form').requestSubmit();
    `);
    await session.waitFor("location.hash === '#/app'", 15000).catch(() => {});
    const pwdHash = await session.evaluate('location.hash');
    check('demo password sign-in still works on the sign-in page', pwdHash === '#/app', pwdHash);

    await session.setViewport(375, 780);
    await session.goto(`${BASE}/`);
    await session.waitFor("!!document.querySelector('.hero h1')", 15000);
    await sleep(400);
    const noHScroll = await session.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
    check('landing has no horizontal scroll at 375px', noHScroll);
    await session.screenshot('09-landing-mobile');

    await session.goto(`${BASE}/#/app`);
    await session.waitFor("document.querySelectorAll('.stat').length >= 3 || !!document.querySelector('.empty-state')", 15000).catch(() => {});
    const dashMobile = await session.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
    check('student dashboard has no horizontal scroll at 375px', dashMobile);
    await session.screenshot('10-dashboard-mobile');

    /* ---------- 9b. Charcoal dark mode + persistent theme toggle ---------- */
    await session.setViewport(1024, 800);
    await session.goto(`${BASE}/`);
    await session.waitFor("!!document.querySelector('.hero h1')", 15000);
    const themeDefault = await session.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }));
    check('new visitors get the charcoal dark theme by default',
      themeDefault.theme === 'dark' && themeDefault.bodyBg === 'rgb(32, 33, 36)',
      JSON.stringify(themeDefault));

    const darkSurfaces = await session.evaluate(() => {
      const step = document.querySelector('.step');
      return step ? getComputedStyle(step).backgroundColor : null;
    });
    check('dark theme paints panels charcoal (no white cards)',
      !!darkSurfaces && darkSurfaces !== 'rgb(255, 255, 255)', darkSurfaces);

    const themeToggleRun = await session.evaluate(async () => {
      const btn = document.querySelector('.theme-toggle');
      if (!btn) return { ok: false, reason: 'no theme toggle button' };
      const labelled = (btn.getAttribute('aria-label') || '').includes('theme');
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const light = document.documentElement.getAttribute('data-theme') === 'light'
        && localStorage.getItem('entryout-theme') === 'light'
        && getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)';
      return { ok: true, labelled, light };
    });
    check('theme toggle is labelled and switches to light',
      themeToggleRun.ok && themeToggleRun.labelled && themeToggleRun.light, JSON.stringify(themeToggleRun));
    await session.screenshot('14-theme-light');

    await session.goto(`${BASE}/#/signin`);
    await sleep(1200);
    const themePersisted = await session.evaluate(
      "document.documentElement.getAttribute('data-theme') === 'light' && localStorage.getItem('entryout-theme') === 'light'");
    check('light theme persists across a full page reload', themePersisted === true);

    const themeBack = await session.evaluate(async () => {
      document.querySelector('.theme-toggle')?.click();
      await new Promise((r) => setTimeout(r, 300));
      return document.documentElement.getAttribute('data-theme') === 'dark'
        && localStorage.getItem('entryout-theme') === 'dark';
    });
    check('toggling back restores the dark theme', themeBack === true);
    await session.screenshot('15-theme-dark');

    /* ---------- 10. Reference integrity + page errors ---------- */
    check('internal reference from confirmation is stable', /^EXE-\d{4}-\d{4}$/.test(internalRef || ''), internalRef || 'none');
    check('no uncaught JavaScript errors during the run', pageErrors === 0, `${pageErrors} error(s)`);

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} demo browser checks passed`);
    console.log(`Screenshots: ${OUT}`);
    ws.close();
    child.kill();
    stopServer();
    process.exit(failed.length ? 1 : 0);
  } catch (err) {
    console.error('Demo E2E failed:', err);
    child.kill();
    stopServer();
    process.exit(1);
  }
}

main();
