import { ChatNutritionImport } from "@/components/chat-nutrition-import";
import { redirect } from "next/navigation";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { nutritionImportLoginPath } from "@/lib/auth/login-navigation";

export const dynamic = "force-dynamic";

export default async function NutritionImportPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  if (!(await getAppSessionForRsc())) redirect(nutritionImportLoginPath((await searchParams).draft));
  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Import</p>
          <h1>ChatGPTから食事を登録</h1>
          <p className="muted">リンク内の下書きを確認してから、既存の食事記録へ反映します。</p>
        </div>
      </header>
      <ChatNutritionImport />
    </main>
  );
}
