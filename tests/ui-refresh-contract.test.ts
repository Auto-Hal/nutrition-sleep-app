import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("app UI refresh", () => {
  it("keeps ChatGPT registration as a primary Today action", () => {
    const today = read("app/(app)/today/page.tsx");
    const chat = read("components/chatgpt-nutrition-link.tsx");
    expect(today.indexOf("<ChatGptNutritionLink />")).toBeLessThan(today.indexOf("<TodayInteractive"));
    expect(chat).toContain("ChatGPTで食事を登録");
    expect(chat).toContain("chatgpt-primary");
  });

  it("moves explanatory nutrition copy behind progressive disclosure", () => {
    const todayInteractive = read("components/today-interactive.tsx");
    const today = read("app/(app)/today/page.tsx");
    expect(todayInteractive).toContain('<details className="inline-help">');
    expect(todayInteractive).toContain("未登録の栄養値は0として扱わず");
    expect(today).not.toContain("記録がない日は、摂取量を0として扱いません");
  });

  it("simplifies Settings while preserving advanced and destructive actions", () => {
    const settings = read("app/(app)/settings/page.tsx");
    const profile = read("components/profile-form.tsx");
    const deletion = read("components/account-deletion.tsx");
    const styles = read("app/ui-refresh.css");
    expect(settings).toContain("プロフィール");
    expect(settings).toContain("ライブラリ");
    expect(settings).not.toContain("Google Healthを含むデータの利用目的");
    expect(profile).toContain("基本情報");
    expect(profile).toContain("その他の設定");
    expect(profile).toContain("profile-savebar");
    expect(deletion).toContain("削除手続きを開く");
    expect(deletion).toContain("アカウントを削除");
    expect(styles).toContain('a[href*="yahoo.co.jp"]');
  });

  it("keeps nutrition detail while reducing always-visible explanation", () => {
    const nutrition = read("app/(app)/nutrition/page.tsx");
    const review = read("components/nutrition-review.tsx");
    expect(nutrition).toContain("compact-nutrient-list");
    expect(nutrition).toContain("平均の詳細");
    expect(nutrition).toContain("source-details");
    expect(nutrition).toContain("栄養評価の見方");
    expect(review).toContain("優先して見る");
    expect(review).toContain("根拠を見る");
  });

  it("keeps sleep sync and analytics while removing the long Google Health notice", () => {
    const sleep = read("app/(app)/sleep/page.tsx");
    expect(sleep).toContain("sleep-summary-card");
    expect(sleep).toContain("睡眠ステージ");
    expect(sleep).toContain("日別");
    expect(sleep).toContain("/api/health/google/sync");
    expect(sleep).toContain("/api/health/google/disconnect");
    expect(sleep).not.toContain("Google Healthの睡眠データ利用について");
    expect(sleep).not.toContain("広告配信・データ販売・マーケティング目的");
  });
});