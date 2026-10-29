-- Private capability-based pairing for MAIN, no username/password.
create table if not exists public.plan_guest_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'MAIN',
  main_token_hash text unique not null,
  browser_token_hash text unique not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled_at timestamptz
);
create table if not exists public.plan_guest_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.plan_guest_devices(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists plan_guest_jobs_pending on public.plan_guest_jobs(device_id,status,created_at);
alter table public.plan_guest_devices enable row level security;
alter table public.plan_guest_jobs enable row level security;
revoke all on public.plan_guest_devices,public.plan_guest_jobs from anon,authenticated;
