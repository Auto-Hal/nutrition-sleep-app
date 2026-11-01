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
import type { BodyProgress } from "@/lib/body/model";
import { nutritionPeriodFixture } from "./helpers/nutrition-period-fixture";
const body = (): BodyProgress => ({
  schema_version: 1,
  as_of: "2026-11-01T00:00:00Z",
  time_zone: "Asia/Tokyo",
  range: 30,
  start_date: "2026-10-03",
  end_date: "2026-11-01",
  measurements: [],
  profile_candidates: [],
  latest_reference: [],
  profile: {
    revision: 1,
    weight_kg: "70",
    weight_updated_on: "2026-10-20",
    weight_measurement_id: null,
    time_zone: "Asia/Tokyo",
  },
  settings: {
    revision: 0,
    target_weight_kg: null,
    target_pace_kg_per_week: null,
    weight_sync_mode: "profile_only",
  },
});
const binding = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  environmentId: "synthetic",
};
function setup(initial = body()) {
  const queued: PendingMutation[] = [];
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
      emitOutboxState() {},
      requestOutboxDrain() {},
    },
  });
  h.context.fetchImpl = async () => ({
    ok: true,
    json: async () => ({ progress: initial }),
  });
  const { BodyTracker } = h.load("components/body-tracker.tsx");
  const render = () =>
    h.render(BodyTracker, {
      initial,
      binding,
      nutrition: nutritionPeriodFixture(initial.start_date, initial.end_date),
    });
  return { h, render, queued };
}
describe("Body input integrity", () => {
  it("only imports a profile value after an explicit copy and save, preserving the date/source", async () => {
    const { h, render, queued } = setup();
    let tree = render();
    h.effects[0]();
    await settle();
    tree = render();
    expect(queued).toHaveLength(0);
    nodes(tree)
      .find(
        (n) =>
          n?.type === "button" &&
          textOf(n).includes("プロフィールの体重・計測日を確認"),
      )!
      .props.onClick();
    tree = render();
    expect(queued).toHaveLength(0);
    const form = nodes(tree).find((n) => n?.props?.id === "body-entry-form")!;
    await form.props.onSubmit({ preventDefault() {} });
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe("body_measurement_create");
    expect(queued[0].payload).toMatchObject({
      expected_profile_revision: 1,
      measurement: {
        measured_on: "2026-10-20",
        weight_kg: "70",
        body_fat_percent: null,
        measured_at: null,
        source: "user_confirmed_profile",
      },
    });
    expect(textOf(render())).toContain("未同期");
  });
  it("shows the concrete fallback and requires a separate delete action, with no deleted health values in the mutation", async () => {
    const initial = body();
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      revision: 1,
      measured_on: "2026-10-30",
      weight_kg: "72",
      body_fat_percent: null,
      measured_at: null,
      time_zone: "Asia/Tokyo",
      source: "manual" as const,
    };
    const older = {
      ...row,
      id: "44444444-4444-4444-8444-444444444444",
      measured_on: "2026-10-20",
      weight_kg: "71",
    };
    initial.measurements = [older, row];
    initial.profile_candidates = [row, older];
    initial.latest_reference = [row, older].map(({ id, revision }) => ({
      id,
      revision,
    }));
    initial.settings.weight_sync_mode = "latest_measurement";
    initial.settings.revision = 1;
    initial.profile!.weight_kg = row.weight_kg;
    initial.profile!.weight_measurement_id = row.id;
    const { h, render, queued } = setup(initial);
    render();
    h.effects[0]();
    await settle();
    let tree = render();
    nodes(tree)
      .find((n) => n?.props?.["aria-label"] === "2026-10-30の計測を削除")!
      .props.onClick();
    tree = render();
    expect(textOf(tree)).toContain("2026-10-20・71 kg");
    expect(queued).toHaveLength(0);
    await nodes(tree)
      .find((n) => n?.type === "button" && textOf(n) === "この計測を削除する")!
      .props.onClick();
    expect(queued[0].kind).toBe("body_measurement_delete");
    expect(queued[0].payload).toMatchObject({
      measurement_id: row.id,
      expected_settings_revision: 1,
      expected_profile_revision: 1,
      measurement: { expected_latest_reference: initial.latest_reference },
    });
    expect(JSON.stringify(queued[0].payload)).not.toContain("weight_kg");
  });
});
