-- PropertyFlow initial schema.
-- Writes happen only through the importer (database owner role over the session pooler).
-- The web app reads with the publishable key, i.e. as `anon`, constrained by RLS + grants.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Sources: one row per feed publisher.
-- ---------------------------------------------------------------------------
create table public.sources (
  id           smallint generated always as identity primary key,
  name         text not null unique check (name ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  adapter_type text not null,
  feed_mode    text not null check (feed_mode in ('full_snapshot', 'incremental')),
  status       text not null default 'active' check (status in ('active', 'disabled')),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Import runs: one row per importer execution (dry runs are not recorded).
-- error_summary must only ever contain sanitised, public-safe text.
-- ---------------------------------------------------------------------------
create table public.import_runs (
  id                     bigint generated always as identity primary key,
  source_id              smallint not null references public.sources (id),
  adapter_type           text not null,
  status                 text not null default 'CREATED' check (status in (
                           'CREATED', 'FETCHED', 'PARSED', 'VALIDATED', 'IMPORTING', 'COMPLETED', 'FAILED')),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  feed_checksum          text,
  feed_bytes             bigint,
  feed_record_count      integer check (feed_record_count >= 0),
  inserted_count         integer not null default 0 check (inserted_count >= 0),
  updated_count          integer not null default 0 check (updated_count >= 0),
  unchanged_count        integer not null default 0 check (unchanged_count >= 0),
  error_count            integer not null default 0 check (error_count >= 0),
  removal_preview_count  integer not null default 0 check (removal_preview_count >= 0),
  deactivated_count      integer not null default 0 check (deactivated_count >= 0),
  error_summary          text,
  check (finished_at is null or finished_at >= started_at)
);

create index import_runs_source_started_idx on public.import_runs (source_id, started_at desc);

create table public.import_errors (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references public.import_runs (id) on delete cascade,
  external_id  text,
  error_code   text not null,
  safe_message text not null
);

create index import_errors_run_idx on public.import_errors (run_id);

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table public.properties (
  id                 uuid primary key default gen_random_uuid(),
  source_id          smallint not null references public.sources (id),
  external_id        text not null check (length(external_id) between 1 and 50),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status             text not null default 'active' check (status in ('active', 'inactive')),
  ref                text,
  listing_type       text not null check (listing_type in ('sale', 'rent')),
  property_type      text not null,
  region             text not null,
  city               text not null,
  location_detail    text,
  price_eur          integer not null check (price_eur >= 0),
  bedrooms           smallint check (bedrooms >= 0),
  bathrooms          smallint check (bathrooms >= 0),
  living_area_m2     integer check (living_area_m2 >= 0),
  plot_area_m2       integer check (plot_area_m2 >= 0),
  has_pool           boolean not null default false,
  is_new_build       boolean not null default false,
  energy_rating      text check (energy_rating in ('A', 'B', 'C', 'D', 'E', 'F', 'G')),
  features           text[] not null default '{}',
  latitude           double precision check (latitude between -90 and 90),
  longitude          double precision check (longitude between -180 and 180),
  geom               extensions.geography (Point, 4326),
  normalized_hash    text not null,
  source_updated_at  timestamptz not null,
  last_seen_run_id   bigint references public.import_runs (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source_id, external_id),
  check ((latitude is null) = (longitude is null)),
  check ((geom is null) = (latitude is null))
);

-- Listing queries filter active rows and sort by (updated_at desc, id desc).
create index properties_active_sort_idx on public.properties (updated_at desc, id desc) where status = 'active';
create index properties_active_region_idx on public.properties (region, price_eur) where status = 'active';
create index properties_geom_idx on public.properties using gist (geom);
create index properties_source_seen_idx on public.properties (source_id, last_seen_run_id);

create table public.property_translations (
  property_id uuid not null references public.properties (id) on delete cascade,
  locale      text not null check (locale ~ '^[a-z]{2}$'),
  description text not null,
  primary key (property_id, locale)
);

create table public.property_images (
  id                  bigint generated always as identity primary key,
  property_id         uuid not null references public.properties (id) on delete cascade,
  ordinal             smallint not null check (ordinal between 1 and 50),
  source_image_key    text not null,
  is_floorplan        boolean not null default false,
  source_hash         text,
  original_object_key text,
  thumb_object_key    text,
  medium_object_key   text,
  large_object_key    text,
  status              text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  unique (property_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- Access control. Default Supabase grants are broad; tighten them explicitly.
-- ---------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.import_runs enable row level security;
alter table public.import_errors enable row level security;
alter table public.properties enable row level security;
alter table public.property_translations enable row level security;
alter table public.property_images enable row level security;

revoke all on public.sources, public.import_runs, public.import_errors, public.properties,
  public.property_translations, public.property_images from anon, authenticated;

grant select on public.sources to anon, authenticated;
grant select on public.properties, public.property_translations, public.property_images to anon, authenticated;
-- Pipeline Demo: public-safe columns only.
grant select (id, source_id, adapter_type, status, started_at, finished_at, feed_record_count,
  inserted_count, updated_count, unchanged_count, error_count, removal_preview_count,
  deactivated_count, error_summary) on public.import_runs to anon, authenticated;
-- import_errors: no public access at all.

create policy "public reads sources" on public.sources for select to anon, authenticated using (true);

create policy "public reads active properties" on public.properties
  for select to anon, authenticated using (status = 'active');

create policy "public reads translations of active properties" on public.property_translations
  for select to anon, authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.status = 'active'));

create policy "public reads images of active properties" on public.property_images
  for select to anon, authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and p.status = 'active'));

create policy "public reads import runs" on public.import_runs for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Spatial query example: active properties within radius_km of a point.
-- security invoker => RLS of the caller applies.
-- ---------------------------------------------------------------------------
create function public.properties_near(lat double precision, lng double precision, radius_km double precision)
returns table (id uuid, slug text, city text, price_eur integer, distance_km double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.slug, p.city, p.price_eur,
         extensions.st_distance(p.geom, extensions.st_point(lng, lat, 4326)::extensions.geography) / 1000.0
  from public.properties p
  where p.status = 'active'
    and radius_km > 0 and radius_km <= 200
    and extensions.st_dwithin(p.geom, extensions.st_point(lng, lat, 4326)::extensions.geography, radius_km * 1000)
  order by 5
  limit 50
$$;

revoke all on function public.properties_near(double precision, double precision, double precision) from public;
grant execute on function public.properties_near(double precision, double precision, double precision) to anon, authenticated;
