// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R6 — Sip hourly distribution + edit/delete (swipe) wiring.
 * sipBuckets: 12 buckets, 1.2h wide, starting at 6am; now-bucket clamped to
 * [0,11]. attachSwipeActions: reveals delete on left-swipe and reschedule on
 * right-swipe, with a per-row data-id passed to the callbacks.
 */
test.describe('R6 sip buckets', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('sipBuckets assigns logs to the correct 1.2h bucket from 6am', async ({ page }) => {
    const r = await page.evaluate(() => {
      // Build a logged_at at a chosen LOCAL hour today (sipBuckets reads local h).
      const atHour = (h, m = 0) => {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const rows = [
        { logged_at: atHour(6, 0),  quantity: 250 },  // 6.0h → bucket 0
        { logged_at: atHour(7, 12), quantity: 500 },  // 7.2h → (1.2/1.2)=1 → bucket 1
        { logged_at: atHour(6, 30), quantity: 100 },  // 6.5h → bucket 0
        { logged_at: atHour(5, 0),  quantity: 999 },  // before 6am → dropped
        { logged_at: atHour(23, 0), quantity: 999 },  // past bucket 11 window → dropped
      ];
      const { buckets } = window.sipBuckets(rows, 'quantity');
      return { buckets, len: buckets.length };
    });
    expect(r.len).toBe(12);
    expect(r.buckets[0]).toBe(350);  // 250 + 100
    expect(r.buckets[1]).toBe(500);
    // Anything before 6am or after the 12th bucket is excluded entirely.
    expect(r.buckets.reduce((a, b) => a + b, 0)).toBe(850);
  });

  test('sipBuckets nowBucket is always within [0,11]', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { nowBucket } = window.sipBuckets([], 'quantity');
      return nowBucket;
    });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(11);
  });

  test('sipBuckets coerces non-numeric quantities to 0', async ({ page }) => {
    const r = await page.evaluate(() => {
      const d = new Date(); d.setHours(8, 0, 0, 0);
      const iso = d.toISOString();
      const { buckets } = window.sipBuckets([
        { logged_at: iso, quantity: 'oops' },
        { logged_at: iso, quantity: 200 },
      ], 'quantity');
      return buckets.reduce((a, b) => a + b, 0);
    });
    expect(r).toBe(200);
  });
});

test.describe('R6 swipe edit/delete wiring (real attachSwipeActions)', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  // Builds two rows with swipe markup, attaches the REAL handler, and returns a
  // probe object for driving from the test.
  async function buildRows(page) {
    await page.evaluate(() => {
      // boot() (no session) leaves the fixed full-screen #otp-gate (z-index 9999)
      // on top, which would swallow synthetic mouse events. Remove it so the
      // drag lands on .swipe-content.
      const gate = document.getElementById('otp-gate');
      if (gate) gate.remove();
      const app = document.getElementById('app') || (() => {
        const d = document.createElement('div'); d.id = 'app'; document.body.appendChild(d); return d;
      })();
      // The action panels sit BEHIND the content (z-index/layout) in the real
      // app; here we keep them at the edges but make .swipe-content the topmost
      // hit target across the whole row so the synthetic mousedown lands on it
      // (its mousedown handler is what starts the drag).
      app.innerHTML = `
        <div class="swipe-row" data-id="row-A" style="position:relative;width:320px;height:40px">
          <div class="swipe-action-left" style="position:absolute;left:0;top:0;z-index:0">→ Yesterday</div>
          <div class="swipe-action" style="position:absolute;right:0;top:0;z-index:0">Delete</div>
          <div class="swipe-content" style="position:relative;z-index:1;width:320px;height:40px;background:#eee">A</div>
        </div>`;
      window.__sw = { deleted: [], rescheduled: [] };
      const rows = app.querySelectorAll('.swipe-row');
      window.attachSwipeActions(rows, {
        onDelete: (id) => { window.__sw.deleted.push(id); },
        onReschedule: (id) => { window.__sw.rescheduled.push(id); },
      });
    });
  }

  // Drive a mouse drag that begins firmly on .swipe-content (not the edge
  // action panels) and moves by dx pixels horizontally. If hold=true the button
  // is NOT released, so the open transform can be asserted mid-gesture (on
  // desktop, mouseup synthesizes a click that the real handler uses to re-close
  // an opened row — so we assert the open state during the live drag).
  async function dragContent(page, dx, { hold = false } = {}) {
    const content = page.locator('.swipe-row[data-id="row-A"] .swipe-content');
    const box = await content.boundingBox();
    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + dx, y, { steps: 10 });
    if (!hold) await page.mouse.up();
    return content;
  }

  test('left-swipe past commit translates the row left to reveal the delete panel', async ({ page }) => {
    await buildRows(page);
    // Hold the drag open and read the live transform (> COMMIT 44 px left).
    const content = await dragContent(page, -90, { hold: true });
    const transform = await content.evaluate((el) => el.style.transform);
    await page.mouse.up();
    // setX clamps left to -110; a 90px drag lands at -90 → comfortably past the
    // 44px commit threshold, exposing the right-side delete action.
    const x = Number((transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/) || [])[1]);
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeLessThanOrEqual(-44);
  });

  test('clicking the revealed Delete action fires onDelete with the row id', async ({ page }) => {
    await buildRows(page);
    // The action button has its own click listener wired by attachSwipeActions,
    // independent of the open transform — this is the delete wiring itself.
    await page.locator('.swipe-row[data-id="row-A"] .swipe-action').dispatchEvent('click');
    const deleted = await page.evaluate(() => window.__sw.deleted);
    expect(deleted).toContain('row-A');
  });

  test('right-swipe past commit translates the row right to reveal the reschedule panel', async ({ page }) => {
    await buildRows(page);
    const content = await dragContent(page, 90, { hold: true });
    const transform = await content.evaluate((el) => el.style.transform);
    await page.mouse.up();
    const x = Number((transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/) || [])[1]);
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(44); // past commit → left reschedule panel shown
  });

  test('clicking the revealed Reschedule action fires onReschedule with the row id', async ({ page }) => {
    await buildRows(page);
    await page.locator('.swipe-row[data-id="row-A"] .swipe-action-left').dispatchEvent('click');
    const resched = await page.evaluate(() => window.__sw.rescheduled);
    expect(resched).toContain('row-A');
  });

  test('a small drag below the commit threshold snaps back closed (tap-to-edit preserved)', async ({ page }) => {
    await buildRows(page);
    const content = await dragContent(page, -20); // 20 < COMMIT 44, released
    const transform = await content.evaluate((el) => el.style.transform);
    // close() sets transform to '' (snaps back) — neither panel stays open.
    expect(transform === '' || transform === 'translateX(0px)').toBe(true);
  });
});
