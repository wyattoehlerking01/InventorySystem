-- Organization-based licensing with Supabase Auth.
-- Minimal secure baseline for multi-tenant org scoping.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Core auth + license tables
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    license_status text not null default 'active' check (license_status in ('active', 'expired', 'suspended')),
    license_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete restrict,
    is_active boolean not null default true,
    barcode text unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_org on public.profiles(organization_id);
create index if not exists idx_profiles_barcode on public.profiles(barcode);

-- -----------------------------------------------------------------------------
-- Add organization_id to app tables
-- -----------------------------------------------------------------------------

alter table if exists public.users add column if not exists organization_id uuid;
alter table if exists public.inventory_items add column if not exists organization_id uuid;
alter table if exists public.projects add column if not exists organization_id uuid;
alter table if exists public.categories add column if not exists organization_id uuid;
alter table if exists public.visibility_tags add column if not exists organization_id uuid;
alter table if exists public.activity_logs add column if not exists organization_id uuid;
alter table if exists public.help_requests add column if not exists organization_id uuid;
alter table if exists public.extension_requests add column if not exists organization_id uuid;
alter table if exists public.order_requests add column if not exists organization_id uuid;
alter table if exists public.project_collaborators add column if not exists organization_id uuid;
alter table if exists public.project_items_out add column if not exists organization_id uuid;
alter table if exists public.inventory_item_visibility add column if not exists organization_id uuid;
alter table if exists public.student_classes add column if not exists organization_id uuid;
alter table if exists public.class_students add column if not exists organization_id uuid;
alter table if exists public.class_visible_items add column if not exists organization_id uuid;
alter table if exists public.class_visibility_tags add column if not exists organization_id uuid;
alter table if exists public.class_due_policy add column if not exists organization_id uuid;
alter table if exists public.class_due_policy_periods add column if not exists organization_id uuid;
alter table if exists public.class_permissions add column if not exists organization_id uuid;
alter table if exists public.kiosk_settings add column if not exists organization_id uuid;

create index if not exists idx_users_org on public.users(organization_id);
create index if not exists idx_inventory_items_org on public.inventory_items(organization_id);
create index if not exists idx_projects_org on public.projects(organization_id);
create index if not exists idx_categories_org on public.categories(organization_id);
create index if not exists idx_visibility_tags_org on public.visibility_tags(organization_id);
create index if not exists idx_activity_logs_org on public.activity_logs(organization_id);
create index if not exists idx_help_requests_org on public.help_requests(organization_id);
create index if not exists idx_extension_requests_org on public.extension_requests(organization_id);
create index if not exists idx_order_requests_org on public.order_requests(organization_id);
create index if not exists idx_project_collaborators_org on public.project_collaborators(organization_id);
create index if not exists idx_project_items_out_org on public.project_items_out(organization_id);
create index if not exists idx_inventory_item_visibility_org on public.inventory_item_visibility(organization_id);
create index if not exists idx_student_classes_org on public.student_classes(organization_id);
create index if not exists idx_class_students_org on public.class_students(organization_id);
create index if not exists idx_class_visible_items_org on public.class_visible_items(organization_id);
create index if not exists idx_class_visibility_tags_org on public.class_visibility_tags(organization_id);
create index if not exists idx_class_due_policy_org on public.class_due_policy(organization_id);
create index if not exists idx_class_due_policy_periods_org on public.class_due_policy_periods(organization_id);
create index if not exists idx_class_permissions_org on public.class_permissions(organization_id);
create index if not exists idx_kiosk_settings_org on public.kiosk_settings(organization_id);

-- -----------------------------------------------------------------------------
-- Bootstrap existing rows to a default organization if missing
-- -----------------------------------------------------------------------------

do $$
declare
    v_org_id uuid;
begin
    select id into v_org_id
    from public.organizations
    order by created_at asc
    limit 1;

    if v_org_id is null then
        insert into public.organizations (name, license_status)
        values ('Default Organization', 'active')
        returning id into v_org_id;
    end if;

    update public.users set organization_id = v_org_id where organization_id is null;
    update public.inventory_items set organization_id = v_org_id where organization_id is null;
    update public.projects set organization_id = v_org_id where organization_id is null;
    update public.categories set organization_id = v_org_id where organization_id is null;
    update public.visibility_tags set organization_id = v_org_id where organization_id is null;
    update public.activity_logs set organization_id = v_org_id where organization_id is null;
    update public.help_requests set organization_id = v_org_id where organization_id is null;
    update public.extension_requests set organization_id = v_org_id where organization_id is null;
    update public.order_requests set organization_id = v_org_id where organization_id is null;
    update public.project_collaborators set organization_id = v_org_id where organization_id is null;
    update public.project_items_out set organization_id = v_org_id where organization_id is null;
    update public.inventory_item_visibility set organization_id = v_org_id where organization_id is null;
    update public.student_classes set organization_id = v_org_id where organization_id is null;
    update public.class_students set organization_id = v_org_id where organization_id is null;
    update public.class_visible_items set organization_id = v_org_id where organization_id is null;
    update public.class_visibility_tags set organization_id = v_org_id where organization_id is null;
    update public.class_due_policy set organization_id = v_org_id where organization_id is null;
    update public.class_due_policy_periods set organization_id = v_org_id where organization_id is null;
    update public.class_permissions set organization_id = v_org_id where organization_id is null;
    update public.kiosk_settings set organization_id = v_org_id where organization_id is null;

    insert into public.profiles (id, organization_id, is_active)
    select au.id, v_org_id, true
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null;
end $$;

-- -----------------------------------------------------------------------------
-- Auth/license helper functions
-- -----------------------------------------------------------------------------

create or replace function public.current_profile_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.organization_id
    from public.profiles p
    where p.id = auth.uid()
    limit 1;
$$;

create or replace function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(p.is_active, false)
    from public.profiles p
    where p.id = auth.uid()
    limit 1;
$$;

create or replace function public.current_org_license_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        o.license_status = 'active'
        and (o.license_expires_at is null or o.license_expires_at > now()),
        false
    )
    from public.organizations o
    where o.id = public.current_profile_organization_id()
    limit 1;
$$;

create or replace function public.is_active_licensed_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select public.current_profile_is_active() and public.current_org_license_is_active();
$$;

create or replace function public.set_organization_id_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.organization_id is null then
        new.organization_id := public.current_profile_organization_id();
    end if;
    return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Attach org autofill triggers
-- -----------------------------------------------------------------------------

do $$
declare
    t text;
    tables text[] := array[
        'users','inventory_items','projects','categories','visibility_tags',
        'activity_logs','help_requests','extension_requests','order_requests',
        'project_collaborators','project_items_out','inventory_item_visibility',
        'student_classes','class_students','class_visible_items','class_visibility_tags',
        'class_due_policy','class_due_policy_periods','class_permissions','kiosk_settings'
    ];
begin
    foreach t in array tables loop
        execute format('drop trigger if exists trg_%I_set_org on public.%I', t, t);
        execute format('create trigger trg_%I_set_org before insert on public.%I for each row execute function public.set_organization_id_from_profile()', t, t);
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RLS reset: remove all existing policies on targeted tables
-- -----------------------------------------------------------------------------

do $$
declare
    p record;
    target_tables text[] := array[
        'organizations','profiles',
        'users','inventory_items','projects','categories','visibility_tags',
        'activity_logs','help_requests','extension_requests','order_requests',
        'project_collaborators','project_items_out','inventory_item_visibility',
        'student_classes','class_students','class_visible_items','class_visibility_tags',
        'class_due_policy','class_due_policy_periods','class_permissions','kiosk_settings'
    ];
begin
    for p in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = any(target_tables)
    loop
        execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.users enable row level security;
alter table public.inventory_items enable row level security;
alter table public.projects enable row level security;
alter table public.categories enable row level security;
alter table public.visibility_tags enable row level security;
alter table public.activity_logs enable row level security;
alter table public.help_requests enable row level security;
alter table public.extension_requests enable row level security;
alter table public.order_requests enable row level security;
alter table public.project_collaborators enable row level security;
alter table public.project_items_out enable row level security;
alter table public.inventory_item_visibility enable row level security;
alter table public.student_classes enable row level security;
alter table public.class_students enable row level security;
alter table public.class_visible_items enable row level security;
alter table public.class_visibility_tags enable row level security;
alter table public.class_due_policy enable row level security;
alter table public.class_due_policy_periods enable row level security;
alter table public.class_permissions enable row level security;
alter table public.kiosk_settings enable row level security;

-- -----------------------------------------------------------------------------
-- Profile + organization read policies (for login/license resolution)
-- -----------------------------------------------------------------------------

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organizations_select_current_org
on public.organizations
for select
to authenticated
using (id = public.current_profile_organization_id());

-- -----------------------------------------------------------------------------
-- App table policies: active profile + active org license + same organization
-- -----------------------------------------------------------------------------

create policy users_select_org on public.users for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy users_insert_org on public.users for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy users_update_org on public.users for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy users_delete_org on public.users for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy inventory_items_select_org on public.inventory_items for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_items_insert_org on public.inventory_items for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_items_update_org on public.inventory_items for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_items_delete_org on public.inventory_items for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy projects_select_org on public.projects for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy projects_insert_org on public.projects for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy projects_update_org on public.projects for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy projects_delete_org on public.projects for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy categories_select_org on public.categories for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy categories_insert_org on public.categories for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy categories_update_org on public.categories for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy categories_delete_org on public.categories for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy visibility_tags_select_org on public.visibility_tags for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy visibility_tags_insert_org on public.visibility_tags for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy visibility_tags_update_org on public.visibility_tags for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy visibility_tags_delete_org on public.visibility_tags for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy activity_logs_select_org on public.activity_logs for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy activity_logs_insert_org on public.activity_logs for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy activity_logs_update_org on public.activity_logs for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy activity_logs_delete_org on public.activity_logs for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy help_requests_select_org on public.help_requests for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy help_requests_insert_org on public.help_requests for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy help_requests_update_org on public.help_requests for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy help_requests_delete_org on public.help_requests for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy extension_requests_select_org on public.extension_requests for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy extension_requests_insert_org on public.extension_requests for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy extension_requests_update_org on public.extension_requests for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy extension_requests_delete_org on public.extension_requests for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy order_requests_select_org on public.order_requests for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy order_requests_insert_org on public.order_requests for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy order_requests_update_org on public.order_requests for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy order_requests_delete_org on public.order_requests for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy project_collaborators_select_org on public.project_collaborators for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_collaborators_insert_org on public.project_collaborators for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_collaborators_update_org on public.project_collaborators for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_collaborators_delete_org on public.project_collaborators for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy project_items_out_select_org on public.project_items_out for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_items_out_insert_org on public.project_items_out for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_items_out_update_org on public.project_items_out for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy project_items_out_delete_org on public.project_items_out for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy inventory_item_visibility_select_org on public.inventory_item_visibility for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_item_visibility_insert_org on public.inventory_item_visibility for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_item_visibility_update_org on public.inventory_item_visibility for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy inventory_item_visibility_delete_org on public.inventory_item_visibility for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy student_classes_select_org on public.student_classes for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy student_classes_insert_org on public.student_classes for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy student_classes_update_org on public.student_classes for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy student_classes_delete_org on public.student_classes for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_students_select_org on public.class_students for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_students_insert_org on public.class_students for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_students_update_org on public.class_students for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_students_delete_org on public.class_students for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_visible_items_select_org on public.class_visible_items for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visible_items_insert_org on public.class_visible_items for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visible_items_update_org on public.class_visible_items for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visible_items_delete_org on public.class_visible_items for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_visibility_tags_select_org on public.class_visibility_tags for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visibility_tags_insert_org on public.class_visibility_tags for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visibility_tags_update_org on public.class_visibility_tags for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_visibility_tags_delete_org on public.class_visibility_tags for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_due_policy_select_org on public.class_due_policy for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_insert_org on public.class_due_policy for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_update_org on public.class_due_policy for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_delete_org on public.class_due_policy for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_due_policy_periods_select_org on public.class_due_policy_periods for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_periods_insert_org on public.class_due_policy_periods for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_periods_update_org on public.class_due_policy_periods for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_due_policy_periods_delete_org on public.class_due_policy_periods for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy class_permissions_select_org on public.class_permissions for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_permissions_insert_org on public.class_permissions for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_permissions_update_org on public.class_permissions for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy class_permissions_delete_org on public.class_permissions for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

create policy kiosk_settings_select_org on public.kiosk_settings for select to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy kiosk_settings_insert_org on public.kiosk_settings for insert to authenticated
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy kiosk_settings_update_org on public.kiosk_settings for update to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id())
with check (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());
create policy kiosk_settings_delete_org on public.kiosk_settings for delete to authenticated
using (public.is_active_licensed_member() and organization_id = public.current_profile_organization_id());

commit;
