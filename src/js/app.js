import { qs } from './dom.js';
import { route, setNotFound, startRouter, navigate, currentRoutePath, reloadRoute } from './router.js';
import { session, loadSession, homeRouteFor } from './auth.js';
import { renderShell, showBanner, setTitle, closeMobileNav } from './components/shell.js';
import { loadingBlock } from './components/ui.js';
import { checkHealth } from './api.js';
import { DEMO_MODE } from './config.js';

import { landingPage } from './pages/landing.js';
import { helpPage } from './pages/help.js';
import { announcementsPage } from './pages/announcements.js';
import { signInPage } from './pages/signin.js';
import { registerPage } from './pages/register.js';
import { studentDashboard } from './pages/dashboard.js';
import { applyPage } from './pages/apply.js';
import { requestDetailPage } from './pages/requestDetail.js';
import { staffDashboardPage } from './pages/staffDashboard.js';
import { staffDetailPage } from './pages/staffDetail.js';
import { gatePage } from './pages/gate.js';
import { adminPage } from './pages/admin.js';
import { notFoundPage } from './pages/notFound.js';

const main = qs('#main');

/** Mount a page node inside the shared layout container. */
function mount(node) {
  const wrap = document.createElement('div');
  wrap.className = 'container';
  wrap.append(node);
  main.replaceChildren(wrap);
}

/** Render the current page into <main>, with a guard for protected routes. */
async function render(handler, { requiresAuth, roles }) {
  closeMobileNav();
  mount(loadingBlock());

  if (requiresAuth) {
    if (!session.loaded) await loadSession();
    if (!session.user) {
      const redirect = encodeURIComponent(currentRoutePath());
      navigate(`#/signin?next=${redirect}`, { replace: true });
      return;
    }
    if (roles && !roles.includes(session.user.role)) {
      navigate(homeRouteFor(session.user.role), { replace: true });
      return;
    }
  }

  const node = await handler();
  mount(node);
  main.scrollIntoView?.({ block: 'start' });
  window.scrollTo({ top: 0 });
}

function registerRoutes() {
  route('/', () => render(landingPage, {}));
  route('/help', () => render(helpPage, {}));
  route('/announcements', () => render(announcementsPage, {}));

  route('/signin', ({ query }) => {
    if (session.user) {
      navigate(homeRouteFor(session.user.role), { replace: true });
      return undefined;
    }
    return render(() => signInPage({ query }), {});
  });

  route('/register', () => {
    if (session.user) {
      navigate(homeRouteFor(session.user.role), { replace: true });
      return undefined;
    }
    return render(registerPage, {});
  });

  // Student area
  route('/app', () => render(studentDashboard, { requiresAuth: true, roles: ['student'] }));
  route('/app/new', ({ query }) => render(() => applyPage({ query }), { requiresAuth: true, roles: ['student'] }));
  route('/app/requests/:id', ({ params }) => render(() => requestDetailPage({ params }), { requiresAuth: true, roles: ['student'] }));

  // Staff area
  route('/staff', () => render(staffDashboardPage, { requiresAuth: true, roles: ['housemaster', 'senior', 'admin'] }));
  route('/staff/requests/:id', ({ params }) => render(() => staffDetailPage({ params }), { requiresAuth: true, roles: ['housemaster', 'senior', 'admin'] }));

  // Gate
  route('/gate', () => render(gatePage, { requiresAuth: true, roles: ['gate', 'admin', 'senior', 'housemaster'] }));

  // Admin
  route('/admin', () => render(adminPage, { requiresAuth: true, roles: ['admin'] }));

  setNotFound(() => render(notFoundPage, {}));
}

async function boot() {
  renderShell();
  session.listeners.add(() => renderShell());
  onChangeKeepHash();

  const [reachable] = await Promise.all([checkHealth(), loadSession()]);
  if (DEMO_MODE) {
    showBanner('info',
      'Demo mode: this is a self-contained demonstration. Data is sample data, stored only in this browser — nothing is sent anywhere.');
  } else if (!reachable) {
    showBanner('danger',
      'The Entryout server is not reachable from this page. Pages will load, but sign-in and request actions need the API to be configured and running.');
  } else if (session.user) {
    const path = currentRoutePath();
    if (path === '/signin' || path === '/register' || path === '/') {
      // keep landing usable; only bounce away from auth screens
      if (path !== '/') navigate(homeRouteFor(session.user.role), { replace: true });
    }
  }

  registerRoutes();
  startRouter();
  document.title = 'Entryout — Your exeat, simplified';
}

/** Re-render the shell when the route changes (active nav state). */
function onChangeKeepHash() {
  window.addEventListener('hashchange', () => {
    renderShell();
    setTitleForRoute();
  });
}

function setTitleForRoute() {
  const path = currentRoutePath();
  if (path.startsWith('/app')) setTitle('My exeat');
  else if (path.startsWith('/staff')) setTitle('Review queue');
  else if (path.startsWith('/gate')) setTitle('Gate verification');
  else if (path.startsWith('/admin')) setTitle('Administration');
}

boot().catch((err) => {
  console.error('Entryout failed to start', err);
  // fallback: never leave a blank page, and never use innerHTML
  const box = document.createElement('div');
  box.className = 'card card-pad';
  const heading = document.createElement('h1');
  heading.textContent = 'Something went wrong';
  const message = document.createElement('p');
  message.textContent = 'The app could not start. Reload the page to try again.';
  box.append(heading, message);
  mount(box);
  showBanner('danger', 'Entryout could not start. Reload the page to try again.');
});

export { reloadRoute, navigate };
