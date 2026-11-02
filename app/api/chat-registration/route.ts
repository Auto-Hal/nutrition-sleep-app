import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { chatNutritionDraftSchema } from "@/lib/nutrition/chat-import-contract";
import { catalogPayloadFromChatDraft, mealPayloadFromChatDraft } from "@/lib/nutrition/chat-import-application";
import { isIsoDate } from "@/lib/nutrition/meal-history";
import { reliableMutationError } from "@/lib/offline/reliable-api";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";

const schema = z.object({
  operation_id: z.string().uuid(), intent_created_at: z.string().datetime(), draft: chatNutritionDraftSchema,
  meal: z.object({ mealDate: z.string().refine(isIsoDate), mealType: z.enum(["breakfast", "lunch", "dinner", "custom"]), eatenAt: z.string().datetime(), quantity: z.number().finite().positive() }).strict(),
}).strict();

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "登録内容を確認してください。" }, { status: 422 });
  try {
    const d = parsed.data;
    const catalog = catalogPayloadFromChatDraft(d.draft);
    const meal = mealPayloadFromChatDraft(d.draft, d.operation_id, d.meal);
    const { data, error } = await createUserClient(session.accessToken).rpc("confirm_chat_meal_v2", { p_operation_id: d.operation_id, p_intent_created_at: d.intent_created_at, p_payload: { catalog, meal } });
    if (error) return reliableMutationError(error, "食事登録を確認できませんでした。同じ内容で再試行できます。");
    return NextResponse.json({ result: data });
  } catch {
    return NextResponse.json({ error: "栄養素の単位と登録内容を確認してください。" }, { status: 422 });
  }
}
