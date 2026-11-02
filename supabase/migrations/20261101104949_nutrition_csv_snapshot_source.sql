-- One bounded, owner-scoped statement snapshot for all three CSV granularities.
-- No table changes or writes; active food snapshots are the source of intake.
create or replace function public.get_nutrition_csv_source_v1(p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb; period jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>365 then raise sqlstate 'PT422' using message='invalid_nutrition_period'; end if;
 period:=public.get_nutrition_goal_period_v1(p_start_date,p_end_date);
 if p_end_date>(statement_timestamp() at time zone (period->>'time_zone'))::date then raise sqlstate 'PT422' using message='future_csv_period'; end if;
 with owned_meals as materialized(select m.* from public.meals m where m.user_id=owner_id and m.meal_date between p_start_date and p_end_date),
 entries as materialized(select e.*,c.name current_catalog_name,c.item_type current_catalog_item_type from public.meal_entries e join owned_meals m on m.id=e.meal_id
  join public.catalog_items c on c.id=e.catalog_item_id and c.user_id=owner_id where e.user_id=owner_id and e.voided_at is null),
 snapshots as materialized(select s.* from public.meal_entry_nutrient_snapshots s join entries e on e.id=s.meal_entry_id)
 select jsonb_build_object('schema_version',1,'as_of',statement_timestamp(),'period',period,
  'counts',jsonb_build_object('meals',(select count(*) from owned_meals),'entries',(select count(*) from entries),'snapshots',(select count(*) from snapshots)),
  'meals',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'meal_date',m.meal_date,'meal_type',m.meal_type,'state',m.state,'eaten_at',m.eaten_at,'revision',m.revision) order by m.meal_date,m.meal_type,m.id) from owned_meals m),'[]'::jsonb),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'meal_id',e.meal_id,'catalog_item_id',e.catalog_item_id,'quantity',e.quantity::text,'quantity_unit',e.quantity_unit,'current_catalog_name',e.current_catalog_name,'current_catalog_item_type',e.current_catalog_item_type) order by e.created_at,e.id) from entries e),'[]'::jsonb),
  'snapshots',coalesce((select jsonb_agg(jsonb_build_object('meal_entry_id',s.meal_entry_id,'nutrient_code',s.nutrient_code,'amount',s.amount::text,'unit',s.unit,'provenance',s.provenance,'quality',s.quality,'source_uri',s.source_uri,'source_observed_at',s.source_observed_at,'source_catalog_revision',s.source_catalog_revision,'captured_at',s.captured_at,'value_origin',s.value_origin,'definition_basis',s.definition_basis,'intake_scope',s.intake_scope,'derivation',s.derivation,'contains_estimates',s.contains_estimates) order by s.meal_entry_id,s.nutrient_code) from snapshots s),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.get_nutrition_csv_source_v1(date,date) from public,anon,authenticated;
grant execute on function public.get_nutrition_csv_source_v1(date,date) to authenticated;
