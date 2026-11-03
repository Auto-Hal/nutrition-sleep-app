-- Read compatibility for existing estimated PFC snapshots with narrative notes.
-- Same code/unit finite amounts only; known conflicting bases and ambiguous OFF C remain excluded.
-- New-write validation, DRI, and immutable snapshots are unchanged.
set lock_timeout = '5s';
set statement_timeout = '60s';
create or replace function public.get_nutrition_goal_period_v1(p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>365 then
  raise sqlstate 'PT422' using message='invalid_nutrition_period';
 end if;
 with dates as (select p_start_date+i as meal_date from generate_series(0,p_end_date-p_start_date) i),
 owned_meals as (select m.* from public.meals m where m.user_id=owner_id and m.meal_date between p_start_date and p_end_date),
 entries as (
  select m.meal_date,e.id entry_id,c.item_type from owned_meals m join public.meal_entries e on e.meal_id=m.id and e.user_id=owner_id and e.voided_at is null
  join public.catalog_items c on c.id=e.catalog_item_id and c.user_id=owner_id
 ), days as (
  select d.meal_date,
   (select count(*)=3 from owned_meals m where m.meal_date=d.meal_date and m.meal_type in ('breakfast','lunch','dinner') and m.state in ('recorded','skipped')) record_complete,
   (select count(*) from entries e where e.meal_date=d.meal_date) entry_count,
   exists(select 1 from owned_meals m where m.meal_date=d.meal_date and m.state<>'not_recorded') has_record
  from dates d
 ), values_with_evidence as (
  select e.*,d.code,d.unit,s.amount,s.quality,s.value_origin,s.contains_estimates,s.provenance,
   s.amount is not null and s.unit=d.unit and s.amount::text not in ('NaN','Infinity','-Infinity')
   and (s.definition_basis is null or
    (d.code in ('energy','protein','fat','carbohydrate')
     and (s.value_origin='estimated' or (s.value_origin is null and s.provenance='estimated_dish'))
     and not(s.definition_basis=any(array['ala_only','alpha_te','alpha_tocopherol','ascorbic_acid_equivalent','available_carbohydrate_monosaccharide','beta_carotene_mass','carbohydrates_excluding_fiber','cholesterol_mass','dfe','dha_only','dietary_fiber','elemental_mass','elemental_sodium','epa_only','folic_acid_only','food_folate','generic_ug','iu','jp_label_carbohydrate','jp_label_carbohydrate_excluding_fiber','jp_label_dietary_fiber','linoleic_acid_only','rae','recorded_food_energy','retinol_mass','riboflavin_mass','salt_equivalent','salt_equivalent_from_sodium','sugars','thiamine_hydrochloride_mass','thiamine_mass','total_carbohydrate_including_fiber','total_fat','total_n3','total_n6','total_protein','total_rae','total_saturated_fat','total_sugars','total_tocopherol','vitamin_b12_mass','vitamin_b6_mass','vitamin_d_mass']::text[])))
    or ('{"energy":{"unit":"kcal","allowed":["recorded_food_energy"],"incompatible":[]},"protein":{"unit":"g","allowed":["total_protein"],"incompatible":[]},"fat":{"unit":"g","allowed":["total_fat"],"incompatible":[]},"carbohydrate":{"unit":"g","allowed":["total_carbohydrate_including_fiber","jp_label_carbohydrate"],"incompatible":["carbohydrates_excluding_fiber","available_carbohydrate_monosaccharide"]},"fiber":{"unit":"g","allowed":["dietary_fiber","jp_label_dietary_fiber"],"incompatible":[]},"calcium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"iron":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"zinc":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"vitamin_a":{"unit":"ug_rae","allowed":["total_rae","rae"],"incompatible":["iu","retinol_mass","beta_carotene_mass","generic_ug"]},"vitamin_b1":{"unit":"mg","allowed":["thiamine_mass"],"incompatible":["thiamine_hydrochloride_mass"]},"vitamin_b2":{"unit":"mg","allowed":["riboflavin_mass"],"incompatible":[]},"vitamin_b6":{"unit":"mg","allowed":["vitamin_b6_mass"],"incompatible":[]},"vitamin_b12":{"unit":"ug","allowed":["vitamin_b12_mass"],"incompatible":[]},"vitamin_c":{"unit":"mg","allowed":["ascorbic_acid_equivalent"],"incompatible":[]},"vitamin_d":{"unit":"ug","allowed":["vitamin_d_mass"],"incompatible":["iu"]},"vitamin_e":{"unit":"mg","allowed":["alpha_tocopherol"],"incompatible":["iu","alpha_te","total_tocopherol"]},"sodium":{"unit":"mg","allowed":["elemental_sodium","elemental_mass"],"incompatible":[]},"salt_equivalent":{"unit":"g","allowed":["salt_equivalent","salt_equivalent_from_sodium"],"incompatible":[]},"saturated_fat":{"unit":"g","allowed":["total_saturated_fat"],"incompatible":[]},"n3_fatty_acids":{"unit":"g","allowed":["total_n3"],"incompatible":["ala_only","epa_only","dha_only"]},"n6_fatty_acids":{"unit":"g","allowed":["total_n6"],"incompatible":["linoleic_acid_only"]},"cholesterol":{"unit":"mg","allowed":["cholesterol_mass"],"incompatible":[]},"carbohydrate_excluding_fiber":{"unit":"g","allowed":["jp_label_carbohydrate_excluding_fiber","carbohydrates_excluding_fiber"],"incompatible":["sugars","total_sugars","available_carbohydrate_monosaccharide"]},"potassium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"magnesium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"phosphorus":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"copper":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"selenium":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"molybdenum":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"folate":{"unit":"ug","allowed":["food_folate"],"incompatible":["dfe","folic_acid_only"]}}'::jsonb->d.code->'allowed')?s.definition_basis)
   and not(coalesce(s.source_uri,'') ilike '%openfoodfacts%' and ((d.code='carbohydrate' and coalesce(s.definition_basis,'')<>'total_carbohydrate_including_fiber') or(d.code='vitamin_a' and coalesce(s.definition_basis,'') not in ('total_rae','rae')) or(d.code='vitamin_e' and coalesce(s.definition_basis,'')<>'alpha_tocopherol'))) as comparable
  from entries e cross join public.nutrient_definitions d
  left join public.meal_entry_nutrient_snapshots s on s.meal_entry_id=e.entry_id and s.nutrient_code=d.code
 ), aggregated as (
  select d.meal_date,n.code nutrient_code,n.unit,d.record_complete,d.entry_count,
   count(e.entry_id) filter(where e.amount is null) missing_entry_count,
   count(e.entry_id) filter(where e.amount is not null and e.comparable) known_entry_count,
   count(e.entry_id) filter(where e.amount is not null and not coalesce(e.comparable,false)) incompatible_entry_count,
   sum(e.amount) filter(where e.amount is not null and e.comparable) known_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null),0) legacy_known_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null and e.item_type in ('ingredient','product','estimated_dish')),0) food_amount,
   coalesce(sum(e.amount) filter(where e.amount is not null and e.item_type='supplement'),0) supplement_amount,
   bool_or(e.quality='unknown') filter(where e.entry_id is not null) unknown_quality,
   bool_or(e.quality='unverified') filter(where e.entry_id is not null) unverified_quality,
   bool_and(e.quality='user_verified') filter(where e.entry_id is not null) all_verified,
   bool_or(e.quality='unknown') filter(where e.amount is not null and e.comparable) known_unknown_quality,
   bool_or(e.quality='unverified') filter(where e.amount is not null and e.comparable) known_unverified_quality,
   bool_and(e.quality='user_verified') filter(where e.amount is not null and e.comparable) known_all_verified,
   bool_or(e.value_origin='estimated' or e.provenance='estimated_dish' or e.contains_estimates) filter(where e.amount is not null and e.comparable) contains_estimates,
   count(e.entry_id) filter(where e.amount is not null and e.comparable and e.contains_estimates is null) unknown_estimate_entries
  from days d cross join public.nutrient_definitions n
  left join values_with_evidence e on e.meal_date=d.meal_date and e.code=n.code
  group by d.meal_date,n.code,n.unit,d.record_complete,d.entry_count
 ), rows as (
  select a.meal_date,a.nutrient_code,a.unit,a.record_complete,a.entry_count,a.missing_entry_count,a.known_entry_count,a.incompatible_entry_count,
   a.known_amount::text known_amount,a.legacy_known_amount::text legacy_known_amount,a.food_amount::text food_amount,a.supplement_amount::text supplement_amount,
   case when a.entry_count>0 and a.known_entry_count=a.entry_count then a.known_amount::text end recorded_amount,
   a.missing_entry_count=0 coverage_complete,
   a.record_complete and a.entry_count>0 and a.missing_entry_count=0 eligible_for_reference,
   case when a.entry_count=0 then 'not_applicable' when a.missing_entry_count>0 or coalesce(a.unknown_quality,false) then 'unknown_or_incomplete'
    when coalesce(a.unverified_quality,false) then 'contains_unverified' when coalesce(a.all_verified,false) then 'user_verified' else 'unknown_or_incomplete' end quality,
   case when a.known_entry_count=0 then 'not_applicable' when coalesce(a.known_unknown_quality,false) then 'unknown'
    when coalesce(a.known_unverified_quality,false) then 'contains_unverified' when coalesce(a.known_all_verified,false) then 'user_verified' else 'unknown' end value_quality,
   case when a.contains_estimates then 'contains_estimates' when a.known_entry_count=0 or a.unknown_estimate_entries>0 then 'unknown' else 'none_declared' end estimate_status
  from aggregated a
 )
 select jsonb_build_object('schema_version',1,'nutrient_schema_version',2,'as_of',statement_timestamp(),
  'time_zone',coalesce((select time_zone from public.user_profiles where user_id=owner_id),'Asia/Tokyo'),
  'start_date',p_start_date,'end_date',p_end_date,
  'days',(select jsonb_agg(jsonb_build_object('meal_date',d.meal_date,'record_state',case when d.record_complete and d.entry_count>0 then 'complete' when d.record_complete then 'complete_empty' when d.entry_count>0 or d.has_record then 'partial' else 'not_recorded' end,'entry_count',d.entry_count) order by d.meal_date) from days d),
  'rows',(select jsonb_agg(to_jsonb(r) order by r.meal_date,r.nutrient_code) from rows r),
  'goals',public.get_nutrition_goal_history_v1()) into result;
 return result;
end $$;
reset lock_timeout;
reset statement_timeout;
