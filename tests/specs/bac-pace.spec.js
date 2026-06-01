// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R4 — BAC / pace estimation.
 * computeBAC (Widmark with sex/age-adjusted r and β decay), computePace
 * (per-hour, 15-min floor), computeBacTrend (15-min-ago delta). Timestamps are
 * built relative to Date.now() inside the page so wall-clock doesn't matter.
 */
test.describe('R4 BAC & pace', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('computeBAC returns null when profile is missing or no drinks (column must hide)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const drink = { drink_at: new Date(now).toISOString(), standard_units: 1 };
      return {
        noProfile: window.computeBAC([drink], null),
        noDrinks: window.computeBAC([], { age: 30, gender: 'male', weight_lb: 180 }),
      };
    });
    expect(r.noProfile).toBeNull();
    expect(r.noDrinks).toBeNull();
  });

  test('computeBAC is positive for a fresh drink and never negative after long decay', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const profile = { age: 30, gender: 'male', weight_lb: 180 };
      const fresh = window.computeBAC(
        [{ drink_at: new Date(now - 5 * 60 * 1000).toISOString(), standard_units: 3 }],
        profile
      );
      // One small drink 20 hours ago → fully metabolized, must clamp at 0 (not negative).
      const decayed = window.computeBAC(
        [{ drink_at: new Date(now - 20 * 3600 * 1000).toISOString(), standard_units: 1 }],
        profile
      );
      return { freshBac: fresh.bac, freshStatus: fresh.status, decayed: decayed.bac };
    });
    expect(r.freshBac).toBeGreaterThan(0);
    expect(r.decayed).toBe(0);          // clamped, never negative
    expect(['safe', 'moderate', 'high', 'over']).toContain(r.freshStatus);
  });

  test('computeBAC scales monotonically with drink count', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const profile = { age: 30, gender: 'male', weight_lb: 180 };
      const at = new Date(now - 5 * 60 * 1000).toISOString();
      const one = window.computeBAC([{ drink_at: at, standard_units: 1 }], profile).bac;
      const four = window.computeBAC([
        { drink_at: at, standard_units: 1 }, { drink_at: at, standard_units: 1 },
        { drink_at: at, standard_units: 1 }, { drink_at: at, standard_units: 1 },
      ], profile).bac;
      return { one, four };
    });
    expect(r.four).toBeGreaterThan(r.one);
  });

  test('computeBAC: female r gives higher BAC than male at equal dose/weight', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const at = new Date(now - 5 * 60 * 1000).toISOString();
      const drinks = [{ drink_at: at, standard_units: 3 }];
      const male = window.computeBAC(drinks, { age: 30, gender: 'male', weight_lb: 160 }).bac;
      const female = window.computeBAC(drinks, { age: 30, gender: 'female', weight_lb: 160 }).bac;
      return { male, female };
    });
    // Smaller r (female 0.55 vs male 0.68) → larger BAC for the same grams/weight.
    expect(r.female).toBeGreaterThan(r.male);
  });

  test('computePace floors elapsed at 15min and labels status by per-hour rate', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      // 3 drinks all in the last few minutes → elapsed floored to 0.25h → ~12/hr → fast.
      const burst = [
        { drink_at: new Date(now - 2 * 60000).toISOString(), standard_units: 1 },
        { drink_at: new Date(now - 1 * 60000).toISOString(), standard_units: 1 },
        { drink_at: new Date(now).toISOString(), standard_units: 1 },
      ];
      const slow = [
        { drink_at: new Date(now - 4 * 3600000).toISOString(), standard_units: 1 },
        { drink_at: new Date(now - 1 * 3600000).toISOString(), standard_units: 1 },
      ];
      return {
        empty: window.computePace([]),
        burst: window.computePace(burst),
        slow: window.computePace(slow),
      };
    });
    expect(r.empty.status).toBe('none');
    expect(r.empty.perHour).toBe(0);
    expect(r.burst.status).toBe('fast');        // >= 2.5/hr
    expect(r.burst.perHour).toBeGreaterThan(2.5);
    expect(r.slow.status).toBe('easy');         // ~0.5/hr over 4h
    expect(r.slow.minSinceLast).toBeGreaterThanOrEqual(59); // last drink ~1h ago
  });

  test('computeBacTrend reports "first read" when all drinks are within 15min', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const profile = { age: 30, gender: 'male', weight_lb: 180 };
      const drinks = [{ drink_at: new Date(now - 5 * 60000).toISOString(), standard_units: 2 }];
      const bac = window.computeBAC(drinks, profile);
      return window.computeBacTrend(drinks, profile, bac.bac);
    });
    expect(r).toBe('first read');
  });

  test('computeBacTrend reports "trending up" right after a new drink on top of an old one', async ({ page }) => {
    const r = await page.evaluate(() => {
      const now = Date.now();
      const profile = { age: 30, gender: 'male', weight_lb: 180 };
      const drinks = [
        { drink_at: new Date(now - 60 * 60000).toISOString(), standard_units: 1 }, // 1h ago (past)
        { drink_at: new Date(now - 2 * 60000).toISOString(), standard_units: 2 },  // just now (recent)
      ];
      const bac = window.computeBAC(drinks, profile);
      return window.computeBacTrend(drinks, profile, bac.bac);
    });
    expect(r).toBe('trending up');
  });
});
