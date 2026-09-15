import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const mealType = z.enum(["breakfast", "lunch", "dinner", "custom"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  meal_date: dateSchema, meal_type: mealType, eaten_at: z.string().datetime().nullable().optional(), catalog_item_id: z.string().uuid(),
  quantity: z.number().finite().positive(), quantity_unit: z.string().trim().min(1).max(32), idempotency_key: z.string().trim().min(1).max(128).optional(),
});

export const dynamic = "force-dynamic";

function todayInJapan() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date") ?? todayInJapan();
  if (!dateSchema.safeParse(date).success) return NextResponse.json({ error: "日付を確認してください。" }, { status: 400 });
  const client = createUserClient(session.accessToken);
  const { data: meals, error } = await client.from("meals").select("id,meal_date,meal_type,state,eaten_at,revision").eq("meal_date", date).order("meal_type");
  if (error) return NextResponse.json({ error: "食事記録を取得できませんでした。" }, { status: 500 });
  const mealIds = (meals ?? []).map((meal) => meal.id);
  const { data: entries } = mealIds.length === 0 ? { data: [] as Array<Record<string, unknown>> } : await client.from("meal_entries").select("id,meal_id,catalog_item_id,quantity,quantity_unit,voided_at,catalog_items(name,item_type)").in("meal_id", mealIds).is("voided_at", null).order("created_at");
  const items = (entries ?? []).map((entry) => {
    const catalog = Array.isArray(entry.catalog_items) ? entry.catalog_items[0] : entry.catalog_items;
    return { id: entry.id, meal_id: entry.meal_id, catalog_item_id: entry.catalog_item_id, name: (catalog as { name?: string } | null)?.name ?? "項目", item_type: (catalog as { item_type?: string } | null)?.item_type ?? "ingredient", quantity: entry.quantity, quantity_unit: entry.quantity_unit, voided_at: entry.voided_at };
  });
  return NextResponse.json({ date, meals: (meals ?? []).map((meal) => ({ ...meal, entries: items.filter((entry) => entry.meal_id === meal.id) })) });
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  const session = await getAppSession();
  const authCompletedAt = performance.now();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  if (parsed.data.meal_type === "custom" && !parsed.data.eaten_at) return NextResponse.json({ error: "間食などの追加には時刻が必要です。" }, { status: 400 });
  const result = await createUserClient(session.accessToken).rpc("create_meal_entry", {
    p_meal_date: parsed.data.meal_date, p_meal_type: parsed.data.meal_type, p_eaten_at: parsed.data.eaten_at ?? new Date().toISOString(),
    p_catalog_item_id: parsed.data.catalog_item_id, p_quantity: parsed.data.quantity, p_quantity_unit: parsed.data.quantity_unit,
    p_idempotency_key: parsed.data.idempotency_key ?? null,
  });
  const rpcCompletedAt = performance.now();
  console.info("[perf] meal-write", {
    auth_ms: Math.round(authCompletedAt - startedAt),
    rpc_ms: Math.round(rpcCompletedAt - authCompletedAt),
    total_ms: Math.round(rpcCompletedAt - startedAt),
  });
  if (result.error) return NextResponse.json({ error: "食事記録を保存できませんでした。" }, { status: result.error.code === "23505" ? 409 : 400 });

  return NextResponse.json({ result: result.data }, { status: 201 });
}
