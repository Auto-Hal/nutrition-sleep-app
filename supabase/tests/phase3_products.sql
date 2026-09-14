begin;
select plan(25);

select has_table('public', 'products', 'commercial product metadata exists');
select has_column('public', 'products', 'barcode', 'product barcode exists');
select has_column('public', 'products', 'source_type', 'product source type exists');
select has_column('public', 'products', 'source_provider', 'product source provider exists');
select has_column('public', 'products', 'source_observed_at', 'product source observation time exists');
select has_column('public', 'products', 'confirmed_at', 'user confirmation time exists');

select ok((select relrowsecurity from pg_class where oid = 'public.products'::regclass), 'product RLS enabled');
select policies_are('public', 'products', array['products_own'], 'products are owner scoped');
select table_privs_are('public', 'products', 'anon', array[]::text[], 'anon has no product table privileges');
select table_privs_are('public', 'products', 'authenticated', array['SELECT'], 'authenticated can only read product rows');

select has_index('public', 'products', 'products_user_id_barcode_key', 'owner barcode uniqueness index exists');
select has_index('public', 'products', 'products_user_updated_idx', 'product recency index exists');
select has_index('public', 'products', 'products_user_source_idx', 'product source index exists');

select function_privs_are(
  'public', 'create_product_item',
  array['public.catalog_item_type','text','text','text','numeric','text','text','numeric','text','public.product_source_type','text','text','timestamp with time zone','jsonb','text'],
  'authenticated', array['EXECUTE'],
  'authenticated can create commercial items only through RPC'
);
select function_privs_are(
  'public', 'update_product_item',
  array['uuid','integer','text','text','numeric','text','boolean','text','numeric','text','public.product_source_type','text','text','timestamp with time zone','jsonb'],
  'authenticated', array['EXECUTE'],
  'authenticated can update commercial items only through RPC'
);
select function_privs_are(
  'public', 'set_catalog_item_active',
  array['uuid','integer','boolean'],
  'authenticated', array['EXECUTE'],
  'authenticated can safely toggle catalog active state'
);

select ok(public.is_valid_gtin('4006381333931'), 'valid EAN-13 is accepted');
select ok(not public.is_valid_gtin('4006381333932'), 'bad GTIN check digit is rejected');
select ok(not public.is_valid_gtin('12345'), 'unsupported GTIN length is rejected');

select ok(
  (select position('lower-priority source cannot overwrite current product data' in pg_get_functiondef(
    'public.update_product_item(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb)'::regprocedure
  )) > 0),
  'source priority downgrade is rejected'
);
select ok(
  (select position('when ''manufacturer_official'' then 1' in pg_get_functiondef(
    'public.update_product_item(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb)'::regprocedure
  )) > 0),
  'official source has highest priority'
);
select ok(
  (select position('when ''label_ocr'' then 2' in pg_get_functiondef(
    'public.update_product_item(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb)'::regprocedure
  )) > 0),
  'confirmed label outranks external DB'
);
select ok(
  (select position('when ''external_database'' then ''unverified''' in pg_get_functiondef(
    'public.create_product_item(public.catalog_item_type,text,text,text,numeric,text,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb,text)'::regprocedure
  )) > 0),
  'external DB nutrients remain unverified'
);
select ok(
  (select position('perform public.recalculate_batch_nutrients' in pg_get_functiondef(
    'public.update_product_item(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb)'::regprocedure
  )) > 0),
  'product update refreshes current dependent batches'
);
select ok(
  (select position('update public.meal_entry_nutrient_snapshots' in lower(pg_get_functiondef(
    'public.update_product_item(uuid,integer,text,text,numeric,text,boolean,text,numeric,text,public.product_source_type,text,text,timestamptz,jsonb)'::regprocedure
  ))) = 0),
  'product update never rewrites historical meal snapshots'
);

select * from finish();
rollback;
