/**
 * Runtime configuration (see /config.js at the repository root).
 * apiBase === '' means "same origin" (development: the backend serves the site).
 */
const runtime = window.ENTRYOUT_CONFIG || {};

export const APP_NAME = runtime.appName || 'Entryout';

export const API_BASE = String(runtime.apiBase || '').replace(/\/$/, '');
