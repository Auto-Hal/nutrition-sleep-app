import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const sw = read("public/sw.js");
const offline = read("public/offline.html");
const runtime = read("components/pwa-runtime.tsx");
const connectivity = read("components/connectivity-boundary.tsx");
const outboxRuntime = read("components/outbox-runtime.tsx");
const outboxIdb = read("lib/offline/outbox-idb.ts");
const versionRoute = read("app/api/app-version/route.ts");
const nextConfig = read("next.config.ts");
const rootLayout = read("app/layout.tsx");

describe("Phase 6.10 PWA shell and version recovery", () => {
  it("caches only the static shell and immutable Next static assets", () => {
    expect(sw).toContain("const STATIC_SHELL = [");
    expect(sw).toContain("/offline.html");
    expect(sw).toContain("/manifest.webmanifest");
    expect(sw).toContain("/icon.svg");
    expect(sw).toContain('pathname.startsWith("/_next/static/")');
  });

  it("never caches authenticated navigation or API responses as current health state", () => {
    expect(sw).toContain("/api/");
    expect(sw).toContain("/auth/");
    expect(sw).toContain('if (request.mode === "navigate")');
    expect(sw).toContain('fetch(request, { cache: "no-store" })');
    expect(sw).toContain("caches.match(OFFLINE_URL)");
    expect(sw).not.toContain("cache.put(request, response.clone());\n      } catch");
  });

  it("updates only shell caches and never clears IndexedDB during a static update", () => {
    expect(sw).toContain("key.startsWith(CACHE_PREFIX)");
    expect(sw).not.toContain("indexedDB");
    expect(runtime).not.toContain("clearOutboxStorage");
    expect(runtime).toContain("window.location.reload()");
    expect(outboxIdb).toContain("unsupported_contract_version");
    expect(outboxIdb).toContain('status: "blocked"');
  });

  it("checks deployment and outbox versions through a no-store endpoint", () => {
    expect(rootLayout).toContain("<PwaRuntime");
    expect(runtime).toContain("/sw.js?v=");
    expect(runtime).toContain('fetch("/api/app-version"');
    expect(runtime).toContain('cache: "no-store"');
    expect(versionRoute).toContain('"cache-control": "no-store, max-age=0"');
    expect(runtime).toContain("OUTBOX_CONTRACT_VERSION");
  });

  it("surfaces incompatible pending intent instead of silently dropping it", () => {
    expect(outboxRuntime).toContain("unsupported_contract_version");
    expect(outboxRuntime).toContain("自動変換や削除はせず、この端末に保持しています");
    expect(outboxRuntime).toContain("listOutboxMutations(binding)");
  });

  it("does not present stale authenticated health UI as current while offline", () => {
    expect(connectivity).toContain("以前表示していたサーバーデータは現在の状態として表示しません");
    expect(connectivity).toContain("countUnsyncedOutbox(binding)");
    expect(offline).toContain("認証済みの画面やAPI結果をキャッシュから現在値として表示することはありません");
  });

  it("cold-start offline shell inspects only local outbox state without rendering payload contents", () => {
    expect(offline).toContain('indexedDB.open("nutrition-sleep-outbox")');
    expect(offline).toContain('objectStore("mutations")');
    expect(offline).toContain("unresolved.length");
    expect(offline).not.toContain("row.payload");
    expect(offline).not.toContain("owner_user_id");
    expect(offline).not.toContain("environment_id");
  });

  it("forces service-worker script revalidation", () => {
    expect(nextConfig).toContain('source: "/sw.js"');
    expect(nextConfig).toContain("no-cache, no-store, must-revalidate");
    expect(nextConfig).toContain("Service-Worker-Allowed");
  });

  it("reconstructs cached offline navigation as a final non-redirected response for iOS PWA", () => {
    expect(sw).toContain("async function asFinalResponse(response)");
    expect(sw).toContain("new Response(await response.clone().blob()");
    expect(sw).toContain('headers.delete("location")');
    expect(sw).toContain("return asFinalResponse(cached)");
    expect(sw).toContain('credentials: "same-origin"');
    expect(sw).not.toContain("return (await caches.match(OFFLINE_URL))");
  });

});
