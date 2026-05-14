-- Tide v2 chunk 7 +: add target reps and target weight to template exercises.
-- Additive. Weight in lb to match the user's imperial profile.

alter table tide_workout_template_exercises
  add column if not exists target_reps int;

alter table tide_workout_template_exercises
  add column if not exists target_weight_lb numeric;

notify pgrst, 'reload schema';
