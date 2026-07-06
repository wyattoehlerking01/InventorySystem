alter table if exists public.inventory_items
    add column if not exists part_number text,
    add column if not exists location text,
    add column if not exists brand text,
    add column if not exists supplier text,
    add column if not exists image_link text,
    add column if not exists supplier_listing_link text,
    add column if not exists item_type text not null default 'item',
    add column if not exists visibility_level text not null default 'standard';

update public.inventory_items
set item_type = 'item'
where item_type is null or trim(item_type) = '';

update public.inventory_items
set visibility_level = 'standard'
where visibility_level is null or trim(visibility_level) = '';

alter table if exists public.project_items_out
    add column if not exists bundle_transaction_id uuid;

create table if not exists public.inventory_item_bundles (
    id uuid primary key default gen_random_uuid(),
    bundle_item_id text not null references public.inventory_items(id) on delete cascade,
    component_item_id text not null references public.inventory_items(id) on delete cascade,
    component_quantity integer not null default 1 check (component_quantity > 0),
    created_at timestamptz not null default now(),
    unique (bundle_item_id, component_item_id)
);

create index if not exists inventory_item_bundles_bundle_item_idx
    on public.inventory_item_bundles (bundle_item_id);

create index if not exists inventory_item_bundles_component_item_idx
    on public.inventory_item_bundles (component_item_id);

alter table public.inventory_item_bundles enable row level security;

drop policy if exists "inventory item bundles read for authenticated" on public.inventory_item_bundles;
create policy "inventory item bundles read for authenticated"
    on public.inventory_item_bundles
    for select
    to authenticated
    using (true);

drop policy if exists "inventory item bundles write for authenticated" on public.inventory_item_bundles;
create policy "inventory item bundles write for authenticated"
    on public.inventory_item_bundles
    for all
    to authenticated
    using (true)
    with check (true);

drop policy if exists "inventory item bundles service role full access" on public.inventory_item_bundles;
create policy "inventory item bundles service role full access"
    on public.inventory_item_bundles
    for all
    to service_role
    using (true)
    with check (true);

create table if not exists public.project_item_bundle_transactions (
    id uuid primary key,
    project_id text not null references public.projects(id) on delete cascade,
    bundle_item_id text not null references public.inventory_items(id),
    bundle_quantity integer not null default 1 check (bundle_quantity > 0),
    signout_date timestamptz,
    due_date timestamptz,
    assigned_to_user_id text,
    signed_out_by_user_id text,
    returned_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists project_item_bundle_transactions_project_idx
    on public.project_item_bundle_transactions (project_id, created_at desc);

create index if not exists project_item_bundle_transactions_bundle_item_idx
    on public.project_item_bundle_transactions (bundle_item_id, created_at desc);

alter table public.project_item_bundle_transactions enable row level security;

drop policy if exists "project item bundle transactions read for authenticated" on public.project_item_bundle_transactions;
create policy "project item bundle transactions read for authenticated"
    on public.project_item_bundle_transactions
    for select
    to authenticated
    using (true);

drop policy if exists "project item bundle transactions write for authenticated" on public.project_item_bundle_transactions;
create policy "project item bundle transactions write for authenticated"
    on public.project_item_bundle_transactions
    for all
    to authenticated
    using (true)
    with check (true);

drop policy if exists "project item bundle transactions service role full access" on public.project_item_bundle_transactions;
create policy "project item bundle transactions service role full access"
    on public.project_item_bundle_transactions
    for all
    to service_role
    using (true)
    with check (true);