// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R5 — Patterns bucketing.
 * drinkBucket thresholds + bucketStats averaging (null when n=0, ignores null
 * metric values). Powers the Patterns chart / digest evidence lens.
 */
test.describe('R5 bucketing & averaging', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('drinkBucket maps counts to the four tiers', async ({ page }) => {
    const r = await page.evaluate(() => ({
      zero:  window.drinkBucket(0),
      one:   window.drinkBucket(1),
      two:   window.drinkBucket(2),
      three: window.drinkBucket(3),
      four:  window.drinkBucket(4),
      five:  window.drinkBucket(5),
      ten:   window.drinkBucket(10),
    }));
    expect(r.zero).toBe('0');
    expect(r.one).toBe('1-2');
    expect(r.two).toBe('1-2');
    expect(r.three).toBe('3-4');
    expect(r.four).toBe('3-4');
    expect(r.five).toBe('5+');
    expect(r.ten).toBe('5+');
  });

  test('bucketStats averages per bucket and returns null for empty buckets', async ({ page }) => {
    const r = await page.evaluate(() => {
      const rows = [
        { bucket: '0', sleep_score: 80 },
        { bucket: '0', sleep_score: 90 },
        { bucket: '1-2', sleep_score: 70 },
        { bucket: '3-4', sleep_score: 60 },
        { bucket: '3-4', sleep_score: 50 },
        // '5+' has no rows
      ];
      return window.bucketStats(rows, 'sleep_score');
    });
    expect(r['0']).toBe(85);    // (80+90)/2
    expect(r['1-2']).toBe(70);
    expect(r['3-4']).toBe(55);  // (60+50)/2
    expect(r['5+']).toBeNull(); // no data → null
  });

  test('bucketStats ignores rows where the metric key is null/undefined', async ({ page }) => {
    const r = await page.evaluate(() => {
      const rows = [
        { bucket: '1-2', hrv_avg: 40 },
        { bucket: '1-2', hrv_avg: null },      // skipped
        { bucket: '1-2', hrv_avg: undefined }, // skipped
        { bucket: '1-2', hrv_avg: 60 },
      ];
      return window.bucketStats(rows, 'hrv_avg');
    });
    expect(r['1-2']).toBe(50); // only 40 & 60 counted → mean 50
  });

  test('bucketStats over all-empty input yields null for every bucket', async ({ page }) => {
    const r = await page.evaluate(() => window.bucketStats([], 'sleep_score'));
    expect(r).toEqual({ '0': null, '1-2': null, '3-4': null, '5+': null });
  });
});
