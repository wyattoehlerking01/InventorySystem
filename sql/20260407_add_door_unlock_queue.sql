-- Door unlock queue for private Pi realtime processing.

create table if not exists public.door_unlock_jobs (
    id uuid primary key default gen_random_uuid(),
    kiosk_id text not null,
    action_type text not null,
    item_id text,
    quantity integer not null default 1,
    project_name text,
    request_payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'expired')),
    status_message text,
    requested_by text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    expires_at timestamptz not null default (now() + interval '30 seconds'),
    result_payload jsonb not null default '{}'::jsonb
);

create index if not exists door_unlock_jobs_kiosk_status_created_idx
    on public.door_unlock_jobs (kiosk_id, status, created_at);

create index if not exists door_unlock_jobs_status_expires_idx
    on public.door_unlock_jobs (status, expires_at);

alter table public.door_unlock_jobs enable row level security;

drop policy if exists "door jobs insert own requests" on public.door_unlock_jobs;
create policy "door jobs insert own requests"
    on public.door_unlock_jobs
    for insert
    to authenticated
    with check (requested_by = auth.uid()::text or requested_by is null);

drop policy if exists "door jobs read for tracking" on public.door_unlock_jobs;
create policy "door jobs read for tracking"
    on public.door_unlock_jobs
    for select
    to authenticated
    using (true);

drop policy if exists "door jobs service role full access" on public.door_unlock_jobs;
create policy "door jobs service role full access"
    on public.door_unlock_jobs
    for all
    to service_role
    using (true)
    with check (true);

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'door_unlock_jobs'
    ) then
        alter publication supabase_realtime add table public.door_unlock_jobs;
    end if;
end;
$$;

create or replace function public.request_door_unlock(
    p_kiosk_id text,
    p_action_type text,
    p_item_id text default null,
    p_quantity integer default 1,
    p_project_name text default null,
    p_request_payload jsonb default '{}'::jsonb
)
returns public.door_unlock_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
    v_job public.door_unlock_jobs;
begin
    if p_kiosk_id is null or length(trim(p_kiosk_id)) = 0 then
        raise exception 'kiosk_id is required';
    end if;

    if p_action_type not in ('sign-out', 'sign-in', 'manual', 'hold-open', 'release') then
        raise exception 'invalid action_type: %', p_action_type;
    end if;

    insert into public.door_unlock_jobs (
        kiosk_id,
        action_type,
        item_id,
        quantity,
        project_name,
        request_payload,
        requested_by
    )
    values (
        trim(p_kiosk_id),
        p_action_type,
        nullif(trim(coalesce(p_item_id, '')), ''),
        greatest(coalesce(p_quantity, 1), 1),
        nullif(trim(coalesce(p_project_name, '')), ''),
        coalesce(p_request_payload, '{}'::jsonb),
        nullif(auth.uid()::text, '')
    )
    returning * into v_job;

    return v_job;
end;
$$;

grant execute on function public.request_door_unlock(text, text, text, integer, text, jsonb) to authenticated;
grant execute on function public.request_door_unlock(text, text, text, integer, text, jsonb) to service_role;