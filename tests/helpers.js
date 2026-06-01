// @ts-check
const { test: base, expect } = require('@playwright/test');

/**
 * Shared test fixtures for the Tide PWA harness.
 *
 * Design goals:
 *  - Load the REAL index.html and let its real top-level <script> run so every
 *    app function (todayISO, drinkKcal, computeBAC, bucketStats, ...) is defined
 *    on the page as a window global. Tests then call them via page.evaluate.
 *  - Never touch the network. The app's boot() fires Supabase/Oura/Claude
 *    requests; we abort every non-localhost request so tests are hermetic and
 *    fast. boot() swallows those failures (.catch), so the page stays usable.
 *  - Avoid the service worker caching a stale build between runs.
 */

const APP_URL = '/index.html';

/**
 * Install a route handler that lets localhost (the static server) through and
 * aborts everything else (Supabase REST/auth, api.anthropic.com, fonts, etc.).
 */
async function blockExternalNetwork(page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
}

/**
 * Navigate to the app and wait until its script has defined the globals we
 * test. We do NOT require boot() to fully succeed (it needs network); we only
 * need the function declarations to exist, which happens synchronously when the
 * <script> runs.
 */
/**
 * Neutralize the service worker. The app registers sw.js and reloads the page
 * on `controllerchange` (location.reload()), which destroys Playwright's
 * execution context mid-test. We stub registration to a never-settling promise
 * so no SW ever takes control. Must run before the app script.
 */
async function disableServiceWorker(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      try {
        Object.defineProperty(navigator.serviceWorker, 'register', {
          configurable: true,
          value: () => new Promise(() => {}),
        });
      } catch (_) { /* read-only in some engines; route-abort still covers sw.js */ }
    }
  });
}

async function gotoApp(page) {
  await blockExternalNetwork(page);
  await disableServiceWorker(page);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  // Wait for the app script to finish defining top-level functions.
  await page.waitForFunction(() => typeof window.todayISO === 'function', null, { timeout: 10_000 });
}

/**
 * Boot far enough to render a real tab. boot() bails to the OTP gate when there
 * is no session, so we plant a fake session + API key in localStorage BEFORE
 * navigation, then re-run the app's own render path. We stub the few async
 * loaders' inputs by seeding window.state directly after the script loads.
 */
async function gotoAppRendered(page) {
  await blockExternalNetwork(page);
  await disableServiceWorker(page);
  await page.addInitScript(() => {
    // Fake an authenticated session so hasSession() passes and boot() doesn't
    // show the OTP gate. These tokens are never sent anywhere (network blocked).
    // SB_AUTH_KEY in the app == 'sb-<project-ref>-auth-token'.
    localStorage.setItem('sb-xsmnfcmtbpeaccnyinkr-auth-token', JSON.stringify({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }));
    // A non-empty API key so getKey() passes and render() shows a tab, not the
    // key form. (No Claude call is made on render.)
    localStorage.setItem('anthropic_api_key', 'test-key');
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.render === 'function', null, { timeout: 10_000 });
}

const test = base.extend({});

module.exports = { test, expect, gotoApp, gotoAppRendered, blockExternalNetwork, APP_URL };
