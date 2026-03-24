-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — extend saved_routes with richer columns
-- Run in Supabase SQL Editor or via: supabase db push
-- ─────────────────────────────────────────────────────────────────────────────

alter table saved_routes
  add column if not exists location_lat      double precision,
  add column if not exists location_lon      double precision,
  add column if not exists distance_km       double precision,
  add column if not exists terrain           text,
  add column if not exists difficulty        text,
  add column if not exists estimated_duration double precision,
  add column if not exists waypoints         jsonb,
  add column if not exists gpx_url           text,
  add column if not exists highlights        jsonb,
  add column if not exists launch_point      text,
  add column if not exists travel_from_base  text,
  add column if not exists travel_time_min   integer,
  add column if not exists description       text;

-- Storage bucket for GPX files (run once — idempotent via insert-if-not-exists)
insert into storage.buckets (id, name, public)
  values ('gpx-routes', 'gpx-routes', true)
  on conflict (id) do nothing;

-- Allow authenticated users to upload their own GPX files
create policy if not exists "Authenticated users can upload GPX"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'gpx-routes' AND (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists "GPX files are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'gpx-routes');

create policy if not exists "Users can delete own GPX files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'gpx-routes' AND (storage.foldername(name))[1] = auth.uid()::text);
