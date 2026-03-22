-- Kiosk license + remote lockout support
-- Safe additive migration for existing kiosk_settings rows.

alter table if exists public.kiosk_settings
    add column if not exists license_hash text,
    add column if not exists is_locked boolean not null default false,
    add column if not exists lock_screen text not null default 'systemLocked';

-- Optional compatibility columns for older deployments.
alter table if exists public.kiosk_settings
    add column if not exists kiosk_locked boolean,
    add column if not exists kiosk_lock_screen text;

-- Keep compatibility columns in sync where present.
update public.kiosk_settings
set kiosk_locked = is_locked
where kiosk_locked is distinct from is_locked;

update public.kiosk_settings
set kiosk_lock_screen = lock_screen
where kiosk_lock_screen is distinct from lock_screen;
