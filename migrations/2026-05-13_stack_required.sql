-- Tide v2 chunk 4 addendum: distinguish required-daily stack items from optional ones.
-- Additive. New rows default to optional (required=false); user marks Fin (or others)
-- as required from the Manage modal. Day-progress and full-stack streak then
-- denominate against required items only.

alter table tide_stack_items
  add column if not exists required boolean not null default false;

create index if not exists tide_stack_items_required_idx
  on tide_stack_items(required) where required = true;

notify pgrst, 'reload schema';
