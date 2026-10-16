/**
 * Runtime configuration (see /config.js at the repository root).
 * apiBase === '' means "same origin" (development: the backend serves the site).
 */
const runtime = window.ENTRYOUT_CONFIG || {};

export const APP_NAME = runtime.appName || 'Entryout';

export const API_BASE = String(runtime.apiBase || '').replace(/\/$/, '');

/**
 * True only when the local dev config explicitly enables the temporary
 * dashboard bypass. Production (GitHub Pages) config always ships false, and
 * even if it were flipped the API would refuse the dev session anyway.
 */
export const DEV_BYPASS_AUTH = runtime.devBypassAuth === true || runtime.devBypassAuth === 'true';
