import { afterEach, describe, expect, it, vi } from "vitest";
import { harness, nodeOf } from "./helpers/component-harness.mjs";

vi.mock("server-only", () => ({}));
import { nutritionImportLoginPath, safeLoginNextPath } from "@/lib/auth/login-navigation";

const draftId = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.restoreAllMocks());

describe("login continuation", () => {
  it("keeps an inbox draft across the owner login boundary", () => {
    const destination = `/nutrition-import?draft=${draftId}`;
    const login = new URL(nutritionImportLoginPath(draftId), "https://app.test");
    expect(safeLoginNextPath(login.searchParams.get("next"))).toBe(destination);
    expect(safeLoginNextPath("/nutrition-import")).toBe("/nutrition-import");
  });
  it("preserves OAuth consent without allowing arbitrary login redirects", () => {
    expect(safeLoginNextPath("/oauth/consent?authorization_id=synthetic")).toBe("/oauth/consent?authorization_id=synthetic");
    expect(safeLoginNextPath(["/nutrition-import", "/today"])).toBeNull();
    expect(safeLoginNextPath("/nutrition-import?draft=" + "a".repeat(3000))).toBeNull();
    for (const unsafe of ["https://evil.test/nutrition-import", "//evil.test/nutrition-import", "/\\evil.test/nutrition-import", "/api/account/delete", "/nutrition-import?draft=bad", `/nutrition-import?draft=${draftId}&draft=${draftId}`, "/nutrition-import?next=https://evil.test", "/nutrition-import#data=private"]) {
      expect(safeLoginNextPath(unsafe), unsafe).toBeNull();
    }
  });
  it.each([
    [null, "", "/today"],
    [`/nutrition-import?draft=${draftId}`, "", `/nutrition-import?draft=${draftId}`],
    ["/nutrition-import", "#data=valid", "/nutrition-import#data=valid"],
    ["/oauth/consent?authorization_id=synthetic", "#data=valid", "/oauth/consent?authorization_id=synthetic"],
  ])("loads a fresh authenticated document after login (%s)", async (nextPath, hash, destination) => {
    const replace = vi.fn();
    const h = harness({ "@/lib/nutrition/chat-import-link": { chatNutritionImportReturnPath: (value: string) => value === "#data=valid" ? "/nutrition-import#data=valid" : null } });
    h.context.window.location.hash = hash;
    h.context.window.location.replace = replace;
    h.context.fetchImpl = async () => ({ ok: true, json: async () => ({}) });
    const { LoginForm } = h.load("components/login-form.tsx");
    const tree = h.render(LoginForm, { nextPath });
    await nodeOf(tree, "form").props.onSubmit({ preventDefault() {} });
    expect(replace).toHaveBeenCalledExactlyOnceWith(destination);
  });
});

describe("external record refresh", () => {
  function fixture() {
    const refresh = vi.fn();
    const router = { refresh };
    const h = harness({ "next/navigation": { useRouter: () => router } });
    const events = new Map<string, (event?: unknown) => void>();
    h.context.window.addEventListener = (name: string, listener: (event?: unknown) => void) => events.set(name, listener);
    h.context.window.removeEventListener = (name: string) => events.delete(name);
    h.context.document.addEventListener = h.context.window.addEventListener;
    h.context.document.removeEventListener = h.context.window.removeEventListener;
    const { RecordRefresh } = h.load("components/record-refresh.tsx");
    const tree = h.render(RecordRefresh, {});
    const cleanup = h.effects[0]();
    return { h, tree, events, refresh, cleanup };
  }
  it("re-reads after returning from ChatGPT and coalesces focus/visibility duplicates", () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = fixture();
    f.events.get("focus")!();
    f.events.get("visibilitychange")!();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    now += 1500; // A quick second registration must not wait thirty seconds.
    f.events.get("focus")!();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    if (typeof f.cleanup === "function") f.cleanup();
    expect(f.events.size).toBe(0);
  });
  it("retries on reconnect/BFCache restore without writing or refreshing a hidden page", () => {
    const f = fixture();
    f.h.context.document.visibilityState = "hidden";
    f.events.get("focus")!();
    expect(f.refresh).not.toHaveBeenCalled();
    f.h.context.document.visibilityState = "visible";
    f.h.context.navigator.onLine = false;
    f.events.get("focus")!();
    expect(f.refresh).not.toHaveBeenCalled();
    f.h.context.navigator.onLine = true;
    f.events.get("online")!();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    const restored = fixture();
    restored.events.get("pageshow")!({ persisted: false });
    expect(restored.refresh).not.toHaveBeenCalled();
    restored.events.get("pageshow")!({ persisted: true });
    expect(restored.refresh).toHaveBeenCalledTimes(1);
  });
  it("lets the viewer explicitly re-read records", () => {
    const f = fixture();
    nodeOf(f.tree, "button").props.onClick();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(nodeOf(f.tree, "button").props.type).toBe("button");
  });
});
