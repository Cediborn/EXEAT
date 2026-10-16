/**
 * Runtime configuration for the Entryout frontend.
 *
 * `apiBase` is the absolute URL of the Entryout API.
 *
 * TEMPORARY DEMO WIRING (same as the GitHub Pages build): it points at the
 * developer's local API (http://localhost:8787) so the development dashboard
 * bypass also works from static hosts like Vercel or GitHub Pages, on the
 * developer's own machine. Visitors elsewhere just see the honest "backend
 * not connected" banner; normal password sign-in works whenever an API is
 * reachable. The local backend serves this same file, and because
 * http://localhost:8787 is the same origin there, local development is
 * unaffected.
 *
 * To return to pure local-same-origin mode, set apiBase back to ''.
 * The GitHub Pages deploy workflow regenerates its own copy of this file.
 */
window.ENTRYOUT_CONFIG = {
  apiBase: 'http://localhost:8787',
  appName: 'Entryout',
  // Temporary development bypass: when true, the Student Portal / Staff sign-in
  // buttons open the dashboards directly with a demo test session instead of the
  // login page. The server independently gates this (DEV_BYPASS_AUTH, never
  // active when NODE_ENV=production) — if the API has the bypass disabled the
  // buttons simply fall back to the original sign-in page.
  devBypassAuth: true,
};
