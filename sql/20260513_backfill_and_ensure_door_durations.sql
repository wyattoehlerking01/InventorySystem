-- Backfill and ensure door session durations are calculated for all records
-- This migration ensures every door_open_sessions record has correct duration_ms

-- 1. BACKFILL: Update any existing sessions where duration_ms is 0 or null
update public.door_open_sessions
set duration_ms = greatest(
    0,
    extract(epoch from (closed_at - opened_at))::integer * 1000
)
where duration_ms is null
   or duration_ms = 0;

-- 2. CREATE HELPER FUNCTION: Recalculate all durations on demand
create or replace function public.recalculate_door_durations(p_kiosk_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated integer := 0;
begin
    update public.door_open_sessions
    set duration_ms = greatest(
        0,
        extract(epoch from (closed_at - opened_at))::integer * 1000
    )
    where (p_kiosk_id is null or kiosk_id = p_kiosk_id)
      and (duration_ms is null or duration_ms = 0 or duration_ms < 0);
    
    get diagnostics v_updated = row_count;
    
    return jsonb_build_object(
        'updated_count', v_updated,
        'timestamp', now()
    );
end;
$$;

grant execute on function public.recalculate_door_durations(text) to service_role;
grant execute on function public.recalculate_door_durations(text) to authenticated;

-- 3. CREATE TRIGGER: Ensure duration is calculated on insert or update
-- (in case the event payload doesn't include session data)
create or replace function public.ensure_door_duration_on_change()
returns trigger
language plpgsql
as $$
begin
    -- If duration_ms is null or 0, calculate it from timestamps
    if new.duration_ms is null or new.duration_ms <= 0 then
        new.duration_ms := greatest(
            0,
            extract(epoch from (new.closed_at - new.opened_at))::integer * 1000
        );
    end if;
    
    return new;
end;
$$;

drop trigger if exists ensure_door_duration_on_change
    on public.door_open_sessions;

create trigger ensure_door_duration_on_change
    before insert or update on public.door_open_sessions
    for each row
    execute function public.ensure_door_duration_on_change();

comment on function public.recalculate_door_durations(text) is
    'Recalculate duration_ms for door_open_sessions from timestamps. '
    'Pass p_kiosk_id to limit to specific kiosk, or null for all.';

comment on trigger ensure_door_duration_on_change on public.door_open_sessions is
    'Automatically calculates duration_ms from opened_at/closed_at timestamps '
    'if not provided in the insert/update payload.';
