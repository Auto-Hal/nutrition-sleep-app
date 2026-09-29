import type { OutboxDrainEvent } from "@/lib/offline/outbox-runtime";

export const OUTBOX_STATE_EVENT = "nutrition-sleep:outbox-state";
export const OUTBOX_DRAIN_EVENT = "nutrition-sleep:outbox-drain";

export function emitOutboxState(detail?: OutboxDrainEvent | { state: "queued"; operation_id: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_STATE_EVENT, { detail }));
}

export function requestOutboxDrain() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OUTBOX_DRAIN_EVENT));
}
