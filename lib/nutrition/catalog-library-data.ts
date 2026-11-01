import "server-only";
import { createUserClient } from "@/lib/supabase/user";
import { parseCatalogLibrary } from "@/lib/nutrition/catalog-library-contract";
export async function getCatalogLibrary(
  accessToken: string,
  includeInactive = false,
) {
  const { data, error } = await createUserClient(accessToken).rpc(
    "get_catalog_library_v1",
    { p_include_inactive: includeInactive },
  );
  if (error)
    throw new Error("食品を完全に読み込めませんでした。再取得してください。");
  return parseCatalogLibrary(data);
}
