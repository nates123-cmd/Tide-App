// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R3 — Stack streaks + day grouping.
 * stackItemStreak / fullStackStreak count consecutive logged days back from
 * today (or yesterday if today not yet logged), with a 60d floor and
 * required-item opt-in. Built on the real todayISO/addDays.
 */
test.describe('R3 stack streaks', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('stackItemStreak counts consecutive days back from today', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      const D = (n) => window.addDays(t, n);
      state.stackLogs = [
        { stack_item_id: 'i1', log_date: D(0) },
        { stack_item_id: 'i1', log_date: D(-1) },
        { stack_item_id: 'i1', log_date: D(-2) },
        // gap at D(-3)
        { stack_item_id: 'i1', log_date: D(-4) },
        { stack_item_id: 'i2', log_date: D(0) }, // unrelated item
      ];
      return { i1: window.stackItemStreak('i1'), missing: window.stackItemStreak('nope') };
    });
    expect(r.i1).toBe(3);     // today, -1, -2; stops at the -3 gap
    expect(r.missing).toBe(0);
  });

  test('stackItemStreak starts at yesterday when today is not yet logged', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      const D = (n) => window.addDays(t, n);
      state.stackLogs = [
        { stack_item_id: 'i1', log_date: D(-1) },
        { stack_item_id: 'i1', log_date: D(-2) },
        { stack_item_id: 'i1', log_date: D(-3) },
      ];
      return window.stackItemStreak('i1');
    });
    // Today not logged → cursor starts at yesterday → counts -1,-2,-3 = 3.
    expect(r).toBe(3);
  });

  test('stackItemStreak handles duplicate logs on the same day (counts the day once)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      const D = (n) => window.addDays(t, n);
      state.stackLogs = [
        { stack_item_id: 'i1', log_date: D(0) },
        { stack_item_id: 'i1', log_date: D(0) }, // dup same day
        { stack_item_id: 'i1', log_date: D(-1) },
      ];
      return window.stackItemStreak('i1');
    });
    expect(r).toBe(2);
  });

  test('fullStackStreak requires ALL required items each day and respects opt-in', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      const D = (n) => window.addDays(t, n);
      state.stackItems = [
        { id: 'm1', required: true, schedule: 'morning' },
        { id: 'm2', required: true, schedule: 'evening' },
        { id: 'opt', required: false, schedule: 'morning' }, // not required
        { id: 'an', required: true, schedule: 'as_needed' }, // skipped (as_needed)
      ];
      // Both required items logged today and yesterday; only m1 the day before.
      state.stackLogs = [
        { stack_item_id: 'm1', log_date: D(0) }, { stack_item_id: 'm2', log_date: D(0) },
        { stack_item_id: 'm1', log_date: D(-1) }, { stack_item_id: 'm2', log_date: D(-1) },
        { stack_item_id: 'm1', log_date: D(-2) }, // m2 missing on -2 → breaks streak
      ];
      return window.fullStackStreak();
    });
    expect(r).toBe(2); // today + yesterday only
  });

  test('fullStackStreak returns 0 when no items are marked required', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      state.stackItems = [{ id: 'm1', required: false, schedule: 'morning' }];
      state.stackLogs = [{ stack_item_id: 'm1', log_date: t }];
      return window.fullStackStreak();
    });
    expect(r).toBe(0);
  });

  test('hitDayExists enforces the 60-day floor', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.todayISO();
      return {
        recent: window.hitDayExists(window.addDays(t, -30)),
        edge:   window.hitDayExists(window.addDays(t, -60)),
        tooOld: window.hitDayExists(window.addDays(t, -61)),
      };
    });
    expect(r.recent).toBe(true);
    expect(r.edge).toBe(true);
    expect(r.tooOld).toBe(false);
  });
});
