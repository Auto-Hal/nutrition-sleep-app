import { describe, expect, it } from "vitest";
import {
  harness,
  nodes,
  textOf,
  settle,
} from "./helpers/component-harness.mjs";
import {
  createOutboxMutation,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import { transferFixture } from "./helpers/transfer-fixture";
function setup(prepared = true) {
  const t = transferFixture(),
    queued: PendingMutation[] = [],
    http: Array<{ url: string; init?: { body?: string } }> = [];
  let shares = 0,
    revoked = 0;
  const h = harness({
    "@/lib/offline/outbox-contract": { createOutboxMutation },
    "@/lib/offline/outbox-idb": {
      listOutboxMutations: async () => queued,
      putOutboxMutation: async (m: PendingMutation) => {
        queued.push(m);
      },
    },
    "@/lib/offline/outbox-events": {
      OUTBOX_STATE_EVENT: "outbox",
      requestOutboxDrain() {},
      emitOutboxState() {},
    },
    "@/lib/karomiru/render": {
      renderTransferPng: async () => ({
        blob: new Blob(["synthetic-png"], { type: "image/png" }),
        width: 1200,
        height: 1046,
      }),
    },
  });
  h.context.URL = {
    createObjectURL: () => "blob:synthetic-private",
    revokeObjectURL: () => revoked++,
  };
  h.context.File = File;
  h.context.navigator = {
    onLine: true,
    canShare: () => true,
    share: async () => {
      shares++;
    },
    clipboard: { writeText: async () => {} },
  };
  h.context.fetchImpl = async (url: string, init?: { body?: string }) => {
    http.push({ url, init });
    return { ok: true, json: async () => ({ transfer: t }) };
  };
  const { KaromiruTransfer } = h.load("components/karomiru-transfer.tsx");
  const render = () =>
    h.render(KaromiruTransfer, {
      initial: t.fixed_payload,
      initialPrepared: prepared ? t : null,
      initialRecent: { recent: [], has_more: false },
      binding: { ownerUserId: t.id, environmentId: "synthetic" },
    });
  return {
    h,
    render,
    queued,
    http,
    t,
    shares: () => shares,
    revoked: () => revoked,
  };
}
describe("manual external registration acknowledgement", () => {
  it("saving/sharing/copying cannot confirm an external registration", async () => {
    const s = setup();
    s.render();
    s.h.effects[0]();
    s.h.effects[1]();
    await settle();
    let tree = s.render();
    expect(
      nodes(tree).find((n) => n?.type === "a" && n.props.download)?.props.href,
    ).toBe("blob:synthetic-private");
    await nodes(tree)
      .find((n) => n?.type === "button" && textOf(n) === "iOS共有シートで共有")!
      .props.onClick();
    await nodes(tree)
      .find((n) => n?.type === "button" && textOf(n) === "メニュー名をコピー")!
      .props.onClick();
    expect(s.shares()).toBe(1);
    expect(s.queued).toHaveLength(0);
    expect(s.http).toHaveLength(0);
    tree = s.render();
    expect(textOf(tree)).toContain("外部登録は未確認");
    await nodes(tree)
      .find(
        (n) =>
          n?.type === "button" && textOf(n) === "カロミルで登録内容を確認した",
      )!
      .props.onClick();
    expect(s.queued).toHaveLength(1);
    expect(s.queued[0].kind).toBe("karomiru_status");
    expect(s.queued[0].payload).toEqual({
      transfer_id: s.t.id,
      status: "confirmed",
    });
    expect(JSON.stringify(s.queued[0])).not.toContain("synthetic-png");
  });
  it("hides the old PNG and its confirmation when mode/name/quantity changes, and releases the private Blob URL", async () => {
    const s = setup();
    s.render();
    s.h.effects[0]();
    const cleanup = s.h.effects[1]();
    await settle();
    let tree = s.render();
    expect(nodes(tree).some((n) => n?.type === "img")).toBe(true);
    nodes(tree)
      .find((n) => n?.props?.id === "transfer-mode")!
      .props.onChange({ target: { value: "all29" } });
    tree = s.render();
    expect(nodes(tree).some((n) => n?.type === "img")).toBe(false);
    expect(textOf(tree)).not.toContain("カロミルで登録内容を確認した");
    if (typeof cleanup === "function") cleanup();
    expect(s.revoked()).toBe(1);
  });
  it("retries the identical prepare intent after an uncertain HTTP result", async () => {
    const s = setup(false);
    s.render();
    s.h.effects[0]();
    await settle();
    let count = 0;
    s.h.context.fetchImpl = async (url: string, init: { body: string }) => {
      s.http.push({ url, init });
      count++;
      return {
        ok: count > 1,
        json: async () =>
          count > 1 ? { transfer: s.t } : { error: "合成ネットワーク障害" },
      };
    };
    let tree = s.render();
    nodes(tree)
      .find(
        (n) => n?.type === "button" && textOf(n) === "PNGを準備・プレビュー",
      )!
      .props.onClick();
    await settle();
    tree = s.render();
    nodes(tree)
      .find(
        (n) => n?.type === "button" && textOf(n) === "PNGを準備・プレビュー",
      )!
      .props.onClick();
    await settle();
    expect(s.http).toHaveLength(2);
    expect(s.http[0].init!.body).toBe(s.http[1].init!.body);
    expect(s.queued).toHaveLength(0);
  });
});
