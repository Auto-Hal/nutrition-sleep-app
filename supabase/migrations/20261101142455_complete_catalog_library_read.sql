-- One RLS-scoped statement, unaffected by PostgREST's row limit on table reads.
create function public.get_catalog_library_v1(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare owner_id uuid:=(select auth.uid()); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege using message='authentication required'; end if;
 with owned as materialized (
  select c.* from public.catalog_items c where c.user_id=owner_id and (p_include_inactive or c.active)
 ), nutrients as materialized (
  select n.* from public.item_nutrients n join owned c on c.id=n.catalog_item_id where n.user_id=owner_id
 ), fingerprints as materialized (select * from public.list_catalog_reference_fingerprints_v3()),
 item_rows as materialized (
  select c.id,c.updated_at,to_jsonb(c)||jsonb_build_object(
    'reference_fingerprint',(select f.reference_fingerprint from fingerprints f where f.catalog_item_id=c.id),
    'nutrients',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('code',n.nutrient_code) order by n.nutrient_code) from nutrients n where n.catalog_item_id=c.id),'[]'::jsonb),
    'product',(select to_jsonb(p) from public.products p where p.catalog_item_id=c.id and p.user_id=owner_id)
  ) payload from owned c
 ), batch_rows as materialized (
  select c.id,c.updated_at,to_jsonb(c)||jsonb_build_object(
   'batch',(select to_jsonb(b) from public.batches b where b.catalog_item_id=c.id and b.user_id=owner_id),
   'components',coalesce((select jsonb_agg(to_jsonb(bc) order by bc.position,bc.catalog_item_id) from public.batch_components bc where bc.batch_id=c.id and bc.user_id=owner_id),'[]'::jsonb)
  ) payload from owned c where c.item_type='batch'
 )
 select jsonb_build_object('schema_version',1,'as_of',statement_timestamp(),
  'items',coalesce((select jsonb_agg(payload order by updated_at desc,id) from item_rows),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(payload order by updated_at desc,id) from batch_rows),'[]'::jsonb),
  'counts',jsonb_build_object('items',(select count(*) from owned),'nutrients',(select count(*) from nutrients),'batches',(select count(*) from batch_rows))) into result;
 return result;
end $$;
revoke all on function public.get_catalog_library_v1(boolean) from public,anon;
grant execute on function public.get_catalog_library_v1(boolean) to authenticated;
