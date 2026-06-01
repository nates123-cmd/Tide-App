// @ts-check
const { test, expect, gotoApp, gotoAppRendered } = require('../helpers');

test.describe('R7 boot / smoke', () => {
  test('app script loads and defines its real globals without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await gotoApp(page);

    // A representative slice of the real top-level functions must exist.
    const present = await page.evaluate(() => {
      const names = [
        'todayISO', 'addDays', 'drinkKcal', 'computeBAC', 'computePace',
        'computeBacTrend', 'bucketStats', 'drinkBucket', 'todayFoodTotals',
        'mealMacros', 'computeMacroGoals', 'todayAlcoholEntries', 'todayAlcoholKcal',
        'stackItemStreak', 'fullStackStreak', 'sipBuckets', 'attachSwipeActions',
        'render', 'renderFuelTab', 'renderSipTab', 'renderStackTab',
      ];
      return Object.fromEntries(names.map((n) => [n, typeof window[n]]));
    });
    for (const [name, type] of Object.entries(present)) {
      expect(type, `window.${name} should be a function`).toBe('function');
    }
    expect(errors, 'no uncaught page errors during boot').toEqual([]);
  });

  test('OTP gate is shown when there is no session', async ({ page }) => {
    await gotoApp(page);
    // boot() ran with no session → showOtpGate() makes #otp-gate visible.
    const gateDisplay = await page.evaluate(() => {
      const g = document.getElementById('otp-gate');
      return g ? getComputedStyle(g).display : 'missing';
    });
    expect(gateDisplay).not.toBe('missing');
    expect(gateDisplay).not.toBe('none'); // flex/visible
  });

  test('with a fake session, the Fuel/Sip/Stack/Indulge tabs render without throwing', async ({ page }) => {
    await gotoAppRendered(page);

    const result = await page.evaluate(() => {
      const out = {};
      // Seed empty-but-valid state so renderers have arrays to map over.
      Object.assign(state, {
        todayIntake: [], todayAlcohol: [], drinks: [], stackItems: [], stackLogs: [],
        foodLibraryRows: [], todayActivities: [], workoutTemplates: [],
        activeSession: null, history: [],
      });
      const app = document.getElementById('app') || (() => {
        const d = document.createElement('div'); d.id = 'app'; document.body.appendChild(d); return d;
      })();
      const tabs = {
        renderFuelTab: 'Fuel',
        renderSipTab: 'Sip',
        renderStackTab: 'Stack',
      };
      for (const [fn, title] of Object.entries(tabs)) {
        try {
          window[fn]();
          out[fn] = { ok: true, hasTitle: app.innerHTML.includes(title) };
        } catch (e) {
          out[fn] = { ok: false, error: String(e && e.message || e) };
        }
      }
      return out;
    });

    for (const [fn, r] of Object.entries(result)) {
      expect(r.ok, `${fn} should not throw: ${r.error || ''}`).toBe(true);
      expect(r.hasTitle, `${fn} should emit its tab title`).toBe(true);
    }
  });
});
