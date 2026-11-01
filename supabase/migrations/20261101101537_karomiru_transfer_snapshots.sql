-- Fixed owner-scoped sharing payloads. No external API, image storage or claim
-- of external synchronization. Snapshots and existing nutrition stay untouched.
set lock_timeout='5s';
set statement_timeout='60s';
create table public.karomiru_transfers (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 source_kind text not null check(source_kind in ('catalog','product','batch','meal','entry')),source_id uuid not null,
 mode text not null check(mode in ('basic7','all29')),renderer_version text not null check(renderer_version='nutrition-png-v1'),
 fixed_payload jsonb not null check(jsonb_typeof(fixed_payload)='object' and pg_column_size(fixed_payload)<=4194304),
 payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$'),
 status text not null default 'prepared' check(status in ('prepared','confirmed','revoked')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 manually_confirmed_at timestamptz,revoked_at timestamptz,
 check((status='prepared' and manually_confirmed_at is null and revoked_at is null)
   or(status='confirmed' and manually_confirmed_at is not null and revoked_at is null)
   or(status='revoked' and revoked_at is not null))
);
create index karomiru_transfers_owner_source_idx on public.karomiru_transfers(user_id,source_kind,source_id,created_at desc,id);
alter table public.karomiru_transfers enable row level security;
revoke all on public.karomiru_transfers from public,anon,authenticated;
grant select on public.karomiru_transfers to authenticated;
create policy karomiru_transfers_select_own on public.karomiru_transfers for select to authenticated using((select auth.uid())=user_id);
create trigger phase8_transfer_lifecycle before insert or update or delete on public.karomiru_transfers for each row execute function private.phase6_guard_authenticated_user_write();

create or replace function private.phase8_standard_nutrient_codes() returns text[] language sql immutable set search_path=pg_catalog as $$
 select array['energy','protein','fat','saturated_fat','n3_fatty_acids','n6_fatty_acids','cholesterol','carbohydrate','carbohydrate_excluding_fiber','fiber','salt_equivalent','potassium','calcium','magnesium','phosphorus','iron','zinc','copper','selenium','molybdenum','vitamin_a','vitamin_d','vitamin_e','vitamin_b1','vitamin_b2','vitamin_b6','vitamin_b12','folate','vitamin_c']::text[]
$$;
revoke all on function private.phase8_standard_nutrient_codes() from public,anon,authenticated;

-- Known incompatible chemical forms never become a standard output through a
-- shared code/unit. NULL evidence preserves the original ordinary legacy code
-- meaning, except the specifically ambiguous historical OFF carbohydrate.
create or replace function private.phase8_nutrient_output_compatible(p_code text,p_expected_unit text,p_unit text,p_amount numeric,p_basis text,p_uri text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select p_amount is not null and p_amount::text not in ('NaN','Infinity','-Infinity') and p_unit=p_expected_unit
 and not(p_code='carbohydrate' and (coalesce(p_basis,'') in ('carbohydrates_excluding_fiber','available_carbohydrate_monosaccharide') or(coalesce(p_uri,'') like '%openfoodfacts%' and coalesce(p_basis,'')<>'total_carbohydrate_including_fiber')))
 and not(p_code='vitamin_a' and coalesce(p_basis,'') in ('iu','retinol_mass','beta_carotene_mass','generic_ug'))
 and not(p_code='vitamin_e' and coalesce(p_basis,'') in ('iu','alpha_te','total_tocopherol'))
 and not(p_code='folate' and coalesce(p_basis,'') in ('dfe','folic_acid_only'))
 and not(p_code='n3_fatty_acids' and coalesce(p_basis,'') in ('ala_only','epa_only','dha_only'))
 and not(p_code='n6_fatty_acids' and coalesce(p_basis,'')='linoleic_acid_only')
 and not(p_code='carbohydrate_excluding_fiber' and coalesce(p_basis,'') in ('sugars','total_sugars','available_carbohydrate_monosaccharide'))
$$;
revoke all on function private.phase8_nutrient_output_compatible(text,text,text,numeric,text,text) from public,anon,authenticated;

-- STABLE fixes every read, including multiple helper SELECTs, to the calling
-- statement snapshot. All source joins constrain the supplied checked owner.
create or replace function private.phase8_karomiru_payload(p_owner uuid,p_request jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare kind text:=p_request->>'source_kind'; source_id uuid; output_mode text:=coalesce(p_request->>'mode','basic7');
 item public.catalog_items; meal public.meals; entry public.meal_entries; batch public.batches;
 numerator numeric:=1; denominator numeric:=1; selected numeric; unit_value text; name_value text; basis jsonb;
 source_reference jsonb; rows_json jsonb; result jsonb; scope_value text; quantity_kind text;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or pg_column_size(p_request)>8192
 or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('source_kind','source_id','mode','quantity','quantity_unit','batch_scope','menu_name'))
 or kind is null or kind not in ('catalog','product','batch','meal','entry') or output_mode not in ('basic7','all29') then raise sqlstate 'PT422' using message='invalid_transfer_request'; end if;
 source_id:=(p_request->>'source_id')::uuid; if source_id is null then raise sqlstate 'PT422' using message='invalid_transfer_request'; end if;
 if kind in ('catalog','product','batch') then
  select * into item from public.catalog_items where user_id=p_owner and id=source_id;
  if item.id is null or (kind='product' and item.item_type not in ('product','supplement')) or (kind='batch' and item.item_type<>'batch') then return null; end if;
  if p_request->>'quantity_unit' is not null and p_request->>'quantity_unit'<>item.serving_unit then raise sqlstate 'PT422' using message='quantity_unit_mismatch'; end if;
  if p_request->>'quantity' is not null and p_request->>'quantity'!~'^[0-9]+(\.[0-9]{1,3})?$' then raise sqlstate 'PT422' using message='invalid_transfer_quantity'; end if;
  if kind='batch' then
   select * into batch from public.batches where user_id=p_owner and catalog_item_id=item.id;
   if batch.catalog_item_id is null then return null; end if;
   scope_value:=coalesce(p_request->>'batch_scope','one');
   if scope_value not in ('one','all','custom') then raise sqlstate 'PT422' using message='invalid_transfer_request'; end if;
   selected:=case scope_value when 'one' then 1 when 'all' then batch.servings else (p_request->>'quantity')::numeric end;
   numerator:=selected; denominator:=1; quantity_kind:='portions';
  else
   selected:=coalesce((p_request->>'quantity')::numeric,item.serving_size); numerator:=selected; denominator:=item.serving_size; quantity_kind:='source_unit';
   if p_request->>'batch_scope' is not null then raise sqlstate 'PT422' using message='invalid_transfer_request'; end if;
  end if;
  if selected is null or selected<=0 or selected>999999999.999 then raise sqlstate 'PT422' using message='invalid_transfer_quantity'; end if;
  name_value:=item.name; unit_value:=item.serving_unit;
  source_reference:=jsonb_build_object('catalog_revision',item.revision,'current_catalog_name',item.name,'item_type',item.item_type,'batch_servings',batch.servings::text);
  basis:=jsonb_build_object('source_serving_size',item.serving_size::text,'source_serving_unit',item.serving_unit,'selected_quantity',selected::text,'selected_unit',case when kind='batch' then '食分' else item.serving_unit end,'quantity_kind',quantity_kind,'batch_scope',scope_value,'batch_servings',batch.servings::text,'already_scaled_snapshot',false);
 else
  if p_request->>'quantity' is not null or p_request->>'quantity_unit' is not null or p_request->>'batch_scope' is not null then raise sqlstate 'PT422' using message='snapshot_must_not_be_rescaled'; end if;
  if kind='entry' then
   select * into entry from public.meal_entries where user_id=p_owner and id=source_id and voided_at is null;
   if entry.id is null then return null; end if;
   select * into meal from public.meals where user_id=p_owner and id=entry.meal_id;
   select * into item from public.catalog_items where user_id=p_owner and id=entry.catalog_item_id;
   name_value:=item.name;
  else
   select * into meal from public.meals where user_id=p_owner and id=source_id;
   name_value:=meal.meal_date::text||' '||case meal.meal_type when 'breakfast' then '朝食' when 'lunch' then '昼食' when 'dinner' then '夕食' else '間食・その他' end||'（食事全体）';
  end if;
  if meal.id is null or meal.state<>'recorded' or not exists(select 1 from public.meal_entries e where e.user_id=p_owner and e.meal_id=meal.id and e.voided_at is null and(kind='meal' or e.id=entry.id)) then return null; end if;
  source_reference:=jsonb_build_object('meal_id',meal.id,'meal_revision',meal.revision,'meal_date',meal.meal_date,'meal_type',meal.meal_type,
   'current_catalog_name',item.name,'name_origin',case when kind='entry' then 'current_catalog_name' else 'meal_date_and_type' end,
   'entries',(select jsonb_agg(jsonb_build_object('id',e.id,'catalog_item_id',e.catalog_item_id,'quantity',e.quantity::text,'quantity_unit',e.quantity_unit) order by e.id) from public.meal_entries e where e.user_id=p_owner and e.meal_id=meal.id and e.voided_at is null and(kind='meal' or e.id=entry.id)));
  basis:=jsonb_build_object('already_scaled_snapshot',true,'quantity_kind',case when kind='meal' then 'entire_meal' else 'recorded_entry' end,'selected_quantity',case when kind='entry' then entry.quantity::text else '1' end,'selected_unit',case when kind='entry' then entry.quantity_unit else '食事全体' end);
 end if;
 name_value:=coalesce(nullif(btrim(p_request->>'menu_name'),''),name_value);
 if name_value is null or char_length(name_value)>200 or name_value~'[[:cntrl:]]' then raise sqlstate 'PT422' using message='invalid_transfer_name'; end if;
 with scopes as (
  select item.id as input_id where kind in ('catalog','product','batch')
  union all select e.id from public.meal_entries e where kind in ('meal','entry') and e.user_id=p_owner and e.meal_id=meal.id and e.voided_at is null and(kind='meal' or e.id=entry.id)
 ), raw_values as (
  select n.catalog_item_id input_id,n.nutrient_code,n.amount,n.unit,n.provenance,n.quality,n.value_origin,n.definition_basis,n.intake_scope,n.derivation,n.contains_estimates,n.source_uri,n.source_observed_at,null::integer source_catalog_revision,null::timestamptz captured_at
   from public.item_nutrients n where kind in ('catalog','product','batch') and n.user_id=p_owner and n.catalog_item_id=item.id
  union all select s.meal_entry_id,s.nutrient_code,s.amount,s.unit,s.provenance,s.quality,s.value_origin,s.definition_basis,s.intake_scope,s.derivation,s.contains_estimates,s.source_uri,s.source_observed_at,s.source_catalog_revision,s.captured_at
   from public.meal_entry_nutrient_snapshots s join scopes scope on scope.input_id=s.meal_entry_id where kind in ('meal','entry')
 ), definitions as (
  select d.*,ordering.position from unnest(private.phase8_standard_nutrient_codes()) with ordinality ordering(code,position) join public.nutrient_definitions d on d.code=ordering.code
 ), values_with_evidence as (
  select d.code,d.unit,d.position,scope.input_id,n.amount,n.provenance,n.quality,n.value_origin,n.definition_basis,n.intake_scope,n.derivation,n.contains_estimates,n.source_uri,n.source_observed_at,n.source_catalog_revision,n.captured_at,
   private.phase8_nutrient_output_compatible(d.code,d.unit,n.unit,n.amount,n.definition_basis,n.source_uri) compatible
  from definitions d cross join scopes scope left join raw_values n on n.input_id=scope.input_id and n.nutrient_code=d.code
 ), aggregated as (
  select code,unit,position,count(*) entries,count(*) filter(where amount is null) missing_entries,
   count(*) filter(where amount is not null and not coalesce(compatible,false)) incompatible_entries,
   count(*) filter(where compatible) known_entries,sum(amount) filter(where compatible) known_amount,
   -- Different explicit forms cannot be summed just because both are numeric.
   count(distinct definition_basis) filter(where compatible)>1 conflicting_definitions,
   bool_or(value_origin='estimated' or provenance='estimated_dish' or contains_estimates) contains_estimates,
   jsonb_agg(jsonb_build_object('source_id',input_id,'provenance',provenance,'quality',quality,'value_origin',value_origin,'definition_basis',definition_basis,'intake_scope',intake_scope,'derivation',derivation,'contains_estimates',contains_estimates,'source_uri',source_uri,'source_observed_at',source_observed_at,'source_catalog_revision',source_catalog_revision,'captured_at',captured_at) order by input_id) evidence
  from values_with_evidence group by code,unit,position
 ) select jsonb_agg(jsonb_build_object('code',code,'unit',unit,'source_amount',case when known_entries=entries and not conflicting_definitions then known_amount::text end,
   'amount_numerator',case when known_entries=entries and not conflicting_definitions then (known_amount*numerator)::text end,'amount_denominator',denominator::text,
   'known_source_amount',known_amount::text,'entries',entries,'known_entries',known_entries,'missing_entries',missing_entries,'incompatible_entries',incompatible_entries,
   'state',case when conflicting_definitions or incompatible_entries>0 then 'incompatible' when known_entries=entries then 'complete' when known_entries=0 then 'unknown' else 'partial' end,
   'contains_estimates',contains_estimates,'evidence',evidence) order by position) into rows_json from aggregated;
 result:=jsonb_build_object('schema_version',1,'nutrient_schema_version',2,'renderer_version','nutrition-png-v1','menu_name',name_value,'mode',output_mode,'request',p_request,
  'source',jsonb_build_object('kind',kind,'id',source_id,'reference',source_reference),'basis',basis,'nutrients',rows_json);
 return result;
end $$;
revoke all on function private.phase8_karomiru_payload(uuid,jsonb) from public,anon,authenticated;

create or replace function private.phase8_transfer_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if (to_jsonb(new)-'status'-'revision'-'updated_at'-'manually_confirmed_at'-'revoked_at') is distinct from (to_jsonb(old)-'status'-'revision'-'updated_at'-'manually_confirmed_at'-'revoked_at') then raise sqlstate 'PT409' using message='immutable_transfer_payload'; end if;
 return new;
end $$;
revoke all on function private.phase8_transfer_immutable() from public,anon,authenticated;
create trigger phase8_transfer_immutable before update on public.karomiru_transfers for each row execute function private.phase8_transfer_immutable();

create or replace function public.get_karomiru_source_v1(p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); payload jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 payload:=private.phase8_karomiru_payload(owner_id,p_request);
 if payload is null then raise sqlstate 'PT404' using message='transfer_source_not_found'; end if;
 return payload;
end $$;
create or replace function public.prepare_karomiru_transfer_v1(p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; payload jsonb; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),'request',p_request));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'karomiru_prepare',request_hash,p_intent_created_at); if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 then perform private.phase6_raise_http(422,'unsupported_contract_version'); end if;
 payload:=private.phase8_karomiru_payload(owner_id,p_request);
 if payload is null then perform private.phase6_raise_http(404,'transfer_source_not_found'); end if;
 insert into public.karomiru_transfers(id,user_id,source_kind,source_id,mode,renderer_version,fixed_payload,payload_hash)
 values(p_operation_id,owner_id,p_request->>'source_kind',(p_request->>'source_id')::uuid,payload->>'mode','nutrition-png-v1',payload,private.phase6_sha256_jsonb(payload));
 result:=jsonb_build_object('transfer_id',p_operation_id,'revision',1);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'karomiru_prepare',request_hash,p_operation_id,1,result); return result;
end $$;
create or replace function public.update_karomiru_transfer_status_v1(p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_transfer_id uuid,p_expected_revision integer,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; transfer public.karomiru_transfers; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),'transfer_id',p_transfer_id,'expected_revision',p_expected_revision,'status',p_status));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'karomiru_status',request_hash,p_intent_created_at); if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_expected_revision is null or p_expected_revision<1 or p_status is null or p_status not in ('confirmed','revoked') then perform private.phase6_raise_http(422,'invalid_transfer_request'); end if;
 select * into transfer from public.karomiru_transfers where user_id=owner_id and id=p_transfer_id for update;
 if transfer.id is null then perform private.phase6_raise_http(404,'transfer_not_found'); end if;
 if transfer.revision<>p_expected_revision then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 if transfer.status='revoked' and p_status='confirmed' then perform private.phase6_raise_http(409,'transfer_already_revoked'); end if;
 if transfer.status<>p_status then
  update public.karomiru_transfers set status=p_status,revision=revision+1,updated_at=now(),manually_confirmed_at=case when p_status='confirmed' then now() else manually_confirmed_at end,revoked_at=case when p_status='revoked' then now() else null end where id=transfer.id and user_id=owner_id returning * into transfer;
 end if;
 result:=jsonb_build_object('transfer_id',transfer.id,'revision',transfer.revision,'status',transfer.status);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'karomiru_status',request_hash,transfer.id,transfer.revision,result); return result;
end $$;
create or replace function public.get_karomiru_transfer_v1(p_transfer_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); transfer public.karomiru_transfers; current_payload jsonb; changed boolean;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 select * into transfer from public.karomiru_transfers where user_id=owner_id and id=p_transfer_id;
 if transfer.id is null then raise sqlstate 'PT404' using message='transfer_not_found'; end if;
 begin current_payload:=private.phase8_karomiru_payload(owner_id,transfer.fixed_payload->'request');
  changed:=current_payload is null or private.phase6_sha256_jsonb(current_payload)<>transfer.payload_hash;
 exception when sqlstate 'PT422' then changed:=true; end;
 return jsonb_build_object('id',transfer.id,'revision',transfer.revision,'status',transfer.status,'created_at',transfer.created_at,'manually_confirmed_at',transfer.manually_confirmed_at,'revoked_at',transfer.revoked_at,'payload_hash',transfer.payload_hash,'fixed_payload',transfer.fixed_payload,'current_source_changed',changed);
end $$;
create or replace function public.list_karomiru_transfers_v1(p_source_kind text,p_source_id uuid) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 select jsonb_build_object('recent',coalesce(jsonb_agg(jsonb_build_object('id',t.id,'revision',t.revision,'status',t.status,'created_at',t.created_at,'menu_name',t.fixed_payload->>'menu_name','mode',t.mode) order by t.created_at desc,t.id),'[]'::jsonb),
  'has_more',(select count(*)>20 from public.karomiru_transfers where user_id=owner_id and source_kind=p_source_kind and source_id=p_source_id)) into result
 from(select * from public.karomiru_transfers where user_id=owner_id and source_kind=p_source_kind and source_id=p_source_id order by created_at desc,id limit 20)t;
 return result;
end $$;
revoke all on function public.get_karomiru_source_v1(jsonb),public.prepare_karomiru_transfer_v1(uuid,integer,timestamptz,jsonb),public.update_karomiru_transfer_status_v1(uuid,integer,timestamptz,uuid,integer,text),public.get_karomiru_transfer_v1(uuid),public.list_karomiru_transfers_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.get_karomiru_source_v1(jsonb),public.prepare_karomiru_transfer_v1(uuid,integer,timestamptz,jsonb),public.update_karomiru_transfer_status_v1(uuid,integer,timestamptz,uuid,integer,text),public.get_karomiru_transfer_v1(uuid),public.list_karomiru_transfers_v1(text,uuid) to authenticated;

-- Validate the actual measurement provenance once the Body pointer exists.
create or replace function public.append_nutrition_goal_v1(
 p_operation_id uuid,p_contract_version integer,p_intent_created_at timestamptz,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); request_hash text; replay jsonb; head public.nutrition_goal_heads;
 profile public.user_profiles; previous public.nutrition_goal_versions; goal public.nutrition_goal_versions;
 intent_day date; today date; zone text; action_value text; mode_value text; start_day date; supersedes uuid;
 weekdays smallint[]; target jsonb; inputs jsonb; field_name text; result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 request_hash:=private.phase6_sha256_jsonb(jsonb_build_object('contract_version',p_contract_version,'intent_created_at',private.phase6_timestamp_text(p_intent_created_at),'expected_revision',p_expected_revision,'payload',p_payload));
 replay:=private.phase6_prepare_mutation(owner_id,p_operation_id,'goal_append',request_hash,p_intent_created_at);
 if replay is not null then return replay; end if;
 if p_contract_version is distinct from 2 or p_expected_revision is null or p_expected_revision<0
 or jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>16384 then
  perform private.phase6_raise_http(422,'invalid_mutation_payload');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':nutrition-goal-head',0));
 insert into public.nutrition_goal_heads(user_id) values(owner_id) on conflict do nothing;
 select * into head from public.nutrition_goal_heads where user_id=owner_id for update;
 if head.revision<>p_expected_revision then perform private.phase6_raise_http(409,'revision_conflict'); end if;
 select * into profile from public.user_profiles where user_id=owner_id for share;
 zone:=coalesce(profile.time_zone,'Asia/Tokyo');
 if p_payload->>'time_zone' is distinct from zone or not exists(select 1 from pg_timezone_names where name=zone) then
  perform private.phase6_raise_http(409,'profile_time_zone_changed');
 end if;
 intent_day:=(p_intent_created_at at time zone zone)::date;
 today:=(now() at time zone zone)::date;
 action_value:=p_payload->>'action'; mode_value:=p_payload->>'mode';
 if action_value is null or action_value not in ('set','cancel') then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
 supersedes:=nullif(p_payload->>'supersedes_id','')::uuid;
 if supersedes is not null then
  select * into previous from public.nutrition_goal_versions where id=supersedes and user_id=owner_id for share;
  if previous.id is null or previous.action<>'set' or previous.effective_from<=greatest(today,intent_day)
  or exists(select 1 from public.nutrition_goal_versions where user_id=owner_id and supersedes_id=previous.id) then
   perform private.phase6_raise_http(409,'goal_schedule_changed');
  end if;
 end if;
 if action_value='cancel' then
  if supersedes is null then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
  start_day:=previous.effective_from; mode_value:=null; weekdays:='{}';
 else
  start_day:=(p_payload->>'effective_from')::date;
  if start_day is null or start_day<intent_day or mode_value is null or mode_value not in ('custom','profile_reference','training_split')
  or jsonb_typeof(p_payload->'targets') is distinct from 'array' then perform private.phase6_raise_http(422,'invalid_goal_payload'); end if;
  select coalesce(array_agg(value::smallint),'{}') into weekdays from jsonb_array_elements_text(coalesce(p_payload->'training_weekdays','[]'));
  if cardinality(weekdays)<>(select count(distinct d) from unnest(weekdays) d) then perform private.phase6_raise_http(422,'invalid_goal_variants'); end if;
 end if;
 insert into public.nutrition_goal_versions(user_id,stream_revision,action,supersedes_id,effective_from,mode,time_zone,training_weekdays,intent_created_at)
 values(owner_id,head.revision+1,action_value,supersedes,start_day,mode_value,zone,weekdays,p_intent_created_at) returning * into goal;
 if action_value='set' then
  if jsonb_array_length(p_payload->'targets') not between 1 and 2 then perform private.phase6_raise_http(422,'invalid_goal_variants'); end if;
  for target in select value from jsonb_array_elements(p_payload->'targets') loop
   foreach field_name in array array['energy_kcal','fiber_goal_g','salt_limit_g'] loop
    if coalesce(target->>field_name,'') !~ '^[0-9]+(\.[0-9]{1,3})?$' then perform private.phase6_raise_http(422,'invalid_goal_precision'); end if;
   end loop;
   if target->>'calculation_source' is null or target->>'calculation_source' not in ('manual','profile_reference')
   or (mode_value='profile_reference' and target->>'calculation_source'<>'profile_reference') then perform private.phase6_raise_http(422,'invalid_goal_payload'); end if;
   inputs:=nullif(target->'calculation_inputs','null'::jsonb);
   if inputs is not null and (jsonb_typeof(inputs)<>'object' or exists(select 1 from jsonb_object_keys(inputs) k where k not in
     ('formula_version','profile_revision','birth_date','sex','height_cm','weight_kg','activity_level','as_of','reference_kcal_raw','adopted_energy_kcal','weight_measurement_id'))) then
    perform private.phase6_raise_http(422,'invalid_goal_payload');
   end if;
   if target->>'calculation_source'='profile_reference' and (inputs is null or profile.revision is null
    or (inputs->>'profile_revision')::integer is distinct from profile.revision
    or inputs->>'weight_measurement_id' is distinct from profile.weight_measurement_id::text
    or inputs->>'formula_version' is distinct from 'nih-2015-dri2025-v1'
    or inputs->>'birth_date' is distinct from profile.birth_date::text or inputs->>'sex' is distinct from profile.sex
    or (inputs->>'height_cm')::numeric is distinct from profile.height_cm or (inputs->>'weight_kg')::numeric is distinct from profile.weight_kg
    or inputs->>'activity_level' is distinct from profile.activity_level or inputs->>'as_of' is distinct from intent_day::text
    or (inputs->>'adopted_energy_kcal')::numeric is distinct from (target->>'energy_kcal')::numeric
    or round(private.phase8_profile_energy_raw(owner_id,intent_day),3) is distinct from (target->>'energy_kcal')::numeric
    or profile.birth_date is null or profile.sex is null or profile.height_cm is null or profile.weight_kg is null or profile.activity_level is null) then
    perform private.phase6_raise_http(409,'profile_reference_changed');
   end if;
   insert into public.nutrition_goal_variant_targets(goal_version_id,user_id,variant,energy_kcal,protein_bps,fat_bps,carbohydrate_bps,fiber_goal_g,salt_limit_g,pfc_tolerance_bps,energy_tolerance_bps,calculation_source,calculation_inputs)
   values(goal.id,owner_id,target->>'variant',(target->>'energy_kcal')::numeric,(target->>'protein_bps')::integer,(target->>'fat_bps')::integer,(target->>'carbohydrate_bps')::integer,
    (target->>'fiber_goal_g')::numeric,(target->>'salt_limit_g')::numeric,(target->>'pfc_tolerance_bps')::integer,(target->>'energy_tolerance_bps')::integer,target->>'calculation_source',inputs);
  end loop;
 end if;
 -- Check before storing the receipt as well as at transaction commit.
 if (action_value='set' and mode_value='training_split' and (select array_agg(variant order by variant) from public.nutrition_goal_variant_targets where goal_version_id=goal.id) is distinct from array['rest','training'])
 or (action_value='set' and mode_value<>'training_split' and (select array_agg(variant order by variant) from public.nutrition_goal_variant_targets where goal_version_id=goal.id) is distinct from array['default']) then
  perform private.phase6_raise_http(422,'invalid_goal_variants');
 end if;
 update public.nutrition_goal_heads set revision=goal.stream_revision,updated_at=now() where user_id=owner_id;
 result:=jsonb_build_object('goal_version_id',goal.id,'revision',goal.stream_revision,'effective_from',goal.effective_from,'recorded_at',goal.recorded_at);
 perform private.phase6_store_mutation_receipt(owner_id,p_operation_id,'goal_append',request_hash,goal.id,goal.stream_revision,result);
 return result;
end $$;
-- The new table participates in the same owner-scoped export snapshot immediately.
create or replace function public.export_user_data_v2()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 with base as materialized (select public.export_user_data_v1() payload)
 select b.payload||jsonb_build_object('schema_version',2,'as_of',statement_timestamp(),
  'definitions',(b.payload->'definitions')||jsonb_build_object('nutrient_schema_version',2,'standard_nutrient_codes',
    (select jsonb_agg(code order by code) from public.nutrient_definitions where code<>'sodium'),
    'dri_dataset',(b.payload->'definitions'->'dri_dataset')||'{"revision":"report-corrected-2025-03-25-nutrients-v2"}'::jsonb),
  'nutrition',(b.payload->'nutrition')||jsonb_build_object(
   'item_nutrients',coalesce((select jsonb_agg(old||jsonb_build_object('amount',n.amount::text,'value_origin',n.value_origin,'definition_basis',n.definition_basis,'intake_scope',n.intake_scope,'derivation',n.derivation,'contains_estimates',n.contains_estimates) order by n.catalog_item_id,n.nutrient_code)
    from jsonb_array_elements(b.payload->'nutrition'->'item_nutrients') old join public.item_nutrients n on n.catalog_item_id=(old->>'catalog_item_id')::uuid and n.nutrient_code=old->>'nutrient_code' and n.user_id=owner_id),'[]'::jsonb),
   'meal_entry_nutrient_snapshots',coalesce((select jsonb_agg(old||jsonb_build_object('amount',s.amount::text,'value_origin',s.value_origin,'definition_basis',s.definition_basis,'intake_scope',s.intake_scope,'derivation',s.derivation,'contains_estimates',s.contains_estimates) order by s.meal_entry_id,s.nutrient_code)
    from jsonb_array_elements(b.payload->'nutrition'->'meal_entry_nutrient_snapshots') old
    join public.meal_entry_nutrient_snapshots s on s.meal_entry_id=(old->>'meal_entry_id')::uuid and s.nutrient_code=old->>'nutrient_code'
    join public.meal_entries e on e.id=s.meal_entry_id and e.user_id=owner_id),'[]'::jsonb)),
  'goals',public.get_nutrition_goal_history_v1(),
  'profile',(b.payload->'profile')||jsonb_build_object('weight_measurement_id',(select weight_measurement_id from public.user_profiles where user_id=owner_id)),
  'body',jsonb_build_object(
   'measurements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'measured_on',m.measured_on,'weight_kg',m.weight_kg::text,'body_fat_percent',m.body_fat_percent::text,'measured_at',m.measured_at,'time_zone',m.time_zone,'source',m.source,'revision',m.revision,'created_at',m.created_at,'updated_at',m.updated_at) order by m.measured_on) from public.body_measurements m where m.user_id=owner_id),'[]'::jsonb),
   'settings',(select jsonb_build_object('revision',s.revision,'target_weight_kg',s.target_weight_kg::text,'target_pace_kg_per_week',s.target_pace_kg_per_week::text,'weight_sync_mode',s.weight_sync_mode,'created_at',s.created_at,'updated_at',s.updated_at) from public.body_settings s where s.user_id=owner_id),
   'deleted_measurements',coalesce((select jsonb_agg(jsonb_build_object('measurement_id',t.measurement_id,'deleted_revision',t.deleted_revision,'deleted_at',t.deleted_at) order by t.deleted_at,t.measurement_id) from public.body_measurement_tombstones t where t.user_id=owner_id),'[]'::jsonb))) into result from base b;
 return result||jsonb_build_object('definitions',(result->'definitions')||jsonb_build_object('standard_nutrient_codes',to_jsonb(array['energy','protein','fat','saturated_fat','n3_fatty_acids','n6_fatty_acids','cholesterol','carbohydrate','carbohydrate_excluding_fiber','fiber','salt_equivalent','potassium','calcium','magnesium','phosphorus','iron','zinc','copper','selenium','molybdenum','vitamin_a','vitamin_d','vitamin_e','vitamin_b1','vitamin_b2','vitamin_b6','vitamin_b12','folate','vitamin_c']::text[]),'transfer_renderer_version','nutrition-png-v1'),'transfers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'source_kind',t.source_kind,'source_id',t.source_id,'mode',t.mode,'renderer_version',t.renderer_version,'fixed_payload',t.fixed_payload,'payload_hash',t.payload_hash,'status',t.status,'revision',t.revision,'created_at',t.created_at,'updated_at',t.updated_at,'manually_confirmed_at',t.manually_confirmed_at,'revoked_at',t.revoked_at) order by t.created_at,t.id) from public.karomiru_transfers t where t.user_id=owner_id),'[]'::jsonb));
end $$;
reset lock_timeout;
reset statement_timeout;

