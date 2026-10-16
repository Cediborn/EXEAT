/**
 * Runtime configuration for the Entryout frontend.
 *
 * `apiBase` is the absolute URL of the Entryout API; '' means "same origin"
 * (development: the backend on http://localhost:8787 serves this site, so the
 * browser talks to the API on its own origin and CORS never applies).
 *
 * `demoMode: false` here keeps local development on the real backend. The
 * hosted demonstration builds (Vercel via scripts/vercel-build.mjs, GitHub
 * Pages via the deploy workflow) rewrite this file with `demoMode: true`,
 * which routes every API call to the in-browser demo adapter
 * (src/js/demo/api.js) — no backend, no external auth, per-browser data.
 */
window.ENTRYOUT_CONFIG = {
  apiBase: '',
  appName: 'Entryout',
  // Local development bypass: when true, the Student Portal / Staff sign-in
  // buttons open the dashboards directly with a demo test session instead of
  // the login page. The server independently gates this (DEV_BYPASS_AUTH,
  // never active when NODE_ENV=production).
  devBypassAuth: true,
  demoMode: false,
};
