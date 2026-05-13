-- Kiosk login-session attribution for door telemetry.

create table if not exists public.kiosk_user_sessions (
    id uuid primary key default gen_random_uuid(),
    kiosk_id text not null,
    user_id text not null references public.users(id) on delete cascade,
    logged_in_at timestamptz not null default now(),
    logged_out_at timestamptz,
    source text not null default 'frontend',
    end_source text,
    end_reason text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (logged_out_at is null or logged_out_at >= logged_in_at)
);

create unique index if not exists kiosk_user_sessions_one_active_per_kiosk_idx
    on public.kiosk_user_sessions (kiosk_id)
    where logged_out_at is null;

create index if not exists kiosk_user_sessions_kiosk_login_idx
    on public.kiosk_user_sessions (kiosk_id, logged_in_at desc);

create index if not exists kiosk_user_sessions_user_login_idx
    on public.kiosk_user_sessions (user_id, logged_in_at desc);

alter table public.kiosk_user_sessions enable row level security;

drop policy if exists "kiosk user sessions read for tracking" on public.kiosk_user_sessions;
create policy "kiosk user sessions read for tracking"
    on public.kiosk_user_sessions
    for select
    to authenticated
    using (true);

drop policy if exists "kiosk user sessions service role full access" on public.kiosk_user_sessions;
create policy "kiosk user sessions service role full access"
    on public.kiosk_user_sessions
    for all
    to service_role
    using (true)
    with check (true);

alter table public.door_open_sessions
    add column if not exists resolved_user_id text references public.users(id) on delete set null,
    add column if not exists resolved_by text,
    add column if not exists resolved_at timestamptz,
    add column if not exists resolution_confidence text,
    add column if not exists resolution_note text;

alter table public.door_open_sessions
    drop constraint if exists door_open_sessions_resolved_by_check;
alter table public.door_open_sessions
    add constraint door_open_sessions_resolved_by_check
    check (resolved_by is null or resolved_by in ('unlock_job', 'kiosk_session', 'sensor_actor', 'unresolved'));

alter table public.door_open_sessions
    drop constraint if exists door_open_sessions_resolution_confidence_check;
alter table public.door_open_sessions
    add constraint door_open_sessions_resolution_confidence_check
    check (resolution_confidence is null or resolution_confidence in ('high', 'medium', 'low', 'none'));

create index if not exists door_open_sessions_resolved_user_idx
    on public.door_open_sessions (resolved_user_id, opened_at desc)
    where resolved_user_id is not null;

create index if not exists door_open_sessions_resolved_by_idx
    on public.door_open_sessions (resolved_by, opened_at desc);

create or replace function public.start_kiosk_user_session(
    p_kiosk_id text,
    p_user_id text,
    p_source text default 'frontend',
    p_metadata jsonb default '{}'::jsonb
)
returns public.kiosk_user_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_kiosk_id text;
    v_user_id text;
    v_source text;
    v_metadata jsonb;
    v_session public.kiosk_user_sessions;
begin
    v_kiosk_id := nullif(trim(coalesce(p_kiosk_id, '')), '');
    v_user_id := nullif(trim(coalesce(p_user_id, '')), '');
    v_source := coalesce(nullif(trim(coalesce(p_source, '')), ''), 'frontend');
    v_metadata := coalesce(p_metadata, '{}'::jsonb);

    if v_kiosk_id is null then
        raise exception 'kiosk_id is required';
    end if;

    if v_user_id is null then
        raise exception 'user_id is required';
    end if;

    if not exists (
        select 1
        from public.users u
        where u.id = v_user_id
    ) then
        raise exception 'user not found: %', v_user_id;
    end if;

    perform pg_advisory_xact_lock(hashtext(v_kiosk_id));

    update public.kiosk_user_sessions
    set logged_out_at = now(),
        end_source = v_source,
        end_reason = 'replaced_by_new_login'
    where kiosk_id = v_kiosk_id
      and logged_out_at is null;

    insert into public.kiosk_user_sessions (
        kiosk_id,
        user_id,
        source,
        metadata
    )
    values (
        v_kiosk_id,
        v_user_id,
        v_source,
        v_metadata
    )
    returning * into v_session;

    return v_session;
end;
$$;

create or replace function public.end_kiosk_user_session(
    p_kiosk_id text,
    p_user_id text default null,
    p_source text default 'frontend',
    p_reason text default 'logout'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_kiosk_id text;
    v_user_id text;
    v_source text;
    v_reason text;
    v_count integer := 0;
begin
    v_kiosk_id := nullif(trim(coalesce(p_kiosk_id, '')), '');
    v_user_id := nullif(trim(coalesce(p_user_id, '')), '');
    v_source := coalesce(nullif(trim(coalesce(p_source, '')), ''), 'frontend');
    v_reason := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'logout');

    if v_kiosk_id is null then
        raise exception 'kiosk_id is required';
    end if;

    perform pg_advisory_xact_lock(hashtext(v_kiosk_id));

    update public.kiosk_user_sessions
    set logged_out_at = now(),
        end_source = v_source,
        end_reason = v_reason
    where kiosk_id = v_kiosk_id
      and logged_out_at is null
      and (v_user_id is null or user_id = v_user_id);

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

create or replace function public.resolve_door_open_session_user(
    p_session_id uuid
)
returns public.door_open_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.door_open_sessions;
    v_resolved_user_id text;
    v_resolved_by text := 'unresolved';
    v_confidence text := 'none';
    v_note text := '';
    v_unlock_requested_by text;
    v_active_count integer := 0;
begin
    select *
    into v_session
    from public.door_open_sessions dos
    where dos.id = p_session_id
    for update;

    if not found then
        raise exception 'door_open_session not found: %', p_session_id;
    end if;

    if v_session.unlock_job_id is not null then
        select nullif(trim(coalesce(dj.requested_by, '')), '')
        into v_unlock_requested_by
        from public.door_unlock_jobs dj
        where dj.id = v_session.unlock_job_id;

        if v_unlock_requested_by is not null
           and exists (select 1 from public.users u where u.id = v_unlock_requested_by) then
            v_resolved_user_id := v_unlock_requested_by;
            v_resolved_by := 'unlock_job';
            v_confidence := 'high';
        end if;
    end if;

    if v_resolved_user_id is null then
        select count(*)
        into v_active_count
        from public.kiosk_user_sessions kus
        where kus.kiosk_id = v_session.kiosk_id
          and kus.logged_in_at <= v_session.opened_at
          and (kus.logged_out_at is null or kus.logged_out_at >= v_session.opened_at);

        if v_active_count = 1 then
            select kus.user_id
            into v_resolved_user_id
            from public.kiosk_user_sessions kus
            where kus.kiosk_id = v_session.kiosk_id
              and kus.logged_in_at <= v_session.opened_at
              and (kus.logged_out_at is null or kus.logged_out_at >= v_session.opened_at)
            order by kus.logged_in_at desc
            limit 1;

            if v_resolved_user_id is not null
               and exists (select 1 from public.users u where u.id = v_resolved_user_id) then
                v_resolved_by := 'kiosk_session';
                v_confidence := 'medium';
            else
                v_resolved_user_id := null;
            end if;
        elsif v_active_count > 1 then
            v_note := 'ambiguous_active_kiosk_sessions';
        end if;
    end if;

    if v_resolved_user_id is null then
        if nullif(trim(coalesce(v_session.actor_user_id, '')), '') is not null
           and exists (select 1 from public.users u where u.id = v_session.actor_user_id) then
            v_resolved_user_id := v_session.actor_user_id;
            v_resolved_by := 'sensor_actor';
            v_confidence := 'low';
        elsif v_note = '' then
            v_note := 'no_matching_unlock_or_kiosk_session';
        end if;
    end if;

    update public.door_open_sessions
    set resolved_user_id = v_resolved_user_id,
        resolved_by = v_resolved_by,
        resolved_at = now(),
        resolution_confidence = v_confidence,
        resolution_note = nullif(v_note, '')
    where id = v_session.id
    returning * into v_session;

    return v_session;
end;
$$;

create or replace function public.resolve_door_open_sessions_backfill(
    p_limit integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
    v_limit integer := greatest(1, coalesce(p_limit, 5000));
    v_count integer := 0;
begin
    for v_row in
        select dos.id
        from public.door_open_sessions dos
        where dos.resolved_user_id is null
        order by dos.opened_at desc
        limit v_limit
    loop
        perform public.resolve_door_open_session_user(v_row.id);
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

create or replace function public.trg_resolve_door_open_session_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.resolve_door_open_session_user(new.id);
    return new;
end;
$$;

drop trigger if exists resolve_door_open_session_user_trg on public.door_open_sessions;
create trigger resolve_door_open_session_user_trg
after insert or update of kiosk_id, opened_at, unlock_job_id, actor_user_id
on public.door_open_sessions
for each row
execute function public.trg_resolve_door_open_session_user();

create or replace view public.door_open_sessions_audit_v as
select
    dos.id,
    dos.kiosk_id,
    dos.sensor_id,
    dos.opened_at,
    dos.closed_at,
    dos.duration_ms,
    dos.unlock_job_id,
    dos.actor_user_id,
    dos.resolved_user_id,
    dos.resolved_by,
    dos.resolution_confidence,
    dos.resolution_note,
    dos.resolved_at,
    dos.metadata,
    dos.created_at,
    dj.requested_by as unlock_requested_by,
    ru.name as resolved_user_name,
    ru.role as resolved_user_role,
    au.name as actor_user_name,
    au.role as actor_user_role
from public.door_open_sessions dos
left join public.door_unlock_jobs dj
    on dj.id = dos.unlock_job_id
left join public.users ru
    on ru.id = dos.resolved_user_id
left join public.users au
    on au.id = dos.actor_user_id;

grant select on public.door_open_sessions_audit_v to authenticated;
grant select on public.door_open_sessions_audit_v to service_role;

revoke all on function public.start_kiosk_user_session(text, text, text, jsonb) from public;
revoke all on function public.end_kiosk_user_session(text, text, text, text) from public;
revoke all on function public.resolve_door_open_session_user(uuid) from public;
revoke all on function public.resolve_door_open_sessions_backfill(integer) from public;
revoke all on function public.trg_resolve_door_open_session_user() from public;

grant execute on function public.start_kiosk_user_session(text, text, text, jsonb) to authenticated;
grant execute on function public.start_kiosk_user_session(text, text, text, jsonb) to service_role;
grant execute on function public.end_kiosk_user_session(text, text, text, text) to authenticated;
grant execute on function public.end_kiosk_user_session(text, text, text, text) to service_role;
grant execute on function public.resolve_door_open_session_user(uuid) to service_role;
grant execute on function public.resolve_door_open_sessions_backfill(integer) to service_role;
