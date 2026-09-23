begin;
select plan(20);

select has_column('public', 'products', 'identity_source_type', 'v2 identity source type exists');
select has_column('public', 'products', 'identity_source_provider', 'v2 identity provider exists');
select has_column('public', 'products', 'identity_source_uri', 'v2 identity URI exists');
select has_column('public', 'products', 'identity_source_observed_at', 'v2 identity observation time exists');
select has_column('public', 'products', 'identity_confirmed_at', 'v2 identity confirmation time exists');

select enum_has_labels(
  'public',
  'product_identity_source_type',
  array['manufacturer_official','external_database','user_entered'],
  'identity provenance has only proven persistable sources'
);

select ok(
  (select is_nullable = 'YES'
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'source_type'),
  'legacy source_type is nullable for v2-native rows'
);

select ok(
  (select is_nullable = 'YES'
     from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'identity_source_type'),
  'legacy rows may keep unknown identity provenance'
);

select has_index(
  'public',
  'products',
  'products_user_identity_source_idx',
  'v2 identity provenance lookup index exists'
);

select function_privs_are(
  'public',
  'create_product_item_v2',
  array[
    'public.catalog_item_type','text','text','text','numeric','text','text','numeric','text',
    'public.product_identity_source_type','text','text','timestamp with time zone','jsonb','text'
  ],
  'authenticated',
  array['EXECUTE'],
  'authenticated creates v2 Products through typed RPC'
);

select function_privs_are(
  'public',
  'update_product_item_v2',
  array[
    'uuid','integer','text','text','numeric','text','boolean','text','numeric','text',
    'public.product_identity_source_type','text','text','timestamp with time zone','jsonb','boolean','boolean'
  ],
  'authenticated',
  array['EXECUTE'],
  'authenticated updates v2 Products through typed RPC'
);

select ok(
  position('identity_source_type' in pg_get_functiondef(
    'public.create_product_item_v2(public.catalog_item_type,text,text,text,numeric,text,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,text)'::regprocedure
  )) > 0,
  'create v2 stores identity provenance separately'
);

select ok(
  position('complete nutrient tuple is required' in pg_get_functiondef(
    'public.create_product_item_v2(public.catalog_item_type,text,text,text,numeric,text,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,text)'::regprocedure
  )) > 0,
  'create v2 requires complete nutrient tuples'
);

select ok(
  position('serving basis change requires complete nutrient replacement' in pg_get_functiondef(
    'public.update_product_item_v2(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  )) > 0,
  'basis changes require coordinated nutrient replacement'
);

select ok(
  position('verified nutrient replacement requires explicit confirmation' in pg_get_functiondef(
    'public.update_product_item_v2(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  )) > 0,
  'verified nutrient replacement is explicit'
);

select ok(
  position('external database nutrient cannot be user verified by adapter' in pg_get_functiondef(
    'public.create_product_item_v2(public.catalog_item_type,text,text,text,numeric,text,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,text)'::regprocedure
  )) > 0,
  'external adapter cannot create user-verified nutrients'
);

select ok(
  position('nutrient codes must be unique' in pg_get_functiondef(
    'public.update_product_item_v2(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  )) > 0,
  'v2 update rejects duplicate nutrient codes'
);

select ok(
  position('app.product_v2_write' in pg_get_functiondef(
    'public.protect_phase6_product_legacy_source()'::regprocedure
  )) > 0,
  'v2 Product rows are guarded from legacy update paths'
);

select ok(
  position('update public.meal_entry_nutrient_snapshots' in lower(pg_get_functiondef(
    'public.update_product_item_v2(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_identity_source_type,text,text,timestamptz,jsonb,boolean,boolean)'::regprocedure
  ))) = 0,
  'v2 Product updates never rewrite historical meal snapshots'
);

select table_privs_are(
  'public',
  'products',
  'authenticated',
  array['SELECT'],
  'v2 migration does not widen Product table write privileges'
);

select * from finish();
rollback;
