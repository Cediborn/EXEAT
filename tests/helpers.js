import { TEST_DB_DIR, cleanupTestDir } from './setup-env.js';

/**
 * Boot the API on an ephemeral port with an isolated temporary database.
 * Environment variables live in setup-env.js, which must be imported before
 * any backend module so configuration is read correctly.
 */
export async function startTestServer() {
  const { createApp } = await import('../backend/app.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    server,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await cleanupTestDir();
    },
  };
}

/** Minimal cookie-jar HTTP client with CSRF handling. */
export function createClient(base) {
  const jar = new Map();
  let csrfToken = null;

  const client = {
    get csrfToken() { return csrfToken; },
    jar,
    async request(pathOrUrl, { method = 'GET', body, headers = {}, allowCsrf = true } = {}) {
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : base + pathOrUrl;
      const res = await fetch(url, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(csrfToken && allowCsrf ? { 'x-csrf-token': csrfToken } : {}),
          ...(jar.size ? { cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
      for (const cookie of res.headers.getSetCookie?.() || []) {
        const [pair] = cookie.split(';');
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
        if (name === 'entryout_csrf') csrfToken = value;
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: res.status, headers: res.headers, text, json, ok: res.ok };
    },
    get(path, opts) { return client.request(path, { ...opts, method: 'GET' }); },
    post(path, body, opts) { return client.request(path, { ...opts, method: 'POST', body }); },
    patch(path, body, opts) { return client.request(path, { ...opts, method: 'PATCH', body }); },
    put(path, body, opts) { return client.request(path, { ...opts, method: 'PUT', body }); },
    async login(identifier, password) {
      const res = await client.post('/api/auth/login', { identifier, password });
      if (!res.ok) throw new Error(`Login failed for ${identifier}: ${res.status} ${res.text}`);
      return res.json;
    },
    logout: () => client.post('/api/auth/logout', {}),
  };
  return client;
}

/** Build dates relative to now for deterministic workflow tests. */
export function when(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3600 * 1000);
}

export function dateParts(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function departParts(iso) {
  const p = dateParts(iso);
  return { departDate: p.date, departTime: p.time };
}

export function returnParts(iso) {
  const p = dateParts(iso);
  return { returnDate: p.date, returnTime: p.time };
}

export function applicationPayload(overrides = {}) {
  const depart = when(48);
  const back = when(54);
  const dep = dateParts(depart.toISOString());
  const ret = dateParts(back.toISOString());
  return {
    type: 'internal',
    category: 'family',
    reason: 'Visiting family in town for the weekend with my guardian.',
    destination: 'Cape Coast — Ridge home',
    departDate: dep.date,
    departTime: dep.time,
    returnDate: ret.date,
    returnTime: ret.time,
    ...overrides,
  };
}
