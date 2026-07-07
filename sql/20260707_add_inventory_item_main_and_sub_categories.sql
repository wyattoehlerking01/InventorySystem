alter table if exists public.inventory_items
    add column if not exists main_category text,
    add column if not exists sub_category text;

alter table if exists public.inventory_items
    alter column main_category set default 'Uncategorized';

alter table if exists public.inventory_items
    alter column sub_category set default 'General';

update public.inventory_items
set
    main_category = coalesce(nullif(trim(main_category), ''), nullif(trim(category), ''), 'Uncategorized'),
    sub_category = coalesce(nullif(trim(sub_category), ''), 'General')
where main_category is null
   or trim(main_category) = ''
   or sub_category is null
   or trim(sub_category) = '';

update public.inventory_items
set category = main_category;

update public.inventory_items
set sku = concat_ws('|',
    replace(upper(regexp_replace(trim(coalesce(main_category, category, 'Uncategorized')), '\s+', ' ', 'g')), '|', ''),
    replace(upper(regexp_replace(trim(coalesce(sub_category, 'General')), '\s+', ' ', 'g')), '|', ''),
    replace(upper(regexp_replace(trim(coalesce(brand, 'Unspecified')), '\s+', ' ', 'g')), '|', ''),
    replace(upper(regexp_replace(trim(coalesce(name, 'Unnamed Item')), '\s+', ' ', 'g')), '|', '')
)
where true;

create index if not exists inventory_items_main_category_idx
    on public.inventory_items (main_category);

create index if not exists inventory_items_sub_category_idx
    on public.inventory_items (sub_category);