import "server-only";
import { createUserClient } from "@/lib/supabase/user";
import type { GoalHistory } from "@/lib/nutrition/goals";
export async function getGoalHistory(accessToken: string): Promise<GoalHistory> {
  const { data, error } = await createUserClient(accessToken).rpc("get_nutrition_goal_history_v1");
  if (error || !data) throw new Error("目標履歴を取得できませんでした。");
  return data as GoalHistory;
}
