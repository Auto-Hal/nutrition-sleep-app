import { test, expect } from "@playwright/test";

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "栄養・睡眠管理" })).toBeVisible();
});

test("login shell exposes a code entry only after requesting one", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("メールの6桁コード")).toHaveCount(0);
});
