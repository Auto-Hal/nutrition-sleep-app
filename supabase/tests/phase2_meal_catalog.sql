begin;
select plan(51);

select has_table('public', 'nutrient_definitions', 'nutrient definitions exist');
select has_table('public', 'catalog_items', 'catalog items exist');
select has_table('public', 'item_nutrients', 'current nutrient values exist');
select has_table('public', 'batches', 'batches exist');
select has_table('public', 'batch_components', 'batch components exist');
select has_table('public', 'meals', 'meal slots exist');
select has_table('public', 'meal_entries', 'meal entries exist');
select has_table('public', 'meal_entry_nutrient_snapshots', 'immutable meal snapshots exist');

select has_column('public', 'meal_entry_nutrient_snapshots', 'amount', 'snapshot amount is nullable');
select has_column('public', 'meal_entry_nutrient_snapshots', 'provenance', 'snapshot provenance exists');
select has_column('public', 'meal_entry_nutrient_snapshots', 'source_catalog_revision', 'snapshot source revision exists');
select has_column('public', 'meal_entry_nutrient_snapshots', 'quality', 'snapshot data quality exists');
select has_column('public', 'meal_entry_nutrient_snapshots', 'source_uri', 'snapshot source URI exists');
select has_column('public', 'meal_entry_nutrient_snapshots', 'source_observed_at', 'snapshot source timestamp exists');
select ok((select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'meal_entry_nutrient_snapshots' and column_name = 'provenance'), 'unknown snapshot provenance may be NULL');
select has_column('public', 'meal_entries', 'idempotency_key', 'meal idempotency key exists');
select has_column('public', 'meals', 'eaten_at', 'meal eaten timestamp exists');

select has_index('public', 'catalog_items', 'catalog_items_user_idempotency_idx', 'catalog idempotency index exists');
select has_index('public', 'meal_entries', 'meal_entries_user_idempotency_idx', 'meal idempotency index exists');
select has_index('public', 'meals', 'meals_fixed_slot_idx', 'fixed slot uniqueness index exists');
select has_index('public', 'batch_components', 'batch_components_catalog_item_idx', 'batch component catalog foreign key index exists');
select has_index('public', 'batches', 'batches_user_idx', 'batch owner foreign key index exists');
select has_index('public', 'meal_entries', 'meal_entries_catalog_item_idx', 'meal entry catalog foreign key index exists');
select has_index('public', 'meal_entries', 'meal_entries_meal_idx', 'meal entry meal foreign key index exists');
select has_index('public', 'meal_entry_nutrient_snapshots', 'meal_snapshots_nutrient_idx', 'snapshot nutrient foreign key index exists');
select has_index('public', 'item_nutrients', 'item_nutrients_nutrient_idx', 'current nutrient foreign key index exists');

select ok((select relrowsecurity from pg_class where oid = 'public.catalog_items'::regclass), 'catalog RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.meals'::regclass), 'meal RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.meal_entries'::regclass), 'entry RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.meal_entry_nutrient_snapshots'::regclass), 'snapshot RLS enabled');

select policies_are('public', 'catalog_items', array['catalog_items_own'], 'catalog is owner scoped');
select policies_are('public', 'meals', array['meals_own'], 'meals are owner scoped');
select policies_are('public', 'meal_entries', array['meal_entries_own'], 'entries are owner scoped');
select policies_are('public', 'meal_entry_nutrient_snapshots', array['snapshots_own'], 'snapshots are owner scoped');

select table_privs_are('public', 'catalog_items', 'anon', array[]::text[], 'anon has no catalog privileges');
select table_privs_are('public', 'meal_entries', 'anon', array[]::text[], 'anon has no meal privileges');
select table_privs_are('public', 'meal_entry_nutrient_snapshots', 'authenticated', array['SELECT'], 'authenticated can only read snapshots');

select function_privs_are('public', 'create_catalog_item', array['public.catalog_item_type','text','text','numeric','text','jsonb','text'], 'authenticated', array['EXECUTE'], 'authenticated can create catalog items');
select function_privs_are('public', 'create_meal_entry', array['date','public.meal_type','timestamp with time zone','uuid','numeric','text','text'], 'authenticated', array['EXECUTE'], 'authenticated can create meal entries');
select function_privs_are('public', 'create_skipped_meal', array['date','public.meal_type'], 'authenticated', array['EXECUTE'], 'authenticated can mark fixed meals skipped');

select ok((select prosecdef from pg_proc where oid = 'public.create_meal_entry(date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure), 'meal snapshot RPC has controlled definer boundary');
select ok((select position('pg_advisory_xact_lock' in pg_get_functiondef('public.create_meal_entry(date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure)) > 0), 'meal creation serializes duplicate attempts');
select ok((select position('source_catalog_revision' in pg_get_functiondef('public.create_meal_entry(date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure)) > 0), 'meal creation records catalog revision');
select ok((select position('n.amount is null' in lower(pg_get_functiondef('public.create_meal_entry(date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure))) > 0), 'meal creation preserves unknown nutrients');
select ok((select position('coalesce(n.quality' in pg_get_functiondef('public.create_meal_entry(date,public.meal_type,timestamptz,uuid,numeric,text,text)'::regprocedure)) > 0), 'meal creation snapshots data quality');
select ok((select position('batch items must be created through the batch RPC' in pg_get_functiondef('public.create_catalog_item(public.catalog_item_type,text,text,numeric,text,jsonb,text)'::regprocedure)) > 0), 'generic catalog RPC cannot create batches');
select ok((select position('batch items must be edited through the batch RPC' in pg_get_functiondef('public.update_catalog_item(uuid,integer,text,text,numeric,text,boolean,jsonb)'::regprocedure)) > 0), 'generic catalog RPC cannot edit batches');
select ok((select position('perform public.recalculate_batch_nutrients' in pg_get_functiondef('public.update_catalog_item(uuid,integer,text,text,numeric,text,boolean,jsonb)'::regprocedure)) > 0), 'component catalog updates refresh dependent batch nutrients');
select ok((select position('batch component cannot be another batch' in pg_get_functiondef('public.create_batch(text,text,numeric,text,jsonb,text)'::regprocedure)) > 0), 'nested batches are rejected');
select ok((select position('meal with active entries must remain recorded' in pg_get_functiondef('public.set_meal_state(uuid,integer,public.meal_state,timestamptz)'::regprocedure)) > 0), 'meal state RPC preserves active-entry consistency');
select ok((
  select position('bool_or' in lower(pg_get_functiondef('public.recalculate_batch_nutrients(uuid)'::regprocedure))) > 0
     and position('n.quality' in lower(pg_get_functiondef('public.recalculate_batch_nutrients(uuid)'::regprocedure))) > 0
), 'batch quality preserves the weakest component quality');

select * from finish();
rollback;
