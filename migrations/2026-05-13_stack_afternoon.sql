-- Tide v2 chunk 4 +: stack gets an 'afternoon' schedule bucket.
-- Existing 'as_needed' rows remain valid (no destructive change) but are no longer
-- rendered. Users re-add those items under a real time-of-day section.

alter table tide_stack_items
  drop constraint if exists tide_stack_items_schedule_check;

alter table tide_stack_items
  add constraint tide_stack_items_schedule_check
  check (schedule in ('morning', 'afternoon', 'evening', 'as_needed'));

notify pgrst, 'reload schema';
