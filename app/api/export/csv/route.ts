import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { isAllowedOrigin } from "@/lib/security/request";
import { createUserClient } from "@/lib/supabase/user";
import {
  csvRequestSchema,
  nutritionCsv,
  parseCsvSource,
} from "@/lib/nutrition/csv";
export async function POST(request: Request) {
  if (!isAllowedOrigin(request))
    return NextResponse.json(
      { error: "許可されていないリクエストです。" },
      { status: 403 },
    );
  const session = await getAppSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = csvRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "日付と粒度を確認し、期間を366日以内で指定してください。" },
      { status: 422 },
    );
  const d = parsed.data;
  const { data, error } = await createUserClient(session.accessToken).rpc(
    "get_nutrition_csv_source_v1",
    { p_start_date: d.start_date, p_end_date: d.end_date },
  );
  if (error)
    return NextResponse.json(
      {
        error:
          "指定期間の同期済みデータを取得できませんでした。未来の日付を含めず、期間を確認してください。",
      },
      { status: error.code === "PT422" ? 422 : 503 },
    );
  try {
    const csv = nutritionCsv(parseCsvSource(data, d.start_date, d.end_date), d);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="nutrition-${d.granularity}-${d.start_date}-${d.end_date}.csv"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "CSVの完全性を確認できませんでした。再取得してください。" },
      { status: 503 },
    );
  }
}
