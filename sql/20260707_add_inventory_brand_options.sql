create table if not exists public.inventory_brand_options (
    kind text primary key,
    options jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.inventory_brand_options enable row level security;

drop policy if exists "inventory brand options read for authenticated" on public.inventory_brand_options;
create policy "inventory brand options read for authenticated"
    on public.inventory_brand_options
    for select
    to authenticated
    using (true);

drop policy if exists "inventory brand options write for authenticated" on public.inventory_brand_options;
create policy "inventory brand options write for authenticated"
    on public.inventory_brand_options
    for all
    to authenticated
    using (true)
    with check (true);

drop policy if exists "inventory brand options service role full access" on public.inventory_brand_options;
create policy "inventory brand options service role full access"
    on public.inventory_brand_options
    for all
    to service_role
    using (true)
    with check (true);