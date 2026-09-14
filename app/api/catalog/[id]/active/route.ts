import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/user";
import { isAllowedOrigin } from "@/lib/security/request";

const schema = z.object({
  expected_revision: z.number().int().positive(),
  active: z.boolean(),
});

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "許可されていないリクエストです。" }, { status: 403 });
  }

  const session = await getAppSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "項目IDを確認してください。" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  }

  const result = await createUserClient(session.accessToken).rpc("set_catalog_item_active", {
    p_catalog_item_id: id,
    p_expected_revision: parsed.data.expected_revision,
    p_active: parsed.data.active,
  });

  if (result.error) {
    return NextResponse.json(
      { error: result.error.code === "40001" ? "別の端末で更新されています。再読み込みしてください。" : "状態を更新できませんでした。" },
      { status: result.error.code === "40001" ? 409 : 400 },
    );
  }

  return NextResponse.json({ item: result.data });
}
