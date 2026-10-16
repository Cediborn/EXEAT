import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;

test.before(async () => {
  server = await startTestServer();
});

test.after(async () => {
  await server.close();
});

test('the app shell is served and references the design system', async () => {
  const res = await serverFetch('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
  assert.match(res.text, /Entryout/);
  assert.match(res.text, /src="\.\/src\/js\/app\.js"/);
  assert.match(res.text, /href="\.\/src\/css\/tokens\.css"/);
});

test('frontend modules are served with JavaScript content types', async () => {
  for (const file of [
    '/src/js/app.js',
    '/src/js/api.js',
    '/src/js/validation.js',
    '/src/css/tokens.css',
    '/src/css/components.css',
    '/public/favicon.svg',
    '/config.js',
  ]) {
    const res = await serverFetch(file);
    assert.equal(res.status, 200, `${file} should be served`);
  }
});

test('API routes never fall through to the HTML shell', async () => {
  const res = await serverFetch('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /json/);
});

test('backend source and environment files are not served as code', async () => {
  for (const file of ['/backend/server.js', '/.env', '/package.json', '/tests/helpers.js']) {
    const res = await serverFetch(file);
    // The SPA fallback returns the HTML app shell for unknown paths; it must
    // never return backend source or environment files.
    assert.match(res.headers.get('content-type') || '', /text\/html/, `${file} must not be served as code`);
    assert.match(res.text, /<!DOCTYPE html>/i, `${file} should fall back to the app shell`);
    assert.ok(!/DATABASE_PATH|password_hash|listen\(/.test(res.text), `${file} must not leak backend content`);
  }
});

test('security headers are present on responses', async () => {
  const res = await serverFetch('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('every frontend source file parses as valid JavaScript', async () => {
  const jsRoot = path.join(ROOT, 'src', 'js');
  const files = walk(jsRoot);
  assert.ok(files.length >= 10, 'expected the frontend module tree to exist');
  const { execFileSync } = await import('node:child_process');
  for (const file of files) {
    // --check parses without executing; module syntax is detected by extension.
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(file, 'utf8'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
});

async function serverFetch(pathname) {
  const res = await fetch(server.base + pathname);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
