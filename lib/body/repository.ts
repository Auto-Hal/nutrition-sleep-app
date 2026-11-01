import "server-only";
import { createUserClient } from "@/lib/supabase/user";
import { parseBodyProgress } from "@/lib/body/model";
export async function getBodyProgress(accessToken: string, range: 30 | 90, end: string | null = null) {
  const { data, error } = await createUserClient(accessToken).rpc("get_body_progress_v1", { p_range: range, p_end_date: end });
  if (error || !data) throw new Error("体重履歴を取得できませんでした。");
  return parseBodyProgress(data);
}
