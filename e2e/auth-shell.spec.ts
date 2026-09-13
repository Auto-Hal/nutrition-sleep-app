import { test, expect } from "@playwright/test";

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "栄養・睡眠管理" })).toBeVisible();
});

test("login shell exposes an email and password form", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByLabel("パスワード")).toBeVisible();
  await expect(page.getByText("ワンタイムコード")).toHaveCount(0);
});

test("legacy OTP endpoints are not registered", async ({ request }) => {
  for (const path of ["/api/auth/request-otp", "/api/auth/verify-otp"]) {
    const response = await request.post(path, { data: {} });
    expect(response.status()).toBe(404);
  }
});
