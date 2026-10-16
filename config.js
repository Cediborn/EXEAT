/**
 * Runtime configuration for the Entryout frontend.
 *
 * `apiBase` is the absolute URL of the Entryout API. An empty string means
 * "same origin", which is correct when the backend also serves this site
 * (local development). When the site is hosted separately (GitHub Pages) the
 * deploy workflow rewrites this file with the value of the API_BASE_URL
 * repository variable. If that variable is missing the app keeps working as a
 * front-end but shows an honest "backend not connected" notice instead of
 * pretending data is real.
 */
window.ENTRYOUT_CONFIG = {
  apiBase: '',
  appName: 'Entryout',
};
