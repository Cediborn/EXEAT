/**
 * Minimal hash router.
 * Hash routing keeps the static site working on any host (GitHub Pages serves
 * a single index.html without rewrite rules).
 *
 * Routes look like:  '#/app/requests/:id'
 */
const routes = [];
let notFoundHandler = () => {};
let currentCleanup = null;
let currentPath = null;

export function route(pattern, handler) {
  const keys = [];
  const regexSource = pattern
    .replace(/\/$/, '')
    .replace(/:[^/]+/g, (match) => {
      keys.push(match.slice(1));
      return '([^/]+)';
    });
  routes.push({ regex: new RegExp(`^${regexSource}/?$`), keys, handler, pattern });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

export function currentRoutePath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    const base = window.location.href.split('#')[0];
    window.history.replaceState(null, '', `${base}${target}`);
    handleRoute();
  } else if (window.location.hash === target) {
    handleRoute();
  } else {
    window.location.hash = target;
  }
}

export function parseQuery(search) {
  const out = {};
  for (const [k, v] of new URLSearchParams(search)) out[k] = v;
  return out;
}

async function handleRoute() {
  const path = currentRoutePath();
  if (path === currentPath) return;
  currentPath = path;

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* page cleanup must never break navigation */ }
    currentCleanup = null;
  }

  const [pathname, search = ''] = path.split('?');
  const query = parseQuery(search);

  for (const entry of routes) {
    const match = pathname.replace(/\/$/, '').match(entry.regex) || pathname.match(entry.regex);
    if (match) {
      const params = {};
      entry.keys.forEach((key, index) => { params[key] = decodeURIComponent(match[index + 1]); });
      try {
        const cleanup = await entry.handler({ params, query, path: pathname });
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (err) {
        console.error('Route handler failed', err);
        notFoundHandler({ params: {}, query, error: err });
      }
      return;
    }
  }
  notFoundHandler({ params: {}, query, path: pathname });
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

/** Force a re-render of the current route (e.g. after sign-in). */
export function reloadRoute() {
  currentPath = null;
  handleRoute();
}
