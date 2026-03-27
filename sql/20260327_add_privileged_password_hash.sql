-- Per-user privileged action password storage for teacher/developer accounts.
-- Stores a hash (never plaintext) and enforces uniqueness between teacher/developer users.

alter table public.users
    add column if not exists privileged_password_hash text;

create unique index if not exists users_staff_privileged_password_hash_unique
    on public.users (privileged_password_hash)
    where role in ('teacher', 'developer')
      and privileged_password_hash is not null;
