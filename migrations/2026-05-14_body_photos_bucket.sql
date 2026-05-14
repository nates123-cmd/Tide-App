-- Tide v2 chunk 10.5: Supabase Storage bucket for body photos.
-- Idempotent. Bucket is PRIVATE; the app fetches signed URLs with short TTL.

insert into storage.buckets (id, name, public)
values ('tide-body-photos', 'tide-body-photos', false)
on conflict (id) do nothing;

-- Single-user anon-key app — grant anon full access to this bucket only.
-- (Storage policies live on storage.objects, not the buckets table.)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'tide body photos anon all'
  ) then
    create policy "tide body photos anon all"
      on storage.objects
      for all
      to anon, authenticated
      using (bucket_id = 'tide-body-photos')
      with check (bucket_id = 'tide-body-photos');
  end if;
end $$;

notify pgrst, 'reload schema';
