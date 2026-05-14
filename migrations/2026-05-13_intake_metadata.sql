-- Tide v2 chunk 5: store kcal + macros (and arbitrary future fields) on intake rows.
-- Additive. Safe to re-run.

alter table tide_intake_logs
  add column if not exists metadata jsonb;

notify pgrst, 'reload schema';
