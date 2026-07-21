-- Canfranc Rutas · Esquema inicial de usuarios, actividades y comunidad
-- Ejecutar una sola vez en el SQL Editor de un proyecto Supabase nuevo.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'Senderista' check (char_length(display_name) between 2 and 60),
  avatar_url text,
  bio text check (bio is null or char_length(bio) <= 300),
  location text check (location is null or char_length(location) <= 80),
  total_distance_m double precision not null default 0 check (total_distance_m >= 0),
  total_ascent_m double precision not null default 0 check (total_ascent_m >= 0),
  completed_routes integer not null default 0 check (completed_routes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id text not null check (char_length(route_id) between 2 and 100),
  title text not null check (char_length(title) between 2 and 120),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  moving_seconds integer not null default 0 check (moving_seconds >= 0),
  distance_m double precision not null default 0 check (distance_m >= 0),
  ascent_m double precision not null default 0 check (ascent_m >= 0),
  descent_m double precision not null default 0 check (descent_m >= 0),
  avg_pace_seconds_km integer check (avg_pace_seconds_km is null or avg_pace_seconds_km >= 0),
  min_elevation_m double precision,
  max_elevation_m double precision,
  completion_percentage numeric(5,2) not null default 0 check (completion_percentage between 0 and 100),
  completed boolean not null default false,
  source text not null default 'gps' check (source in ('gps', 'manual', 'imported')),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  notes text check (notes is null or char_length(notes) <= 2000),
  start_location jsonb,
  end_location jsonb,
  track_geojson jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists activities_user_started_idx on public.activities(user_id, started_at desc);
create index if not exists activities_route_idx on public.activities(route_id, completed, elapsed_seconds);
create index if not exists activities_public_idx on public.activities(created_at desc) where visibility = 'public';

create table if not exists public.route_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  route_id text not null,
  first_completed_at timestamptz not null,
  last_completed_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  best_elapsed_seconds integer not null check (best_elapsed_seconds >= 0),
  best_activity_id uuid references public.activities(id) on delete set null,
  primary key (user_id, route_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists posts_created_idx on public.posts(created_at desc);

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_post_idx on public.comments(post_id, created_at);

create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  reason text not null check (reason in ('spam', 'dangerous', 'abuse', 'privacy', 'other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  check ((post_id is not null)::int + (comment_id is not null)::int = 1)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at before update on public.activities
for each row execute function public.set_updated_at();

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at before update on public.comments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Senderista'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.refresh_user_route_stats()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.completed then
    insert into public.route_completions (
      user_id, route_id, first_completed_at, last_completed_at,
      attempts, best_elapsed_seconds, best_activity_id
    ) values (
      new.user_id, new.route_id, new.ended_at, new.ended_at,
      1, new.elapsed_seconds, new.id
    )
    on conflict (user_id, route_id) do update set
      last_completed_at = greatest(public.route_completions.last_completed_at, excluded.last_completed_at),
      attempts = public.route_completions.attempts + 1,
      best_elapsed_seconds = least(public.route_completions.best_elapsed_seconds, excluded.best_elapsed_seconds),
      best_activity_id = case
        when excluded.best_elapsed_seconds < public.route_completions.best_elapsed_seconds
        then excluded.best_activity_id else public.route_completions.best_activity_id end;
  end if;

  update public.profiles p set
    total_distance_m = coalesce((select sum(a.distance_m) from public.activities a where a.user_id = new.user_id), 0),
    total_ascent_m = coalesce((select sum(a.ascent_m) from public.activities a where a.user_id = new.user_id), 0),
    completed_routes = (select count(*) from public.route_completions rc where rc.user_id = new.user_id)
  where p.id = new.user_id;
  return new;
end;
$$;

drop trigger if exists activities_refresh_stats on public.activities;
create trigger activities_refresh_stats
after insert on public.activities
for each row execute function public.refresh_user_route_stats();

-- Seguridad por fila
alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.route_completions enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;

create policy "Perfiles visibles" on public.profiles for select using (true);
create policy "Editar perfil propio" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Leer actividad propia o pública" on public.activities for select
using ((select auth.uid()) = user_id or visibility = 'public');
create policy "Crear actividad propia" on public.activities for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Editar actividad propia" on public.activities for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Eliminar actividad propia" on public.activities for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Ver logros propios o públicos" on public.route_completions for select
using ((select auth.uid()) = user_id or exists (
  select 1 from public.activities a
  where a.user_id = route_completions.user_id and a.route_id = route_completions.route_id and a.visibility = 'public'
));

create policy "Publicaciones visibles" on public.posts for select using (true);
create policy "Crear publicación propia" on public.posts for insert to authenticated
with check (
  (select auth.uid()) = user_id and
  (activity_id is null or exists (
    select 1 from public.activities a where a.id = activity_id and a.user_id = (select auth.uid())
  ))
);
create policy "Editar publicación propia" on public.posts for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id and
  (activity_id is null or exists (
    select 1 from public.activities a where a.id = activity_id and a.user_id = (select auth.uid())
  ))
);
create policy "Eliminar publicación propia" on public.posts for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Medios visibles" on public.post_media for select using (true);
create policy "Crear medio propio" on public.post_media for insert to authenticated
with check (
  (select auth.uid()) = user_id and
  exists (select 1 from public.posts p where p.id = post_id and p.user_id = (select auth.uid()))
);
create policy "Eliminar medio propio" on public.post_media for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Comentarios visibles" on public.comments for select using (true);
create policy "Crear comentario propio" on public.comments for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Editar comentario propio" on public.comments for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Eliminar comentario propio" on public.comments for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Likes visibles" on public.likes for select using (true);
create policy "Crear like propio" on public.likes for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "Eliminar like propio" on public.likes for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "Seguimientos visibles" on public.follows for select using (true);
create policy "Seguir desde cuenta propia" on public.follows for insert to authenticated
with check ((select auth.uid()) = follower_id);
create policy "Dejar de seguir desde cuenta propia" on public.follows for delete to authenticated
using ((select auth.uid()) = follower_id);

create policy "Crear denuncia propia" on public.reports for insert to authenticated
with check ((select auth.uid()) = reporter_id);
create policy "Consultar denuncias propias" on public.reports for select to authenticated
using ((select auth.uid()) = reporter_id);

-- Almacenamiento de imágenes públicas de la comunidad.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Subir imágenes a carpeta propia" on storage.objects for insert to authenticated
with check (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Modificar imágenes propias" on storage.objects for update to authenticated
using (bucket_id = 'community-media' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'community-media' and owner_id = (select auth.uid())::text);
create policy "Eliminar imágenes propias" on storage.objects for delete to authenticated
using (bucket_id = 'community-media' and owner_id = (select auth.uid())::text);
