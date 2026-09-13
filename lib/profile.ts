import { createUserClient } from "@/lib/supabase/user";

export async function getProfile(accessToken: string) {
  const result = await createUserClient(accessToken).from("user_profiles").select("user_id,birth_date,sex,height_cm,weight_kg,weight_updated_on,activity_level,nutrition_goal_note,time_zone,revision").maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
