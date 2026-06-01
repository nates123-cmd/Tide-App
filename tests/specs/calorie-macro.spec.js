// @ts-check
const { test, expect, gotoApp } = require('../helpers');

/**
 * R1 — Calorie / macro aggregation + ring totals.
 * Exercises the REAL todayFoodTotals / mealMacros / drinkKcal / todayAlcohol*
 * / computeMacroGoals by seeding state and calling the functions.
 */
test.describe('R1 calorie & macro math', () => {
  test.beforeEach(async ({ page }) => { await gotoApp(page); });

  test('mealMacros coerces metadata and defaults missing fields to 0', async ({ page }) => {
    const r = await page.evaluate(() => ({
      full:    window.mealMacros({ metadata: { kcal: '320', protein_g: 22, carbs_g: '28', fat_g: 8 } }),
      partial: window.mealMacros({ metadata: { kcal: 100 } }),
      none:    window.mealMacros({ metadata: {} }),
      noMeta:  window.mealMacros({}),
      nullRow: window.mealMacros(null),
      junk:    window.mealMacros({ metadata: { kcal: 'abc' } }),
    }));
    expect(r.full).toEqual({ kcal: 320, protein_g: 22, carbs_g: 28, fat_g: 8 });
    expect(r.partial).toEqual({ kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(r.none).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(r.noMeta).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(r.nullRow).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(r.junk.kcal).toBe(0); // NaN || 0 → 0
  });

  test('todayFoodTotals sums food rows and EXCLUDES template/recipe rows + non-food', async ({ page }) => {
    const totals = await page.evaluate(() => {
      state.todayIntake = [
        { category: 'food', metadata: { kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 } },
        { category: 'food', metadata: { kcal: 500, protein_g: 40, carbs_g: 50, fat_g: 15 } },
        { category: 'food', metadata: { kcal: 999, template: true, protein_g: 99 } }, // recipe template, excluded
        { category: 'water', metadata: { kcal: 0 } },                                  // not food
        { category: 'caffeine' },                                                       // not food
      ];
      return window.todayFoodTotals();
    });
    expect(totals).toEqual({ kcal: 800, protein_g: 60, carbs_g: 80, fat_g: 25 });
  });

  test('drinkKcal uses the per-type table, scales by standard_units, and falls back to 100/unit', async ({ page }) => {
    const r = await page.evaluate(() => ({
      beer1:     window.drinkKcal({ drink_type: 'beer', standard_units: 1 }),
      wine2:     window.drinkKcal({ drink_type: 'wine', standard_units: 2 }),
      cocktail:  window.drinkKcal({ drink_type: 'cocktail', standard_units: 1.5 }),
      spirits:   window.drinkKcal({ drink_type: 'spirits', standard_units: 1 }),
      unknown:   window.drinkKcal({ drink_type: 'mystery', standard_units: 2 }), // fallback 100/unit
      noUnits:   window.drinkKcal({ drink_type: 'beer' }),                       // units default 1
      noType:    window.drinkKcal({ standard_units: 3 }),                        // fallback 100/unit
    }));
    expect(r.beer1).toBe(150);
    expect(r.wine2).toBe(250);
    expect(r.cocktail).toBe(225);   // 150 * 1.5
    expect(r.spirits).toBe(100);
    expect(r.unknown).toBe(200);    // 100 * 2
    expect(r.noUnits).toBe(150);    // beer * 1
    expect(r.noType).toBe(300);     // 100 * 3
  });

  test('todayAlcoholEntries merges state.drinks + state.todayAlcohol deduped by id, alcohol-only', async ({ page }) => {
    const r = await page.evaluate(() => {
      const today = window.todayISO();
      state.todayAlcohol = [
        { id: 'a', kind: 'alcohol', drink_type: 'beer', standard_units: 1, log_date: today },
        { id: 'b', kind: 'alcohol', drink_type: 'wine', standard_units: 1, log_date: today },
      ];
      // Active session drinks: one duplicate id ('b' updated), one new ('c'),
      // one coded entry (must be filtered out), one from a different day (dropped).
      state.drinks = [
        { id: 'b', kind: 'alcohol', drink_type: 'spirits', standard_units: 2, log_date: today }, // overrides 'b'
        { id: 'c', kind: 'alcohol', drink_type: 'beer', standard_units: 1, log_date: today },
        { id: 'd', kind: 'coded', log_date: today },
        { id: 'e', kind: 'alcohol', drink_type: 'beer', standard_units: 1, log_date: window.addDays(today, -1) },
      ];
      const entries = window.todayAlcoholEntries();
      return {
        ids: entries.map((e) => e.id).sort(),
        bOverridden: entries.find((e) => e.id === 'b'),
        kcal: window.todayAlcoholKcal(),
      };
    });
    // 'd' (coded) and 'e' (yesterday) excluded; 'b' overridden by the session copy.
    expect(r.ids).toEqual(['a', 'b', 'c']);
    expect(r.bOverridden.drink_type).toBe('spirits');
    // kcal: a=beer*1=150, b=spirits*2=200, c=beer*1=150 → 500
    expect(r.kcal).toBe(500);
  });

  test('ring energyTotal = food kcal + alcohol kcal, macros stay food-only', async ({ page }) => {
    const r = await page.evaluate(() => {
      const today = window.todayISO();
      state.todayIntake = [
        { category: 'food', metadata: { kcal: 600, protein_g: 40, carbs_g: 50, fat_g: 20 } },
      ];
      state.todayAlcohol = [
        { id: 'x', kind: 'alcohol', drink_type: 'beer', standard_units: 2, log_date: today },
      ];
      state.drinks = [];
      const food = window.todayFoodTotals();
      const alc = window.todayAlcoholKcal();
      return { food, alc, energyTotal: food.kcal + alc };
    });
    expect(r.alc).toBe(300);           // beer * 2
    expect(r.energyTotal).toBe(900);   // 600 food + 300 alcohol
    // Macros derive from food only — alcohol contributes no P/C/F.
    expect(r.food.protein_g).toBe(40);
    expect(r.food.carbs_g).toBe(50);
    expect(r.food.fat_g).toBe(20);
  });

  test('computeMacroGoals returns a coherent split that sums near the kcal goal', async ({ page }) => {
    const r = await page.evaluate(() => {
      const noProfile = window.computeMacroGoals(null); // → DEFAULT_KCAL_GOAL fallback
      const withWeight = window.computeMacroGoals({ weight_lb: 180 });
      return { noProfile, withWeight };
    });
    // No profile → falls back to DEFAULT_KCAL_GOAL (1800) with a valid split.
    expect(r.noProfile.kcal).toBe(1800);
    expect(r.noProfile.protein_g).toBeGreaterThan(0);
    expect(r.noProfile.carbs_g).toBeGreaterThanOrEqual(0);
    expect(r.noProfile.fat_g).toBeGreaterThan(0);
    // Reconstructed kcal from the split should be within a rounding band of goal.
    const recon = r.noProfile.protein_g * 4 + r.noProfile.carbs_g * 4 + r.noProfile.fat_g * 9;
    expect(Math.abs(recon - r.noProfile.kcal)).toBeLessThanOrEqual(20);
    // Protein anchored to bodyweight when weight present (0.75 g/lb).
    expect(r.withWeight.protein_g).toBe(135); // 180 * 0.75
  });
});
