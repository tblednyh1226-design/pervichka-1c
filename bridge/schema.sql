-- MAIN Plan Bridge. All access is through the authenticated Edge Function.
create table if not exists public.plan_bridge_pairings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code_hash text unique not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.plan_bridge_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'MAIN',
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled_at timestamptz
);
create index if not exists plan_bridge_devices_workspace_idx on public.plan_bridge_devices(workspace_id, created_at desc);
create table if not exists public.plan_bridge_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid not null references public.plan_bridge_devices(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists plan_bridge_jobs_device_status_idx on public.plan_bridge_jobs(device_id,status,created_at);
create index if not exists plan_bridge_jobs_workspace_created_idx on public.plan_bridge_jobs(workspace_id,created_at desc);
alter table public.plan_bridge_pairings enable row level security;
alter table public.plan_bridge_devices enable row level security;
alter table public.plan_bridge_jobs enable row level security;
revoke all on public.plan_bridge_pairings,public.plan_bridge_devices,public.plan_bridge_jobs from anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('plan-bridge','plan-bridge',false,15728640,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;