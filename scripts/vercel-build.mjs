/**
 * Vercel build step: write config.js for the deploy.
 *
 * The default keeps the hosted demonstration (demoMode: true) exactly as
 * before. Set ENTRYOUT_API_BASE (and ENTRYOUT_DEMO_MODE=false) in the Vercel
 * project to point the static site at a real API instead.
 */
import { writeRuntimeConfig } from './write-config.mjs';

const { config } = writeRuntimeConfig('config.js', { demoMode: true, devBypassAuth: false });
console.log(
  `Wrote config.js for the Vercel build: apiBase=${config.apiBase || '(same origin)'}, ` +
    `demoMode=${config.demoMode}, devBypassAuth=${config.devBypassAuth}`,
);
