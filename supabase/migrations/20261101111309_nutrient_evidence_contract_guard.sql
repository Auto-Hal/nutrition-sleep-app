-- Contract v2 evidence guards. No historical nutrient/snapshot rows are updated.
set lock_timeout='5s';
set statement_timeout='60s';
create or replace function private.phase8_nutrient_basis_contract() returns jsonb language sql immutable set search_path=pg_catalog as $$ select '{"energy":{"unit":"kcal","allowed":["recorded_food_energy"],"incompatible":[]},"protein":{"unit":"g","allowed":["total_protein"],"incompatible":[]},"fat":{"unit":"g","allowed":["total_fat"],"incompatible":[]},"carbohydrate":{"unit":"g","allowed":["total_carbohydrate_including_fiber","jp_label_carbohydrate"],"incompatible":["carbohydrates_excluding_fiber","available_carbohydrate_monosaccharide"]},"fiber":{"unit":"g","allowed":["dietary_fiber","jp_label_dietary_fiber"],"incompatible":[]},"calcium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"iron":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"zinc":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"vitamin_a":{"unit":"ug_rae","allowed":["total_rae","rae"],"incompatible":["iu","retinol_mass","beta_carotene_mass","generic_ug"]},"vitamin_b1":{"unit":"mg","allowed":["thiamine_mass"],"incompatible":["thiamine_hydrochloride_mass"]},"vitamin_b2":{"unit":"mg","allowed":["riboflavin_mass"],"incompatible":[]},"vitamin_b6":{"unit":"mg","allowed":["vitamin_b6_mass"],"incompatible":[]},"vitamin_b12":{"unit":"ug","allowed":["vitamin_b12_mass"],"incompatible":[]},"vitamin_c":{"unit":"mg","allowed":["ascorbic_acid_equivalent"],"incompatible":[]},"vitamin_d":{"unit":"ug","allowed":["vitamin_d_mass"],"incompatible":["iu"]},"vitamin_e":{"unit":"mg","allowed":["alpha_tocopherol"],"incompatible":["iu","alpha_te","total_tocopherol"]},"sodium":{"unit":"mg","allowed":["elemental_sodium","elemental_mass"],"incompatible":[]},"salt_equivalent":{"unit":"g","allowed":["salt_equivalent","salt_equivalent_from_sodium"],"incompatible":[]},"saturated_fat":{"unit":"g","allowed":["total_saturated_fat"],"incompatible":[]},"n3_fatty_acids":{"unit":"g","allowed":["total_n3"],"incompatible":["ala_only","epa_only","dha_only"]},"n6_fatty_acids":{"unit":"g","allowed":["total_n6"],"incompatible":["linoleic_acid_only"]},"cholesterol":{"unit":"mg","allowed":["cholesterol_mass"],"incompatible":[]},"carbohydrate_excluding_fiber":{"unit":"g","allowed":["jp_label_carbohydrate_excluding_fiber","carbohydrates_excluding_fiber"],"incompatible":["sugars","total_sugars","available_carbohydrate_monosaccharide"]},"potassium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"magnesium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"phosphorus":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"copper":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"selenium":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"molybdenum":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"folate":{"unit":"ug","allowed":["food_folate"],"incompatible":["dfe","folic_acid_only"]}}'::jsonb $$;
revoke all on function private.phase8_nutrient_basis_contract() from public,anon,authenticated;

create or replace function private.phase8_evidence_uri_safe(p_uri text) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare decoded text:=p_uri; part text[]; byte_value integer; i integer;
begin
 if p_uri is null then return true; end if;
 if char_length(p_uri)>1000 or p_uri!~*'^https?://[^/?#[:space:]]+' or p_uri~*'^https?://[^/?#]*@' then return false; end if;
 for i in 1..4 loop
  for part in select regexp_matches(decoded,'%([0-9a-f]{2})','gi') loop
   byte_value:=get_byte(decode(part[1],'hex'),0);
   if byte_value=0 then return false; end if;
   if byte_value<128 then decoded:=regexp_replace(decoded,'(?i)%'||part[1],replace(chr(byte_value),chr(92),chr(92)||chr(92)),'g'); end if;
  end loop;
 end loop;
 return decoded!~*'([?&#;])((access[_-]?|refresh[_-]?)?token|secret|api[_-]?key|auth(orization)?|password|credential|signature|sig|key|session(id)?|x-(amz|goog)-(credential|signature))=';
end $$;
revoke all on function private.phase8_evidence_uri_safe(text) from public,anon,authenticated;

create or replace function private.phase8_derivation_valid(p_value jsonb,p_depth integer default 0) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb; key text;
begin
 if p_value is null or p_value='null'::jsonb then return true; end if;
 if p_depth>3 or jsonb_typeof(p_value)<>'object' or pg_column_size(p_value)>4096 or p_value->'version' is distinct from '1'::jsonb
 or coalesce(p_value->>'method','') not in ('batch_per_serving','sodium_to_salt','total_carbohydrate_minus_fiber','external_calculation','storage_precision','snapshot_scaling')
 or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('method','version','reason','inputs','source_basis','same_source_confirmed','factor_numerator','factor_denominator','source_amount','source_unit','quantity','serving_size','source_derivation')) then return false; end if;
 if p_value?'reason' and p_value->>'reason' is distinct from 'below_storage_precision' then return false; end if;
 if p_value?'same_source_confirmed' and jsonb_typeof(p_value->'same_source_confirmed')<>'boolean' then return false; end if;
 if p_value?'source_basis' and p_value->>'source_basis' is distinct from 'same_label_same_serving' then return false; end if;
 foreach key in array array['factor_numerator','factor_denominator','source_amount','quantity','serving_size'] loop
  if p_value?key and (jsonb_typeof(p_value->key)<>'string' or char_length(p_value->>key)>128 or p_value->>key!~'^[0-9]+(\.[0-9]+)?$') then return false; end if;
 end loop;
 if p_value?'factor_denominator' and (p_value->>'factor_denominator')::numeric<=0 then return false; end if;
 if p_value?'source_unit' and p_value->>'source_unit' not in ('kcal','g','mg','ug','ug_rae') then return false; end if;
 if p_value?'inputs' then
  if jsonb_typeof(p_value->'inputs')<>'array' or jsonb_array_length(p_value->'inputs')>30 then return false; end if;
  for v in select value from jsonb_array_elements(p_value->'inputs') loop
   if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) k where k not in ('code','amount','unit','quality','value_origin','definition_basis','contains_estimates','source_uri','source_observed_at'))
   or coalesce(v->>'code','')='' or char_length(v->>'code')>60 or jsonb_typeof(v->'amount') is distinct from 'string' or coalesce(v->>'amount','')!~'^[0-9]+(\.[0-9]+)?$' or char_length(v->>'amount')>128
   or coalesce(v->>'unit','') not in ('kcal','g','mg','ug','ug_rae') or coalesce(v->>'quality','') not in ('unknown','unverified','user_verified')
   or (v->>'value_origin' is not null and v->>'value_origin' not in ('measured','official','database','label','calculated','estimated','user_reported'))
   or (v->>'definition_basis' is not null and char_length(v->>'definition_basis')>160)
   or (v->>'source_observed_at' is not null and (v->>'source_observed_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'))
   or (v->>'contains_estimates' is not null and jsonb_typeof(v->'contains_estimates')<>'boolean') or not private.phase8_evidence_uri_safe(v->>'source_uri') then return false; end if;
   if v->>'source_observed_at' is not null then perform (v->>'source_observed_at')::timestamptz; end if;
  end loop;
 end if;
 return private.phase8_derivation_valid(p_value->'source_derivation',p_depth+1);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function private.phase8_derivation_valid(jsonb,integer) from public,anon,authenticated;

create or replace function private.phase8_nutrient_output_compatible(p_code text,p_expected_unit text,p_unit text,p_amount numeric,p_basis text,p_uri text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select p_amount is not null and p_amount::text not in ('NaN','Infinity','-Infinity') and p_unit=p_expected_unit
 and private.phase8_nutrient_basis_contract()?p_code
 and (p_basis is null or (private.phase8_nutrient_basis_contract()->p_code->'allowed')?p_basis)
 and not(coalesce(p_uri,'') ilike '%openfoodfacts%' and ((p_code='carbohydrate' and coalesce(p_basis,'')<>'total_carbohydrate_including_fiber') or (p_code='vitamin_a' and coalesce(p_basis,'') not in ('total_rae','rae')) or (p_code='vitamin_e' and coalesce(p_basis,'')<>'alpha_tocopherol')))
$$;

create or replace function private.phase8_validate_nutrient_metadata(p_value jsonb) returns void language plpgsql set search_path=pg_catalog as $$
declare contract jsonb:=private.phase8_nutrient_basis_contract()->(p_value->>'code'); basis text:=p_value->>'definition_basis'; derivation jsonb:=nullif(p_value->'derivation','null'::jsonb); method text; input1 jsonb; input2 jsonb; expected numeric;
begin
 if jsonb_typeof(p_value) is distinct from 'object' or contract is null or p_value->>'unit' is distinct from contract->>'unit' or (basis is not null and not((contract->'allowed')?basis or(contract->'incompatible')?basis)) then perform private.phase6_raise_http(422,'invalid_nutrient_definition'); end if;
 if basis is not null and (contract->'incompatible')?basis and p_value->>'amount' is not null then perform private.phase6_raise_http(422,'incompatible_nutrient_definition'); end if;
 if not private.phase8_evidence_uri_safe(p_value->>'source_uri') or (p_value->>'value_origin'='official' and p_value->>'source_uri' is null) then perform private.phase6_raise_http(422,'invalid_nutrient_source'); end if;
 if not private.phase8_derivation_valid(derivation) then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
 method:=derivation->>'method'; input1:=derivation->'inputs'->0; input2:=derivation->'inputs'->1;
 if method in ('sodium_to_salt','total_carbohydrate_minus_fiber') then
  if p_value->>'value_origin' is distinct from 'calculated' then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
  if method='sodium_to_salt' then
   if p_value->>'code' is distinct from 'salt_equivalent' or jsonb_typeof(derivation->'inputs') is distinct from 'array' or jsonb_array_length(derivation->'inputs') is distinct from 1 or input1->>'code' is distinct from 'sodium' or input1->>'unit' is distinct from 'mg'
    or coalesce(input1->>'definition_basis','elemental_sodium') not in ('elemental_sodium','elemental_mass')
    or derivation->>'factor_numerator' is distinct from '2.54' or derivation->>'factor_denominator' is distinct from '1000' then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
   expected:=(input1->>'amount')::numeric*2.54/1000;
  else
   if p_value->>'code' is distinct from 'carbohydrate_excluding_fiber' or jsonb_typeof(derivation->'inputs') is distinct from 'array' or jsonb_array_length(derivation->'inputs') is distinct from 2 or input1->>'code' is distinct from 'carbohydrate' or input2->>'code' is distinct from 'fiber' or input1->>'unit' is distinct from 'g' or input2->>'unit' is distinct from 'g'
    or coalesce(input1->>'definition_basis','') not in ('jp_label_carbohydrate','total_carbohydrate_including_fiber') or coalesce(input2->>'definition_basis','') not in ('jp_label_dietary_fiber','dietary_fiber')
    or derivation->>'source_basis' is distinct from 'same_label_same_serving' or derivation->>'same_source_confirmed' is distinct from 'true'
    or not coalesce(((input1->>'source_uri' is not null and input1->>'source_uri'=input2->>'source_uri') or(input1->>'value_origin'='label' and input2->>'value_origin'='label' and input1->>'source_observed_at' is not null and input1->>'source_observed_at'=input2->>'source_observed_at')),false) then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
   expected:=(input1->>'amount')::numeric-(input2->>'amount')::numeric;
   if expected<0 then perform private.phase6_raise_http(422,'negative_carbohydrate_difference'); end if;
  end if;
  if expected>0 and round(expected,6)=0 then
   if p_value->>'amount' is not null or derivation->>'reason' is distinct from 'below_storage_precision' then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
  elsif p_value->>'amount' is null or (p_value->>'amount')::numeric<>round(expected,6) then perform private.phase6_raise_http(422,'invalid_nutrient_derivation'); end if;
 end if;
end $$;
revoke all on function private.phase8_validate_nutrient_metadata(jsonb) from public,anon,authenticated;

-- Preserve positive sub-precision values as an explicit hold, never a stored 0.
create or replace function private.phase8_capture_amount(p_amount numeric,p_quantity numeric,p_basis numeric) returns numeric language sql immutable set search_path=pg_catalog as $$
 select case when p_amount>0 and round(p_amount*(p_quantity/p_basis),6)=0 then null else p_amount*(p_quantity/p_basis) end
$$;
create or replace function private.phase8_capture_derivation(p_existing jsonb,p_amount numeric,p_quantity numeric,p_basis numeric) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case when p_amount>0 and round(p_amount*(p_quantity/p_basis),6)=0 then jsonb_build_object('method','snapshot_scaling','version',1,'reason','below_storage_precision','source_amount',p_amount::text,'quantity',p_quantity::text,'serving_size',p_basis::text,'source_derivation',p_existing) else p_existing end
$$;
revoke all on function private.phase8_capture_amount(numeric,numeric,numeric),private.phase8_capture_derivation(jsonb,numeric,numeric,numeric) from public,anon,authenticated;

create or replace function private.phase8_apply_nutrient_metadata(p_item_id uuid,p_nutrients jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare n jsonb; owner_id uuid:=(select auth.uid()); derivation jsonb; origin text; estimates boolean; quality_value text; method text;
begin
 if owner_id is null then raise insufficient_privilege; end if;
 if jsonb_typeof(p_nutrients) is distinct from 'array' or jsonb_array_length(p_nutrients)>30 or(select count(*)<>count(distinct x->>'code') from jsonb_array_elements(p_nutrients)x) then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
 for n in select value from jsonb_array_elements(p_nutrients) loop
  if jsonb_typeof(n) is distinct from 'object' or(n?'amount' and jsonb_typeof(n->'amount') not in ('number','null')) then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
  perform private.phase8_validate_nutrient_metadata(n);
  origin:=coalesce(n->>'value_origin',case when n->>'provenance'='estimated_dish' then 'estimated' end);
  if n->>'provenance'='estimated_dish' and origin<>'estimated' then perform private.phase6_raise_http(422,'invalid_mutation_payload'); end if;
  derivation:=nullif(n->'derivation','null'::jsonb); method:=derivation->>'method'; quality_value:=coalesce(n->>'quality','unknown');
  estimates:=case when n->>'provenance'='estimated_dish' or origin='estimated' then true else (n->>'contains_estimates')::boolean end;
  if jsonb_typeof(derivation->'inputs')='array' and jsonb_array_length(derivation->'inputs')>0 then
   if exists(select 1 from jsonb_array_elements(derivation->'inputs')i where i->>'value_origin'='estimated' or i->>'contains_estimates'='true') then
    if origin not in ('calculated','estimated') or origin is null then perform private.phase6_raise_http(422,'estimated_source_must_be_retained'); end if; estimates:=true;
   elsif estimates is distinct from true and exists(select 1 from jsonb_array_elements(derivation->'inputs')i where i->>'contains_estimates' is null) then estimates:=null; end if;
   if method in ('sodium_to_salt','total_carbohydrate_minus_fiber') then
    quality_value:=case when quality_value='unknown' or exists(select 1 from jsonb_array_elements(derivation->'inputs')i where i->>'quality'='unknown') then 'unknown' when quality_value='unverified' or exists(select 1 from jsonb_array_elements(derivation->'inputs')i where i->>'quality'='unverified') then 'unverified' else 'user_verified' end;
   end if;
  end if;
  if n->>'amount' is not null and(n->>'amount')::numeric>0 and round((n->>'amount')::numeric,6)=0 then
   derivation:=jsonb_build_object('method','storage_precision','version',1,'reason','below_storage_precision','source_amount',n->>'amount','source_unit',n->>'unit','source_derivation',derivation);
  end if;
  update public.item_nutrients set amount=case when n->>'amount' is not null and(n->>'amount')::numeric>0 and round((n->>'amount')::numeric,6)=0 then null else amount end,
    quality=quality_value,value_origin=origin,definition_basis=n->>'definition_basis',intake_scope=n->>'intake_scope',derivation=derivation,contains_estimates=estimates
   where catalog_item_id=p_item_id and user_id=owner_id and nutrient_code=n->>'code';
 end loop;
end $$;
revoke all on function private.phase8_apply_nutrient_metadata(uuid,jsonb) from public,anon,authenticated;

create or replace function private.phase8_chat_draft_evidence_guard() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare n jsonb;
begin
 if new.schema_version=2 and(tg_op='INSERT' or new.payload is distinct from old.payload) then
  for n in select value from jsonb_array_elements(coalesce(new.payload->'nutrients','[]'::jsonb)) loop
   perform private.phase8_validate_nutrient_metadata(n||jsonb_build_object('value_origin',coalesce(n->>'value_origin',case when n->>'provenance' in ('official','estimated','label','database','measured','calculated','user_reported') then n->>'provenance' end)));
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.phase8_chat_draft_evidence_guard() from public,anon,authenticated;
create trigger phase8_chat_draft_evidence before insert or update of payload on public.chat_meal_drafts for each row execute function private.phase8_chat_draft_evidence_guard();

-- New captures only: preserve positive values below numeric(18,6) as NULL/reason.
create or replace function public.create_meal_entry_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_reference_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  reference_payload jsonb;
  current_reference_fingerprint text;
  receipt private.mutation_receipts;
  item public.catalog_items;
  meal public.meals;
  entry public.meal_entries;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform private.phase6_acquire_write_guard(owner_id);

  if p_operation_id is null then
    perform private.phase6_raise_http(422, 'invalid_operation_id');
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_create_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'meal_date', p_meal_date,
      'meal_type', case when p_meal_type is null then null else p_meal_type::text end,
      'eaten_at', private.phase6_timestamp_text(p_eaten_at),
      'catalog_item_id', p_catalog_item_id,
      'quantity', case
        when p_quantity is null then null
        else pg_catalog.trim_scale(p_quantity)
      end,
      'quantity_unit', nullif(pg_catalog.btrim(p_quantity_unit), ''),
      'reference_fingerprint', nullif(pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)), '')
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':mutation:' || p_operation_id::text,
      0
    )
  );

  perform private.phase6_prune_mutation_receipts(owner_id);

  select r.*
  into receipt
  from private.mutation_receipts r
  where r.user_id = owner_id
    and r.operation_id = p_operation_id
  for update;

  if receipt.operation_id is not null then
    if receipt.request_fingerprint <> request_fingerprint then
      perform private.phase6_raise_http(409, 'operation_content_mismatch');
    end if;
    return receipt.result_json;
  end if;

  if p_contract_version is distinct from 2 then
    perform private.phase6_raise_http(422, 'unsupported_contract_version');
  end if;

  if p_intent_created_at is null then
    perform private.phase6_raise_http(422, 'invalid_intent_created_at');
  end if;

  if p_intent_created_at < pg_catalog.now() - interval '30 days' then
    perform private.phase6_raise_http(422, 'operation_expired');
  end if;

  if p_intent_created_at > pg_catalog.now() + interval '24 hours' then
    perform private.phase6_raise_http(422, 'client_time_invalid');
  end if;

  if p_meal_date is null
     or p_meal_type is null
     or p_catalog_item_id is null
     or p_quantity is null
     or p_quantity <= 0
     or nullif(pg_catalog.btrim(p_quantity_unit), '') is null
     or p_reference_fingerprint is null
     or pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) !~ '^[0-9a-f]{64}$' then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  if p_meal_type = 'custom' and p_eaten_at is null then
    perform private.phase6_raise_http(422, 'custom_intake_requires_eaten_at');
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for share;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;

  perform 1
  from public.item_nutrients n
  where n.catalog_item_id = item.id
    and n.user_id = owner_id
  for share;

  reference_payload :=
    private.phase8_catalog_reference_payload(owner_id, item.id);
  current_reference_fingerprint :=
    private.phase6_sha256_jsonb(reference_payload);

  if not item.active
     or current_reference_fingerprint
        <> pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) then
    perform private.phase6_raise_http(409, 'reference_changed');
  end if;

  if pg_catalog.btrim(p_quantity_unit) <> item.serving_unit then
    perform private.phase6_raise_http(422, 'quantity_unit_mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':meal:' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_meal_type = 'custom' then
    insert into public.meals (
      user_id,
      meal_date,
      meal_type,
      state,
      eaten_at
    )
    values (
      owner_id,
      p_meal_date,
      p_meal_type,
      'recorded',
      p_eaten_at
    )
    returning * into meal;
  else
    select m.*
    into meal
    from public.meals m
    where m.user_id = owner_id
      and m.meal_date = p_meal_date
      and m.meal_type = p_meal_type
    for update;

    if meal.id is null then
      insert into public.meals (
        user_id,
        meal_date,
        meal_type,
        state,
        eaten_at
      )
      values (
        owner_id,
        p_meal_date,
        p_meal_type,
        'recorded',
        p_eaten_at
      )
      returning * into meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = meal.id
        and user_id = owner_id
      returning * into meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id,
    user_id,
    catalog_item_id,
    quantity,
    quantity_unit,
    idempotency_key
  )
  values (
    meal.id,
    owner_id,
    item.id,
    p_quantity,
    pg_catalog.btrim(p_quantity_unit),
    p_operation_id::text
  )
  returning * into entry;

  insert into public.meal_entry_nutrient_snapshots (
    meal_entry_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    source_catalog_revision,
    quality,
    source_uri,
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    entry.id,
    n.code,
    private.phase8_capture_amount(n.amount,p_quantity,(reference_payload->>'serving_size')::numeric),
    n.unit,
    n.provenance,
    (reference_payload->>'revision')::integer,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    case
      when n.source_observed_at is null then null
      else n.source_observed_at::timestamptz
    end, n.value_origin, n.definition_basis, n.intake_scope, private.phase8_capture_derivation(n.derivation,n.amount,p_quantity,(reference_payload->>'serving_size')::numeric), n.contains_estimates
  from pg_catalog.jsonb_to_recordset(reference_payload->'nutrients')
    as n(
      code text,
      amount numeric,
      unit text,
      provenance text,
      quality text,
      source_uri text,
      source_observed_at text, value_origin text, definition_basis text, intake_scope text, derivation jsonb, contains_estimates boolean
    );

  result_payload := pg_catalog.jsonb_build_object(
    'entry_id', entry.id,
    'meal_id', meal.id,
    'state', meal.state,
    'meal_revision', meal.revision
  );

  insert into private.mutation_receipts (
    user_id,
    operation_id,
    operation_kind,
    request_fingerprint,
    result_code,
    result_entity_id,
    result_revision,
    result_json,
    first_applied_at
  )
  values (
    owner_id,
    p_operation_id,
    'meal_entry_create_v3',
    request_fingerprint,
    'applied',
    entry.id,
    meal.revision,
    result_payload,
    pg_catalog.now()
  );

  return result_payload;
end;
$$;

create or replace function public.replace_meal_entry_v3(
  p_operation_id uuid,
  p_contract_version integer,
  p_intent_created_at timestamptz,
  p_entry_id uuid,
  p_expected_source_meal_revision integer,
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_reference_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  request_fingerprint text;
  replay_result jsonb;
  reference_payload jsonb;
  current_reference_fingerprint text;
  source_entry public.meal_entries;
  source_meal public.meals;
  target_meal public.meals;
  item public.catalog_items;
  new_entry public.meal_entries;
  result_payload jsonb;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  request_fingerprint := private.phase6_sha256_jsonb(
    pg_catalog.jsonb_build_object(
      'contract_version', p_contract_version,
      'mutation_kind', 'meal_entry_replace_v3',
      'intent_created_at', private.phase6_timestamp_text(p_intent_created_at),
      'entry_id', p_entry_id,
      'expected_source_meal_revision', p_expected_source_meal_revision,
      'meal_date', p_meal_date,
      'meal_type', case when p_meal_type is null then null else p_meal_type::text end,
      'eaten_at', private.phase6_timestamp_text(p_eaten_at),
      'catalog_item_id', p_catalog_item_id,
      'quantity', case when p_quantity is null then null else pg_catalog.trim_scale(p_quantity) end,
      'quantity_unit', nullif(pg_catalog.btrim(p_quantity_unit), ''),
      'reference_fingerprint', nullif(pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)), '')
    )
  );

  replay_result := private.phase6_prepare_mutation(
    owner_id,
    p_operation_id,
    'meal_entry_replace_v3',
    request_fingerprint,
    p_intent_created_at
  );
  if replay_result is not null then return replay_result; end if;

  if p_contract_version is distinct from 2
     or p_entry_id is null
     or p_expected_source_meal_revision is null
     or p_expected_source_meal_revision <= 0
     or p_meal_date is null
     or p_meal_type is null
     or p_catalog_item_id is null
     or p_quantity is null
     or p_quantity <= 0
     or nullif(pg_catalog.btrim(p_quantity_unit), '') is null
     or p_reference_fingerprint is null
     or pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) !~ '^[0-9a-f]{64}$' then
    perform private.phase6_raise_http(422, 'invalid_mutation_payload');
  end if;

  if p_meal_type = 'custom' and p_eaten_at is null then
    perform private.phase6_raise_http(422, 'custom_intake_requires_eaten_at');
  end if;

  select e.*
  into source_entry
  from public.meal_entries e
  where e.id = p_entry_id
    and e.user_id = owner_id
    and e.voided_at is null
  for update;

  if source_entry.id is null then
    perform private.phase6_raise_http(404, 'meal_entry_not_found');
  end if;

  select m.*
  into source_meal
  from public.meals m
  where m.id = source_entry.meal_id
    and m.user_id = owner_id
  for update;

  if source_meal.id is null then
    perform private.phase6_raise_http(404, 'meal_not_found');
  end if;

  if source_meal.revision <> p_expected_source_meal_revision then
    perform private.phase6_raise_http(409, 'revision_conflict');
  end if;

  select c.*
  into item
  from public.catalog_items c
  where c.id = p_catalog_item_id
    and c.user_id = owner_id
  for share;

  if item.id is null then
    perform private.phase6_raise_http(404, 'catalog_not_found');
  end if;

  perform 1
  from public.item_nutrients n
  where n.catalog_item_id = item.id
    and n.user_id = owner_id
  for share;

  reference_payload := private.phase8_catalog_reference_payload(owner_id, item.id);
  current_reference_fingerprint := private.phase6_sha256_jsonb(reference_payload);

  if not item.active
     or current_reference_fingerprint <> pg_catalog.lower(pg_catalog.btrim(p_reference_fingerprint)) then
    perform private.phase6_raise_http(409, 'reference_changed');
  end if;

  if pg_catalog.btrim(p_quantity_unit) <> item.serving_unit then
    perform private.phase6_raise_http(422, 'quantity_unit_mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      owner_id::text || ':meal:' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_meal_type = 'custom' then
    insert into public.meals (user_id, meal_date, meal_type, state, eaten_at)
    values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at)
    returning * into target_meal;
  else
    select m.*
    into target_meal
    from public.meals m
    where m.user_id = owner_id
      and m.meal_date = p_meal_date
      and m.meal_type = p_meal_type
    for update;

    if target_meal.id is null then
      insert into public.meals (user_id, meal_date, meal_type, state, eaten_at)
      values (owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at)
      returning * into target_meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = target_meal.id
        and user_id = owner_id
      returning * into target_meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id,
    user_id,
    catalog_item_id,
    quantity,
    quantity_unit,
    idempotency_key
  )
  values (
    target_meal.id,
    owner_id,
    item.id,
    p_quantity,
    pg_catalog.btrim(p_quantity_unit),
    p_operation_id::text
  )
  returning * into new_entry;

  insert into public.meal_entry_nutrient_snapshots (
    meal_entry_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    source_catalog_revision,
    quality,
    source_uri,
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    new_entry.id,
    n.code,
    private.phase8_capture_amount(n.amount,p_quantity,(reference_payload->>'serving_size')::numeric),
    n.unit,
    n.provenance,
    (reference_payload->>'revision')::integer,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    case when n.source_observed_at is null then null else n.source_observed_at::timestamptz end, n.value_origin, n.definition_basis, n.intake_scope, private.phase8_capture_derivation(n.derivation,n.amount,p_quantity,(reference_payload->>'serving_size')::numeric), n.contains_estimates
  from pg_catalog.jsonb_to_recordset(reference_payload->'nutrients')
    as n(
      code text,
      amount numeric,
      unit text,
      provenance text,
      quality text,
      source_uri text,
      source_observed_at text, value_origin text, definition_basis text, intake_scope text, derivation jsonb, contains_estimates boolean
    );

  update public.meal_entries
  set voided_at = pg_catalog.now()
  where id = source_entry.id
    and user_id = owner_id
    and voided_at is null;

  update public.meals
  set state = case
        when exists (
          select 1
          from public.meal_entries e
          where e.meal_id = source_meal.id
            and e.user_id = owner_id
            and e.voided_at is null
        ) then 'recorded'::public.meal_state
        else 'not_recorded'::public.meal_state
      end
  where id = source_meal.id
    and user_id = owner_id
  returning * into source_meal;

  if target_meal.id = source_meal.id then
    target_meal := source_meal;
  end if;

  result_payload := pg_catalog.jsonb_build_object(
    'replaced_entry_id', source_entry.id,
    'entry_id', new_entry.id,
    'meal_id', target_meal.id,
    'meal_date', target_meal.meal_date,
    'meal_type', target_meal.meal_type,
    'meal_revision', target_meal.revision,
    'source_meal_id', source_meal.id,
    'source_meal_revision', source_meal.revision,
    'source_meal_state', source_meal.state
  );

  perform private.phase6_store_mutation_receipt(
    owner_id,
    p_operation_id,
    'meal_entry_replace_v3',
    request_fingerprint,
    new_entry.id,
    target_meal.revision,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function public.create_meal_entry(
  p_meal_date date,
  p_meal_type public.meal_type,
  p_eaten_at timestamptz,
  p_catalog_item_id uuid,
  p_quantity numeric,
  p_quantity_unit text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  owner_id uuid := (select auth.uid());
  meal public.meals;
  entry public.meal_entries;
  item public.catalog_items;
begin
  if owner_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_meal_type = 'custom' and p_eaten_at is null then
    raise exception using errcode = '22023', message = 'custom intake needs eaten_at';
  end if;

  if p_idempotency_key is not null then
    select * into entry
    from public.meal_entries
    where user_id = owner_id
      and idempotency_key = p_idempotency_key
      and voided_at is null;
    if entry.id is not null then
      return jsonb_build_object(
        'entry_id', entry.id,
        'meal_id', entry.meal_id,
        'duplicate', true
      );
    end if;
  end if;

  select * into item
  from public.catalog_items
  where id = p_catalog_item_id and user_id = owner_id and active;

  if item.id is null then
    raise exception using errcode = '42501', message = 'catalog item is not owned by user';
  end if;
  if trim(p_quantity_unit) <> item.serving_unit then
    raise exception using errcode = '22023', message = 'quantity unit must match serving unit';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      owner_id::text || ':' || p_meal_date::text || ':' || p_meal_type::text,
      0
    )
  );

  if p_idempotency_key is not null then
    select * into entry
    from public.meal_entries
    where user_id = owner_id
      and idempotency_key = p_idempotency_key
      and voided_at is null;
    if entry.id is not null then
      return jsonb_build_object(
        'entry_id', entry.id,
        'meal_id', entry.meal_id,
        'duplicate', true
      );
    end if;
  end if;

  if p_meal_type = 'custom' then
    insert into public.meals (
      user_id, meal_date, meal_type, state, eaten_at
    )
    values (
      owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at
    )
    returning * into meal;
  else
    select * into meal
    from public.meals
    where user_id = owner_id
      and meal_date = p_meal_date
      and meal_type = p_meal_type
    for update;

    if meal.id is null then
      insert into public.meals (
        user_id, meal_date, meal_type, state, eaten_at
      )
      values (
        owner_id, p_meal_date, p_meal_type, 'recorded', p_eaten_at
      )
      returning * into meal;
    else
      update public.meals
      set state = 'recorded',
          eaten_at = coalesce(p_eaten_at, eaten_at)
      where id = meal.id
      returning * into meal;
    end if;
  end if;

  insert into public.meal_entries (
    meal_id, user_id, catalog_item_id, quantity, quantity_unit, idempotency_key
  )
  values (
    meal.id, owner_id, item.id, p_quantity, trim(p_quantity_unit), p_idempotency_key
  )
  returning * into entry;

  insert into public.meal_entry_nutrient_snapshots (
    meal_entry_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    source_catalog_revision,
    quality,
    source_uri,
    source_observed_at, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    entry.id,
    d.code,
    private.phase8_capture_amount(n.amount,p_quantity,item.serving_size),
    d.unit,
    n.provenance,
    item.revision,
    coalesce(n.quality, 'unknown'),
    n.source_uri,
    n.source_observed_at, n.value_origin, n.definition_basis, n.intake_scope, private.phase8_capture_derivation(n.derivation,n.amount,p_quantity,item.serving_size), n.contains_estimates
  from public.nutrient_definitions d
  left join public.item_nutrients n
    on n.catalog_item_id = item.id
   and n.user_id = owner_id
   and n.nutrient_code = d.code;

  return jsonb_build_object(
    'entry_id', entry.id,
    'meal_id', meal.id,
    'duplicate', false,
    'state', meal.state
  );
end;
$$;

create or replace function public.recalculate_batch_nutrients(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $batch$
declare
  owner_id uuid := (select auth.uid());
  batch public.batches;
  component_count integer;
begin
  select * into batch
  from public.batches
  where catalog_item_id = p_batch_id and user_id = owner_id;

  if batch.catalog_item_id is null then
    raise exception using errcode = '42501', message = 'batch is not owned by user';
  end if;

  select count(*) into component_count
  from public.batch_components
  where batch_id = p_batch_id and user_id = owner_id;

  if component_count = 0 then
    raise exception using errcode = '22023', message = 'batch needs a component';
  end if;

  delete from public.item_nutrients
  where catalog_item_id = p_batch_id and user_id = owner_id;

  insert into public.item_nutrients (
    catalog_item_id,
    user_id,
    nutrient_code,
    amount,
    unit,
    provenance,
    quality, value_origin, definition_basis, intake_scope, derivation, contains_estimates
  )
  select
    p_batch_id,
    owner_id,
    d.code,
    case
      when count(bc.id) = count(n.amount) and bool_and(private.phase8_nutrient_output_compatible(d.code,d.unit,n.unit,n.amount,n.definition_basis,n.source_uri))
        then private.phase8_capture_amount(sum(n.amount * (bc.quantity / c.serving_size)),1,batch.servings)
      else null
    end,
    d.unit,
    'batch_calculation',
    case
      when count(bc.id) <> count(n.amount) or not bool_and(private.phase8_nutrient_output_compatible(d.code,d.unit,n.unit,n.amount,n.definition_basis,n.source_uri)) or (sum(n.amount*(bc.quantity/c.serving_size))>0 and round(sum(n.amount*(bc.quantity/c.serving_size))/batch.servings,6)=0) then 'unknown'
      when bool_or(coalesce(n.quality, 'unknown') = 'unknown') then 'unknown'
      when bool_or(n.quality = 'unverified') then 'unverified'
      else 'user_verified'
    end,
    'calculated',
    case when count(n.definition_basis)=count(bc.id) and count(distinct n.definition_basis)=1 then min(n.definition_basis) else null end,
    case when count(n.intake_scope)=count(bc.id) and count(distinct n.intake_scope)=1 then min(n.intake_scope) else 'unknown' end,
    case when sum(n.amount*(bc.quantity/c.serving_size))>0 and round(sum(n.amount*(bc.quantity/c.serving_size))/batch.servings,6)=0 then jsonb_build_object('method','batch_per_serving','version',1,'reason','below_storage_precision','source_amount',sum(n.amount*(bc.quantity/c.serving_size))::text,'quantity','1','serving_size',batch.servings::text) else jsonb_build_object('method','batch_per_serving','version',1) end,
    case when bool_or(n.contains_estimates or n.value_origin='estimated' or n.provenance='estimated_dish') then true
         when count(n.contains_estimates)=count(bc.id) then false else null end
  from public.nutrient_definitions d
  cross join public.batch_components bc
  join public.catalog_items c
    on c.id = bc.catalog_item_id
   and c.user_id = owner_id
  left join public.item_nutrients n
    on n.catalog_item_id = c.id
   and n.nutrient_code = d.code
   and n.user_id = owner_id
  where bc.batch_id = p_batch_id
    and bc.user_id = owner_id
  group by d.code, d.unit;
end;
$batch$;

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
   and (s.definition_basis is null or ('{"energy":{"unit":"kcal","allowed":["recorded_food_energy"],"incompatible":[]},"protein":{"unit":"g","allowed":["total_protein"],"incompatible":[]},"fat":{"unit":"g","allowed":["total_fat"],"incompatible":[]},"carbohydrate":{"unit":"g","allowed":["total_carbohydrate_including_fiber","jp_label_carbohydrate"],"incompatible":["carbohydrates_excluding_fiber","available_carbohydrate_monosaccharide"]},"fiber":{"unit":"g","allowed":["dietary_fiber","jp_label_dietary_fiber"],"incompatible":[]},"calcium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"iron":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"zinc":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"vitamin_a":{"unit":"ug_rae","allowed":["total_rae","rae"],"incompatible":["iu","retinol_mass","beta_carotene_mass","generic_ug"]},"vitamin_b1":{"unit":"mg","allowed":["thiamine_mass"],"incompatible":["thiamine_hydrochloride_mass"]},"vitamin_b2":{"unit":"mg","allowed":["riboflavin_mass"],"incompatible":[]},"vitamin_b6":{"unit":"mg","allowed":["vitamin_b6_mass"],"incompatible":[]},"vitamin_b12":{"unit":"ug","allowed":["vitamin_b12_mass"],"incompatible":[]},"vitamin_c":{"unit":"mg","allowed":["ascorbic_acid_equivalent"],"incompatible":[]},"vitamin_d":{"unit":"ug","allowed":["vitamin_d_mass"],"incompatible":["iu"]},"vitamin_e":{"unit":"mg","allowed":["alpha_tocopherol"],"incompatible":["iu","alpha_te","total_tocopherol"]},"sodium":{"unit":"mg","allowed":["elemental_sodium","elemental_mass"],"incompatible":[]},"salt_equivalent":{"unit":"g","allowed":["salt_equivalent","salt_equivalent_from_sodium"],"incompatible":[]},"saturated_fat":{"unit":"g","allowed":["total_saturated_fat"],"incompatible":[]},"n3_fatty_acids":{"unit":"g","allowed":["total_n3"],"incompatible":["ala_only","epa_only","dha_only"]},"n6_fatty_acids":{"unit":"g","allowed":["total_n6"],"incompatible":["linoleic_acid_only"]},"cholesterol":{"unit":"mg","allowed":["cholesterol_mass"],"incompatible":[]},"carbohydrate_excluding_fiber":{"unit":"g","allowed":["jp_label_carbohydrate_excluding_fiber","carbohydrates_excluding_fiber"],"incompatible":["sugars","total_sugars","available_carbohydrate_monosaccharide"]},"potassium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"magnesium":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"phosphorus":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"copper":{"unit":"mg","allowed":["elemental_mass"],"incompatible":[]},"selenium":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"molybdenum":{"unit":"ug","allowed":["elemental_mass"],"incompatible":[]},"folate":{"unit":"ug","allowed":["food_folate"],"incompatible":["dfe","folic_acid_only"]}}'::jsonb->d.code->'allowed')?s.definition_basis)
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
   false conflicting_definitions,
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
create or replace function private.register_meal_from_chat_v2(
  p_target_alias text,
  p_request_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target private.chat_registration_targets;
  existing private.chat_registration_receipts;
  payload_hash text;
  meal_json jsonb;
  item_json jsonb;
  nutrient_json jsonb;
  meal_date_value date;
  meal_type_text text;
  meal_type_value public.meal_type;
  eaten_at_text text;
  eaten_at_value timestamptz;
  item_type_text text;
  mapped_item_type public.catalog_item_type;
  item_name text;
  item_brand text;
  serving_size_value numeric;
  serving_unit_value text;
  quantity_value numeric;
  nutrient_code text;
  nutrient_unit text;
  expected_unit text;
  nutrient_provenance text;
  mapped_provenance text;
  mapped_quality text;
  source_uri_value text;
  source_observed_at_value text;
  normalized_nutrients jsonb;
  seen_codes text[];
  item public.catalog_items;
  entry_result jsonb;
  result_items jsonb := '[]'::jsonb;
  result_payload jsonb;
  item_count integer;
  item_index integer;
begin
  if p_target_alias is null
     or p_target_alias !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'invalid target alias';
  end if;
  if p_request_id is null
     or p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.pg_column_size(p_payload) > 131072 then
    raise exception using errcode = '22023', message = 'invalid chat registration payload';
  end if;
  if p_payload->>'schema_version' is distinct from '2'
     or p_payload->>'registration_mode' is distinct from 'direct'
     or p_payload->>'request_id' is distinct from p_request_id::text
     or pg_catalog.jsonb_typeof(p_payload->'meal') <> 'object'
     or pg_catalog.jsonb_typeof(p_payload->'items') <> 'array' then
    raise exception using errcode = '22023', message = 'invalid chat registration contract';
  end if;

  select t.* into target
  from private.chat_registration_targets t
  where t.target_alias = p_target_alias
    and t.enabled;
  if target.target_alias is null then
    raise exception using errcode = 'P0002', message = 'chat registration target not found';
  end if;

  payload_hash := private.phase6_sha256_jsonb(p_payload);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target.user_id::text || ':chat-direct:' || p_request_id::text,
      0
    )
  );

  select r.* into existing
  from private.chat_registration_receipts r
  where r.target_alias = p_target_alias
    and r.request_id = p_request_id;
  if existing.request_id is not null then
    if existing.payload_hash <> payload_hash
       or existing.payload is distinct from p_payload then
      raise exception using
        errcode = '23505',
        message = 'request_id already used with different payload';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('duplicate', true);
  end if;

  meal_json := p_payload->'meal';
  if coalesce(meal_json->>'meal_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = 'invalid meal_date';
  end if;
  meal_date_value := (meal_json->>'meal_date')::date;

  meal_type_text := meal_json->>'meal_type';
  if meal_type_text not in ('breakfast', 'lunch', 'dinner', 'custom') then
    raise exception using errcode = '22023', message = 'invalid meal_type';
  end if;
  meal_type_value := meal_type_text::public.meal_type;

  eaten_at_text := nullif(pg_catalog.btrim(meal_json->>'eaten_at'), '');
  if eaten_at_text is not null then
    if eaten_at_text !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using
        errcode = '22023',
        message = 'eaten_at must include timezone offset';
    end if;
    eaten_at_value := eaten_at_text::timestamptz;
  end if;
  if meal_type_value = 'custom' and eaten_at_value is null then
    raise exception using errcode = '22023', message = 'custom intake requires eaten_at';
  end if;

  item_count := pg_catalog.jsonb_array_length(p_payload->'items');
  if item_count < 1 or item_count > 20 then
    raise exception using
      errcode = '22023',
      message = 'items must contain between 1 and 20 entries';
  end if;

  -- Existing nutrition RPCs already enforce ownership using auth.uid().
  -- Set the transaction-local authenticated identity from the private target
  -- mapping instead of accepting a user UUID from the external caller.
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', target.user_id::text, true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role', 'authenticated', true
  );

  item_index := 0;
  for item_json in
    select value from pg_catalog.jsonb_array_elements(p_payload->'items')
  loop
    item_index := item_index + 1;
    if pg_catalog.jsonb_typeof(item_json) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid item';
    end if;

    item_name := nullif(pg_catalog.btrim(item_json->>'name'), '');
    if item_name is null or pg_catalog.char_length(item_name) > 160 then
      raise exception using errcode = '22023', message = 'invalid item name';
    end if;

    item_brand := nullif(pg_catalog.btrim(item_json->>'brand'), '');
    if item_brand is not null and pg_catalog.char_length(item_brand) > 120 then
      raise exception using errcode = '22023', message = 'invalid item brand';
    end if;

    item_type_text := coalesce(
      nullif(pg_catalog.btrim(item_json->>'item_type'), ''),
      'estimated_dish'
    );
    if item_type_text not in (
      'ingredient', 'product', 'supplement', 'estimated_dish'
    ) then
      raise exception using errcode = '22023', message = 'invalid item_type';
    end if;
    mapped_item_type := case
      when item_type_text = 'ingredient'
        then 'ingredient'::public.catalog_item_type
      else 'estimated_dish'::public.catalog_item_type
    end;

    begin
      serving_size_value := (item_json->>'serving_size')::numeric;
      quantity_value := coalesce(
        (item_json->>'quantity')::numeric,
        serving_size_value
      );
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'invalid serving size or quantity';
    end;

    serving_unit_value := nullif(
      pg_catalog.btrim(item_json->>'serving_unit'),
      ''
    );
    if serving_size_value is null or serving_size_value <= 0
       or quantity_value is null or quantity_value <= 0
       or serving_unit_value is null
       or pg_catalog.char_length(serving_unit_value) > 32 then
      raise exception using
        errcode = '22023',
        message = 'invalid serving size, quantity, or unit';
    end if;

    if item_json ? 'nutrients'
       and pg_catalog.jsonb_typeof(item_json->'nutrients') <> 'array' then
      raise exception using errcode = '22023', message = 'nutrients must be an array';
    end if;
    if pg_catalog.jsonb_array_length(
      coalesce(item_json->'nutrients', '[]'::jsonb)
    ) > 30 then
      raise exception using errcode = '22023', message = 'too many nutrients';
    end if;

    normalized_nutrients := '[]'::jsonb;
    seen_codes := array[]::text[];

    for nutrient_json in
      select value
      from pg_catalog.jsonb_array_elements(
        coalesce(item_json->'nutrients', '[]'::jsonb)
      )
    loop
      if pg_catalog.jsonb_typeof(nutrient_json) <> 'object' then
        raise exception using errcode = '22023', message = 'invalid nutrient';
      end if;

      nutrient_code := nullif(
        pg_catalog.btrim(nutrient_json->>'code'),
        ''
      );
      nutrient_unit := nullif(
        pg_catalog.btrim(nutrient_json->>'unit'),
        ''
      );
      if nutrient_code is null or nutrient_code = any(seen_codes) then
        raise exception using
          errcode = '22023',
          message = 'duplicate or missing nutrient code';
      end if;
      seen_codes := pg_catalog.array_append(seen_codes, nutrient_code);

      select d.unit into expected_unit
      from public.nutrient_definitions d
      where d.code = nutrient_code;
      if expected_unit is null or nutrient_unit is distinct from expected_unit then
        raise exception using
          errcode = '22023',
          message = 'invalid nutrient code or unit';
      end if;

      if nutrient_json->'amount' is not null
         and pg_catalog.jsonb_typeof(nutrient_json->'amount')
           not in ('number', 'null') then
        raise exception using errcode = '22023', message = 'invalid nutrient amount';
      end if;
      if pg_catalog.jsonb_typeof(nutrient_json->'amount') = 'number'
         and (nutrient_json->>'amount')::numeric < 0 then
        raise exception using errcode = '22023', message = 'invalid nutrient amount';
      end if;

      nutrient_provenance := coalesce(
        nullif(pg_catalog.btrim(nutrient_json->>'provenance'), ''),
        'estimated'
      );
      if nutrient_provenance not in (
        'official', 'database', 'label', 'estimated', 'user_reported', 'measured', 'calculated'
      ) then
        raise exception using errcode = '22023', message = 'invalid nutrient provenance';
      end if;

      mapped_provenance := case nutrient_provenance
        when 'official' then 'approved_external_db'
        when 'database' then 'approved_external_db'
        when 'label' then 'product_label'
        when 'estimated' then 'estimated_dish'
        when 'user_reported' then 'user_entered'
        when 'measured' then 'user_entered'
        when 'calculated' then 'user_entered'
      end;
      mapped_quality := case
        when nutrient_provenance = 'estimated' then 'unknown'
        else 'unverified'
      end;

      source_uri_value := nullif(
        pg_catalog.btrim(nutrient_json->>'source_uri'),
        ''
      );
      if source_uri_value is not null
         and (
           pg_catalog.char_length(source_uri_value) > 1000
           or source_uri_value !~ '^https?://'
         ) then
        raise exception using errcode = '22023', message = 'invalid nutrient source_uri';
      end if;

      source_observed_at_value := nullif(
        pg_catalog.btrim(nutrient_json->>'source_observed_at'),
        ''
      );
      if source_observed_at_value is not null then
        perform source_observed_at_value::timestamptz;
      end if;

      normalized_nutrients := normalized_nutrients || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', nutrient_code,
          'amount', nutrient_json->'amount',
          'unit', nutrient_unit,
          'provenance', mapped_provenance,
          'quality', mapped_quality,
          'value_origin', nutrient_provenance, 'definition_basis', nutrient_json->>'definition_basis',
          'intake_scope', nutrient_json->>'intake_scope',
          'derivation', nullif(nutrient_json->'derivation','null'::jsonb),
          'contains_estimates', case when nutrient_provenance='estimated' then true else (nutrient_json->>'contains_estimates')::boolean end,
          'source_uri', source_uri_value,
          'source_observed_at', source_observed_at_value
        )
      );
    end loop;

    -- Commercial chat inputs intentionally do not enter the trusted
    -- JAN/product identity path. They remain estimated_dish catalog rows.
    item := private.phase8_create_catalog_item(
      mapped_item_type,
      item_name,
      item_brand,
      serving_size_value,
      serving_unit_value,
      normalized_nutrients,
      'chat-direct:' || p_request_id::text || ':catalog:' || item_index::text
    );

    entry_result := public.create_meal_entry(
      meal_date_value,
      meal_type_value,
      eaten_at_value,
      item.id,
      quantity_value,
      serving_unit_value,
      'chat-direct:' || p_request_id::text || ':entry:' || item_index::text
    );

    result_items := result_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', item_name,
        'catalog_item_id', item.id,
        'entry_id', entry_result->>'entry_id',
        'meal_id', entry_result->>'meal_id',
        'quantity', quantity_value,
        'quantity_unit', serving_unit_value
      )
    );
  end loop;

  result_payload := pg_catalog.jsonb_build_object(
    'request_id', p_request_id,
    'target_alias', p_target_alias,
    'meal_date', meal_date_value,
    'meal_type', meal_type_text,
    'item_count', item_count,
    'entries', result_items,
    'state', 'recorded',
    'duplicate', false
  );

  insert into private.chat_registration_receipts (
    target_alias,
    request_id,
    user_id,
    payload_hash,
    payload,
    result
  ) values (
    p_target_alias,
    p_request_id,
    target.user_id,
    payload_hash,
    p_payload,
    result_payload
  );

  return result_payload;
end;
$$;
revoke all on function private.register_meal_from_chat_v2(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.register_meal_from_chat_v2(text,uuid,jsonb) to service_role;

reset lock_timeout;
reset statement_timeout;

