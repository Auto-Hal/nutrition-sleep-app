import { describe, expect, it } from "vitest";
import { harness, settle } from "./helpers/component-harness.mjs";

describe("PWA update recovery", () => {
  it("keeps the installed worker usable after a cancelled update and retries online", async () => {
    const windowEvents = new Map<string, () => void>();
    const documentEvents = new Map<string, () => void>();
    let updates = 0;
    let versionChecks = 0;
    const h = harness({
      "@/lib/offline/outbox-contract": { OUTBOX_CONTRACT_VERSION: 1 },
    });
    Object.assign(h.context.navigator, {
      serviceWorker: {
        register: async () => ({
          update: async () => {
            if (++updates === 2) throw new Error("navigation cancelled update");
          },
        }),
      },
    });
    h.context.window.addEventListener = (name: string, fn: () => void) =>
      windowEvents.set(name, fn);
    h.context.document.addEventListener = (name: string, fn: () => void) =>
      documentEvents.set(name, fn);
    h.context.fetchImpl = async () => {
      versionChecks++;
      return {
        ok: true,
        json: async () => ({
          build_version: "build",
          outbox_contract_version: 1,
        }),
      };
    };
    const { PwaRuntime } = h.load("components/pwa-runtime.tsx");
    const render = () => h.render(PwaRuntime, { initialBuildVersion: "build" });
    render();
    h.effects[0]();
    await settle();
    expect(updates).toBe(1);
    h.context.navigator.onLine = false;
    documentEvents.get("visibilitychange")!();
    await settle();
    expect(updates).toBe(1);
    h.context.navigator.onLine = true;
    windowEvents.get("online")!();
    await settle();
    expect(updates).toBe(2);
    expect(render()).toBeNull();
    windowEvents.get("online")!();
    await settle();
    expect(updates).toBe(3);
    expect(versionChecks).toBe(3);
    expect(render()).toBeNull();
  });
});
