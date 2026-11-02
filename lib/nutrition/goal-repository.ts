import "server-only";
import { createUserClient } from "@/lib/supabase/user";
import type { GoalHistory } from "@/lib/nutrition/goals";
import { parseGoalHistory, parseNutritionPeriod } from "@/lib/nutrition/period";
export async function getGoalHistory(accessToken: string): Promise<GoalHistory> {
  const { data, error } = await createUserClient(accessToken).rpc("get_nutrition_goal_history_v1");
  if (error || !data) throw new Error("目標履歴を取得できませんでした。");
  return parseGoalHistory(data);
}
export async function getNutritionPeriod(accessToken: string, start: string, end: string) {
  const { data, error } = await createUserClient(accessToken).rpc("get_nutrition_goal_period_v1", { p_start_date: start, p_end_date: end });
  if (error || !data) throw new Error("期間の栄養記録を取得できませんでした。");
  return parseNutritionPeriod(data, start, end);
}
