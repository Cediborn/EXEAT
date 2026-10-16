/**
 * Vercel build step: rewrite config.js for the hosted demonstration build.
 * The static deploy has no backend, so demoMode routes all API traffic to the
 * in-browser demo adapter (src/js/demo/api.js) and apiBase stays same-origin.
 */
import { writeFileSync } from 'node:fs';

writeFileSync('config.js', `window.ENTRYOUT_CONFIG = {
  apiBase: '',
  appName: 'Entryout',
  devBypassAuth: false,
  demoMode: true,
};
`);
console.log('Wrote demo-mode config.js for the Vercel build.');
