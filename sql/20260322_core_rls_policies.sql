-- Core RLS policies for InventorySystem
-- Assumes JWT includes app_user_id that maps to public.users.id.

begin;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

create or replace function public.current_app_user_id()
returns text
language sql
stable
as $$
    select coalesce(
        nullif(auth.jwt() ->> 'app_user_id', ''),
        auth.uid()::text
    );
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select u.role
    from public.users u
    where u.id = public.current_app_user_id()
    limit 1;
$$;

create or replace function public.is_teacher_or_developer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(public.current_app_role() in ('teacher', 'developer'), false);
$$;

create or replace function public.can_access_project(target_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
        from public.projects p
        where p.id = target_project_id
          and (
              p.owner_id = public.current_app_user_id()
              or public.is_teacher_or_developer()
              or exists (
                  select 1
                  from public.project_collaborators pc
                  where pc.project_id = p.id
                    and pc.user_id = public.current_app_user_id()
              )
          )
    );
$$;

create or replace function public.can_access_class(target_class_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select (
        public.is_teacher_or_developer()
        or exists (
            select 1
            from public.class_students cs
            where cs.class_id = target_class_id
              and cs.student_id = public.current_app_user_id()
        )
    );
$$;

-- -----------------------------------------------------------------------------
-- Performance indexes for policy predicates
-- -----------------------------------------------------------------------------

create index if not exists idx_projects_owner_id on public.projects(owner_id);
create index if not exists idx_project_collaborators_user_project on public.project_collaborators(user_id, project_id);
create index if not exists idx_project_items_out_project_id on public.project_items_out(project_id);
create index if not exists idx_class_students_student_class on public.class_students(student_id, class_id);
create index if not exists idx_order_requests_user on public.order_requests(requested_by_user_id);
create index if not exists idx_extension_requests_user on public.extension_requests(user_id);
create index if not exists idx_activity_logs_user on public.activity_logs(user_id);

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.inventory_items enable row level security;
alter table public.categories enable row level security;
alter table public.visibility_tags enable row level security;
alter table public.inventory_item_visibility enable row level security;
alter table public.projects enable row level security;
alter table public.project_collaborators enable row level security;
alter table public.project_items_out enable row level security;
alter table public.activity_logs enable row level security;
alter table public.help_requests enable row level security;
alter table public.extension_requests enable row level security;
alter table public.order_requests enable row level security;
alter table public.student_classes enable row level security;
alter table public.class_students enable row level security;
alter table public.class_visible_items enable row level security;
alter table public.class_visibility_tags enable row level security;
alter table public.class_due_policy enable row level security;
alter table public.class_due_policy_periods enable row level security;
alter table public.class_permissions enable row level security;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------

drop policy if exists users_teacher_all_select on public.users;
create policy users_teacher_all_select
on public.users
for select
to authenticated
using (public.is_teacher_or_developer());

drop policy if exists users_self_select on public.users;
create policy users_self_select
on public.users
for select
to authenticated
using (id = public.current_app_user_id());

drop policy if exists users_teacher_manage on public.users;
create policy users_teacher_manage
on public.users
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

-- -----------------------------------------------------------------------------
-- inventory, categories, tags
-- -----------------------------------------------------------------------------

drop policy if exists inventory_items_all_read on public.inventory_items;
create policy inventory_items_all_read
on public.inventory_items
for select
to authenticated
using (true);

drop policy if exists inventory_items_teacher_manage on public.inventory_items;
create policy inventory_items_teacher_manage
on public.inventory_items
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists categories_all_read on public.categories;
create policy categories_all_read
on public.categories
for select
to authenticated
using (true);

drop policy if exists categories_teacher_manage on public.categories;
create policy categories_teacher_manage
on public.categories
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists visibility_tags_all_read on public.visibility_tags;
create policy visibility_tags_all_read
on public.visibility_tags
for select
to authenticated
using (true);

drop policy if exists visibility_tags_teacher_manage on public.visibility_tags;
create policy visibility_tags_teacher_manage
on public.visibility_tags
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists inventory_item_visibility_all_read on public.inventory_item_visibility;
create policy inventory_item_visibility_all_read
on public.inventory_item_visibility
for select
to authenticated
using (true);

drop policy if exists inventory_item_visibility_teacher_manage on public.inventory_item_visibility;
create policy inventory_item_visibility_teacher_manage
on public.inventory_item_visibility
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------

drop policy if exists projects_teacher_all_select on public.projects;
create policy projects_teacher_all_select
on public.projects
for select
to authenticated
using (public.is_teacher_or_developer());

drop policy if exists projects_related_select on public.projects;
create policy projects_related_select
on public.projects
for select
to authenticated
using (
    owner_id = public.current_app_user_id()
    or exists (
        select 1
        from public.project_collaborators pc
        where pc.project_id = projects.id
          and pc.user_id = public.current_app_user_id()
    )
);

drop policy if exists projects_insert on public.projects;
create policy projects_insert
on public.projects
for insert
to authenticated
with check (
    public.is_teacher_or_developer()
    or owner_id = public.current_app_user_id()
);

drop policy if exists projects_update_delete on public.projects;
create policy projects_update_delete
on public.projects
for all
to authenticated
using (
    public.is_teacher_or_developer()
    or owner_id = public.current_app_user_id()
)
with check (
    public.is_teacher_or_developer()
    or owner_id = public.current_app_user_id()
);

-- -----------------------------------------------------------------------------
-- project_collaborators
-- -----------------------------------------------------------------------------

drop policy if exists project_collaborators_select on public.project_collaborators;
create policy project_collaborators_select
on public.project_collaborators
for select
to authenticated
using (
    public.is_teacher_or_developer()
    or user_id = public.current_app_user_id()
    or exists (
        select 1
        from public.projects p
        where p.id = project_collaborators.project_id
          and p.owner_id = public.current_app_user_id()
    )
);

drop policy if exists project_collaborators_manage on public.project_collaborators;
create policy project_collaborators_manage
on public.project_collaborators
for all
to authenticated
using (
    public.is_teacher_or_developer()
    or exists (
        select 1
        from public.projects p
        where p.id = project_collaborators.project_id
          and p.owner_id = public.current_app_user_id()
    )
)
with check (
    public.is_teacher_or_developer()
    or exists (
        select 1
        from public.projects p
        where p.id = project_collaborators.project_id
          and p.owner_id = public.current_app_user_id()
    )
);

-- -----------------------------------------------------------------------------
-- project_items_out
-- -----------------------------------------------------------------------------

drop policy if exists project_items_out_select on public.project_items_out;
create policy project_items_out_select
on public.project_items_out
for select
to authenticated
using (public.can_access_project(project_id));

drop policy if exists project_items_out_manage on public.project_items_out;
create policy project_items_out_manage
on public.project_items_out
for all
to authenticated
using (public.can_access_project(project_id))
with check (public.can_access_project(project_id));

-- -----------------------------------------------------------------------------
-- class tables
-- -----------------------------------------------------------------------------

drop policy if exists student_classes_select on public.student_classes;
create policy student_classes_select
on public.student_classes
for select
to authenticated
using (
    public.can_access_class(id)
    or teacher_id = public.current_app_user_id()
);

drop policy if exists student_classes_manage on public.student_classes;
create policy student_classes_manage
on public.student_classes
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_students_select on public.class_students;
create policy class_students_select
on public.class_students
for select
to authenticated
using (
    public.is_teacher_or_developer()
    or student_id = public.current_app_user_id()
    or exists (
        select 1
        from public.student_classes sc
        where sc.id = class_students.class_id
          and sc.teacher_id = public.current_app_user_id()
    )
);

drop policy if exists class_students_manage on public.class_students;
create policy class_students_manage
on public.class_students
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_visible_items_select on public.class_visible_items;
create policy class_visible_items_select
on public.class_visible_items
for select
to authenticated
using (public.can_access_class(class_id));

drop policy if exists class_visible_items_manage on public.class_visible_items;
create policy class_visible_items_manage
on public.class_visible_items
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_visibility_tags_select on public.class_visibility_tags;
create policy class_visibility_tags_select
on public.class_visibility_tags
for select
to authenticated
using (public.can_access_class(class_id));

drop policy if exists class_visibility_tags_manage on public.class_visibility_tags;
create policy class_visibility_tags_manage
on public.class_visibility_tags
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_due_policy_select on public.class_due_policy;
create policy class_due_policy_select
on public.class_due_policy
for select
to authenticated
using (public.can_access_class(class_id));

drop policy if exists class_due_policy_manage on public.class_due_policy;
create policy class_due_policy_manage
on public.class_due_policy
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_due_policy_periods_select on public.class_due_policy_periods;
create policy class_due_policy_periods_select
on public.class_due_policy_periods
for select
to authenticated
using (public.can_access_class(class_id));

drop policy if exists class_due_policy_periods_manage on public.class_due_policy_periods;
create policy class_due_policy_periods_manage
on public.class_due_policy_periods
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists class_permissions_select on public.class_permissions;
create policy class_permissions_select
on public.class_permissions
for select
to authenticated
using (public.can_access_class(class_id));

drop policy if exists class_permissions_manage on public.class_permissions;
create policy class_permissions_manage
on public.class_permissions
for all
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

-- -----------------------------------------------------------------------------
-- request tables
-- -----------------------------------------------------------------------------

drop policy if exists help_requests_teacher_all_select on public.help_requests;
create policy help_requests_teacher_all_select
on public.help_requests
for select
to authenticated
using (public.is_teacher_or_developer());

-- Keep anonymous help-form submission possible.
drop policy if exists help_requests_anon_insert on public.help_requests;
create policy help_requests_anon_insert
on public.help_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists help_requests_teacher_manage on public.help_requests;
create policy help_requests_teacher_manage
on public.help_requests
for update
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists extension_requests_select on public.extension_requests;
create policy extension_requests_select
on public.extension_requests
for select
to authenticated
using (
    public.is_teacher_or_developer()
    or user_id = public.current_app_user_id()
);

drop policy if exists extension_requests_insert on public.extension_requests;
create policy extension_requests_insert
on public.extension_requests
for insert
to authenticated
with check (
    public.is_teacher_or_developer()
    or user_id = public.current_app_user_id()
);

drop policy if exists extension_requests_update on public.extension_requests;
create policy extension_requests_update
on public.extension_requests
for update
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

drop policy if exists order_requests_select on public.order_requests;
create policy order_requests_select
on public.order_requests
for select
to authenticated
using (
    public.is_teacher_or_developer()
    or requested_by_user_id = public.current_app_user_id()
);

drop policy if exists order_requests_insert on public.order_requests;
create policy order_requests_insert
on public.order_requests
for insert
to authenticated
with check (
    public.is_teacher_or_developer()
    or requested_by_user_id = public.current_app_user_id()
);

drop policy if exists order_requests_update on public.order_requests;
create policy order_requests_update
on public.order_requests
for update
to authenticated
using (public.is_teacher_or_developer())
with check (public.is_teacher_or_developer());

-- -----------------------------------------------------------------------------
-- activity logs
-- -----------------------------------------------------------------------------

drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select
on public.activity_logs
for select
to authenticated
using (
    public.is_teacher_or_developer()
    or user_id = public.current_app_user_id()
);

drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert
on public.activity_logs
for insert
to authenticated
with check (
    public.is_teacher_or_developer()
    or user_id = public.current_app_user_id()
);

commit;
