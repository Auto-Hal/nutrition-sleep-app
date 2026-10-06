import type { ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";
import { chatNutritionDraftSchema } from "@/lib/nutrition/chat-import-contract";
import { createUserClient } from "@/lib/supabase/user";

export type ChatMealDraftRecord = {
  id: string;
  request_id: string;
  status: "pending" | "consumed" | "dismissed";
  payload: ChatNutritionDraft;
  created_at: string;
  updated_at: string;
};

function normalizeRecord(value: Record<string, unknown>): ChatMealDraftRecord {
  return {
    id: String(value.id),
    request_id: String(value.request_id),
    status: value.status as ChatMealDraftRecord["status"],
    payload: chatNutritionDraftSchema.parse(value.payload),
    created_at: String(value.created_at),
    updated_at: String(value.updated_at),
  };
}

export async function getPendingChatMealDrafts(accessToken: string, limit = 10) {
  const client = createUserClient(accessToken);
  const { data, error } = await client
    .from("chat_meal_drafts")
    .select("id,request_id,status,payload,created_at,updated_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => normalizeRecord(row as Record<string, unknown>));
}

export async function getChatMealDraft(accessToken: string, draftId: string) {
  const client = createUserClient(accessToken);
  const { data, error } = await client
    .from("chat_meal_drafts")
    .select("id,request_id,status,payload,created_at,updated_at")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeRecord(data as Record<string, unknown>) : null;
}
