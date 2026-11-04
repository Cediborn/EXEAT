/**
 * Writes the frontend runtime config (`window.ENTRYOUT_CONFIG`).
 *
 * Hosted builds used to be pinned to demo mode by hardcoded copies of this
 * object. They are now configured with environment variables instead:
 *
 *   ENTRYOUT_API_BASE          absolute API URL ('' = same origin as the site)
 *   ENTRYOUT_APP_NAME          display name (default "Entryout")
 *   ENTRYOUT_DEMO_MODE         "true" answers every call from the in-browser
 *                              demo adapter instead of the network
 *   ENTRYOUT_DEV_BYPASS_AUTH   local dashboard bypass flag (hosted: false)
 *
 * CLI: node scripts/write-config.mjs [outFile]     (default: config.js)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TRUTHY = ['true', '1', 'yes', 'on'];
const FALSY = ['false', '0', 'no', 'off'];

function flag(raw, fallback, name) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (TRUTHY.includes(value)) return true;
  if (FALSY.includes(value)) return false;
  throw new Error(`${name} must be true or false, got "${raw}".`);
}

function normalizeApiBase(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\/[^/\s]+/i.test(value)) {
    throw new Error(`ENTRYOUT_API_BASE must be an absolute http(s) URL, got "${raw}".`);
  }
  return value;
}

/** Build the runtime config object from environment variables. */
export function readRuntimeConfig(env = process.env, { demoMode = false, devBypassAuth = false } = {}) {
  return {
    apiBase: normalizeApiBase(env.ENTRYOUT_API_BASE),
    appName: String(env.ENTRYOUT_APP_NAME || 'Entryout').trim() || 'Entryout',
    devBypassAuth: flag(env.ENTRYOUT_DEV_BYPASS_AUTH, devBypassAuth, 'ENTRYOUT_DEV_BYPASS_AUTH'),
    demoMode: flag(env.ENTRYOUT_DEMO_MODE, demoMode, 'ENTRYOUT_DEMO_MODE'),
  };
}

/** Write the config file and return what was written. */
export function writeRuntimeConfig(outFile, options) {
  const config = readRuntimeConfig(process.env, options);
  const target = path.resolve(outFile);
  writeFileSync(target, `window.ENTRYOUT_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
  return { target, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] || 'config.js';
  const { config } = writeRuntimeConfig(out);
  console.log(
    `Wrote ${out}: apiBase=${config.apiBase || '(same origin)'}, ` +
      `demoMode=${config.demoMode}, devBypassAuth=${config.devBypassAuth}`,
  );
  if (!config.demoMode && !config.apiBase) {
    console.log('Demo mode is off with no apiBase: the site will call the API on its own origin.');
  }
}
