// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R2 — Logical-day + date helpers.
 * todayISO(): local date of (now - 5h); addDays(): UTC-pure YYYY-MM-DD math.
 * These power every day-bucketed query, streak, and "Today" filter.
 */
test.describe('R2 date helpers (real todayISO / addDays)', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('addDays is UTC-pure: round-trips and crosses month/year boundaries', async ({ page }) => {
    const r = await page.evaluate(() => ({
      plus1:        window.addDays('2026-01-31', 1),   // month roll
      minus1:       window.addDays('2026-03-01', -1),  // back across Feb (2026 not leap → Feb 28)
      yearRollFwd:  window.addDays('2026-12-31', 1),
      yearRollBack: window.addDays('2026-01-01', -1),
      leapForward:  window.addDays('2024-02-28', 1),   // 2024 IS leap → Feb 29
      zero:         window.addDays('2026-06-01', 0),
      roundTrip:    window.addDays(window.addDays('2026-06-01', 30), -30),
      far:          window.addDays('2026-06-01', -90),
    }));
    expect(r.plus1).toBe('2026-02-01');
    expect(r.minus1).toBe('2026-02-28');
    expect(r.yearRollFwd).toBe('2027-01-01');
    expect(r.yearRollBack).toBe('2025-12-31');
    expect(r.leapForward).toBe('2024-02-29');
    expect(r.zero).toBe('2026-06-01');
    expect(r.roundTrip).toBe('2026-06-01');
    expect(r.far).toBe('2026-03-03');
  });

  test('addDays does not drift by local timezone offset (the documented v1 bug)', async ({ page }) => {
    // The whole point of the UTC-component rewrite: adding 1 day to any date and
    // subtracting 1 must return the original string regardless of machine tz.
    const ok = await page.evaluate(() => {
      const dates = ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25']; // DST switch days in US/EU
      return dates.every((d) => window.addDays(window.addDays(d, 1), -1) === d
                              && window.addDays(window.addDays(d, -1), 1) === d);
    });
    expect(ok).toBe(true);
  });

  test('todayISO returns a valid YYYY-MM-DD and applies the 5am rollover offset', async ({ page }) => {
    const r = await page.evaluate(() => {
      const iso = window.todayISO();
      // Reconstruct what the function does: local date of (now - 5h).
      const d = new Date(Date.now() - 5 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return { iso, expected, shape: /^\d{4}-\d{2}-\d{2}$/.test(iso) };
    });
    expect(r.shape).toBe(true);
    expect(r.iso).toBe(r.expected);
  });

  test('todayISO is consistent with addDays for "yesterday"', async ({ page }) => {
    const r = await page.evaluate(() => {
      const today = window.todayISO();
      return { today, back1: window.addDays(today, -1), fwd1: window.addDays(today, 1) };
    });
    // Yesterday then forward a day returns today; basic continuity used by streaks.
    expect(r.back1 < r.today).toBe(true);
    expect(r.fwd1 > r.today).toBe(true);
  });
});
