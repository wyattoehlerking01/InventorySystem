-- Door sensor telemetry (A/A path): batched RPC ingestion + restricted execution surface.

create table if not exists public.door_sensor_events (
    id uuid primary key default gen_random_uuid(),
    kiosk_id text not null,
    sensor_id text not null default 'door-1',
    local_seq bigint not null,
    event_type text not null check (event_type in ('open', 'close', 'heartbeat', 'fault')),
    event_ts timestamptz not null,
    source text not null default 'pi-agent',
    unlock_job_id uuid references public.door_unlock_jobs(id) on delete set null,
    actor_user_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (kiosk_id, sensor_id, local_seq)
);

create index if not exists door_sensor_events_kiosk_sensor_ts_idx
    on public.door_sensor_events (kiosk_id, sensor_id, event_ts desc);

create index if not exists door_sensor_events_kiosk_created_idx
    on public.door_sensor_events (kiosk_id, created_at desc);

create index if not exists door_sensor_events_unlock_job_idx
    on public.door_sensor_events (unlock_job_id)
    where unlock_job_id is not null;

create table if not exists public.door_open_sessions (
    id uuid primary key default gen_random_uuid(),
    kiosk_id text not null,
    sensor_id text not null default 'door-1',
    open_local_seq bigint,
    close_local_seq bigint not null,
    opened_at timestamptz not null,
    closed_at timestamptz not null,
    duration_ms integer not null check (duration_ms >= 0),
    unlock_job_id uuid references public.door_unlock_jobs(id) on delete set null,
    actor_user_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (kiosk_id, sensor_id, close_local_seq)
);

create index if not exists door_open_sessions_kiosk_sensor_closed_idx
    on public.door_open_sessions (kiosk_id, sensor_id, closed_at desc);

create index if not exists door_open_sessions_kiosk_created_idx
    on public.door_open_sessions (kiosk_id, created_at desc);

alter table public.door_sensor_events enable row level security;
alter table public.door_open_sessions enable row level security;

drop policy if exists "door sensor events read for tracking" on public.door_sensor_events;
create policy "door sensor events read for tracking"
    on public.door_sensor_events
    for select
    to authenticated
    using (true);

drop policy if exists "door sensor events service role full access" on public.door_sensor_events;
create policy "door sensor events service role full access"
    on public.door_sensor_events
    for all
    to service_role
    using (true)
    with check (true);

drop policy if exists "door open sessions read for tracking" on public.door_open_sessions;
create policy "door open sessions read for tracking"
    on public.door_open_sessions
    for select
    to authenticated
    using (true);

drop policy if exists "door open sessions service role full access" on public.door_open_sessions;
create policy "door open sessions service role full access"
    on public.door_open_sessions
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
          and tablename = 'door_sensor_events'
    ) then
        alter publication supabase_realtime add table public.door_sensor_events;
    end if;

    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'door_open_sessions'
    ) then
        alter publication supabase_realtime add table public.door_open_sessions;
    end if;
end;
$$;

create or replace function public.log_door_events_batch(
    p_kiosk_id text,
    p_sensor_id text default 'door-1',
    p_events jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_received integer := 0;
    v_events_inserted integer := 0;
    v_sessions_inserted integer := 0;
begin
    if p_kiosk_id is null or length(trim(p_kiosk_id)) = 0 then
        raise exception 'kiosk_id is required';
    end if;

    if p_events is null or jsonb_typeof(p_events) <> 'array' then
        raise exception 'events payload must be a JSON array';
    end if;

    with parsed as (
        select
            trim(p_kiosk_id) as kiosk_id,
            coalesce(nullif(trim(p_sensor_id), ''), 'door-1') as sensor_id,
            (evt->>'local_seq')::bigint as local_seq,
            lower(trim(evt->>'event_type')) as event_type,
            (evt->>'event_ts')::timestamptz as event_ts,
            nullif(trim(evt->>'source'), '') as source,
            nullif(trim(evt->>'unlock_job_id'), '')::uuid as unlock_job_id,
            nullif(trim(evt->>'actor_user_id'), '') as actor_user_id,
            coalesce(evt->'metadata', '{}'::jsonb) as metadata,
            evt->'session' as session
        from jsonb_array_elements(p_events) as evt
    ),
    valid as (
        select *
        from parsed
        where local_seq is not null
          and event_type in ('open', 'close', 'heartbeat', 'fault')
          and event_ts is not null
    ),
    ins_events as (
        insert into public.door_sensor_events (
            kiosk_id,
            sensor_id,
            local_seq,
            event_type,
            event_ts,
            source,
            unlock_job_id,
            actor_user_id,
            metadata
        )
        select
            kiosk_id,
            sensor_id,
            local_seq,
            event_type,
            event_ts,
            coalesce(source, 'pi-agent'),
            unlock_job_id,
            actor_user_id,
            metadata
        from valid
        on conflict (kiosk_id, sensor_id, local_seq) do nothing
        returning 1
    ),
    ins_sessions as (
        insert into public.door_open_sessions (
            kiosk_id,
            sensor_id,
            open_local_seq,
            close_local_seq,
            opened_at,
            closed_at,
            duration_ms,
            unlock_job_id,
            actor_user_id,
            metadata
        )
        select
            v.kiosk_id,
            v.sensor_id,
            coalesce(nullif(v.session->>'open_local_seq', '')::bigint, null),
            coalesce(nullif(v.session->>'close_local_seq', '')::bigint, v.local_seq),
            (v.session->>'opened_at')::timestamptz,
            (v.session->>'closed_at')::timestamptz,
            greatest(coalesce((v.session->>'duration_ms')::integer, 0), 0),
            coalesce(nullif(v.session->>'unlock_job_id', '')::uuid, v.unlock_job_id),
            coalesce(nullif(v.session->>'actor_user_id', ''), v.actor_user_id),
            coalesce(v.session->'metadata', '{}'::jsonb)
        from valid v
        where v.event_type = 'close'
          and v.session is not null
          and jsonb_typeof(v.session) = 'object'
          and nullif(v.session->>'opened_at', '') is not null
          and nullif(v.session->>'closed_at', '') is not null
        on conflict (kiosk_id, sensor_id, close_local_seq) do nothing
        returning 1
    )
    select
        (select count(*) from parsed),
        (select count(*) from ins_events),
        (select count(*) from ins_sessions)
    into
        v_received,
        v_events_inserted,
        v_sessions_inserted;

    return jsonb_build_object(
        'kiosk_id', trim(p_kiosk_id),
        'sensor_id', coalesce(nullif(trim(p_sensor_id), ''), 'door-1'),
        'received', v_received,
        'events_inserted', v_events_inserted,
        'sessions_inserted', v_sessions_inserted
    );
end;
$$;

revoke all on function public.log_door_events_batch(text, text, jsonb) from public;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'door_telemetry_writer') then
        create role door_telemetry_writer nologin;
    end if;
end;
$$;

grant execute on function public.log_door_events_batch(text, text, jsonb) to door_telemetry_writer;
grant execute on function public.log_door_events_batch(text, text, jsonb) to service_role;
