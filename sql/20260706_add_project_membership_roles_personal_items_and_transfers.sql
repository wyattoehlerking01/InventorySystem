-- Migration: add project membership roles, personal-items visibility, and transfer history

alter table if exists public.users
    add column if not exists personal_items_enabled boolean not null default false;

update public.users
set personal_items_enabled = true
where status = 'Active'
  and coalesce(personal_items_enabled, false) = false;

alter table if exists public.project_collaborators
    add column if not exists member_role text not null default 'collaborator';

update public.project_collaborators
set member_role = 'collaborator'
where member_role is null
   or trim(member_role) = '';

do $$
begin
    if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'project_collaborators'
    ) and not exists (
        select 1
        from pg_constraint
        where conname = 'project_collaborators_member_role_check'
    ) then
        alter table public.project_collaborators
            add constraint project_collaborators_member_role_check
            check (member_role in ('collaborator', 'mentor', 'captain'));
    end if;
end;
$$;

create table if not exists public.project_item_transfers (
    id uuid primary key default gen_random_uuid(),
    project_item_out_id text,
    from_project_id text not null,
    to_project_id text not null,
    item_id text not null,
    quantity integer not null default 1 check (quantity > 0),
    signout_date timestamptz,
    due_date timestamptz,
    assigned_to_user_id text,
    signed_out_by_user_id text,
    transferred_by_user_id text,
    created_at timestamptz not null default now()
);

create index if not exists project_item_transfers_from_project_idx
    on public.project_item_transfers (from_project_id, created_at desc);

create index if not exists project_item_transfers_to_project_idx
    on public.project_item_transfers (to_project_id, created_at desc);

create index if not exists project_item_transfers_item_idx
    on public.project_item_transfers (item_id, created_at desc);

alter table public.project_item_transfers enable row level security;

drop policy if exists "project item transfers read for authenticated" on public.project_item_transfers;
create policy "project item transfers read for authenticated"
    on public.project_item_transfers
    for select
    to authenticated
    using (true);

drop policy if exists "project item transfers insert for authenticated" on public.project_item_transfers;
create policy "project item transfers insert for authenticated"
    on public.project_item_transfers
    for insert
    to authenticated
    with check (true);

drop policy if exists "project item transfers service role full access" on public.project_item_transfers;
create policy "project item transfers service role full access"
    on public.project_item_transfers
    for all
    to service_role
    using (true)
    with check (true);
