"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createOutboxMutation,
  type OutboxBinding,
  type PendingMutation,
} from "@/lib/offline/outbox-contract";
import {
  deleteOutboxMutation,
  listOutboxMutations,
  putOutboxMutation,
} from "@/lib/offline/outbox-idb";
import { requestOutboxDrain } from "@/lib/offline/outbox-events";
import { normalizeProfileOutboxPayload } from "@/lib/profile-recovery";

type ProfileMutation = Extract<PendingMutation, { kind: "profile_upsert" }>;

type ServerProfile = {
  revision: number;
} | null;

type RecoveryState = {
  mutation: ProfileMutation;
  serverRevision: number;
};

function needsLegacyRecovery(mutation: ProfileMutation) {
  return mutation.expected_revision === null
    || (mutation.status === "blocked" && mutation.last_error_code === "invalid_request");
}

export function ProfileSyncRecovery({
  ownerUserId,
  environmentId,
}: {
  ownerUserId: string;
  environmentId: string;
}) {
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const serverProfile = useCallback(async (): Promise<ServerProfile> => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    const payload = await response.json() as { profile?: ServerProfile; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "プロフィールを取得できませんでした。");
    return payload.profile ?? null;
  }, []);

  const requeue = useCallback(async (mutation: ProfileMutation, expectedRevision: number) => {
    const normalized = normalizeProfileOutboxPayload(mutation.payload);
    const operationId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const replacement = createOutboxMutation(binding, {
      operationId,
      createdAt,
      kind: "profile_upsert",
      entityKey: "profile",
      payload: normalized,
      expectedRevision,
    });

    await putOutboxMutation(replacement);
    await deleteOutboxMutation(mutation.operation_id);
    requestOutboxDrain();
  }, [binding]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const rows = await listOutboxMutations(binding);
      const mutation = rows.find((candidate): candidate is ProfileMutation =>
        candidate.kind === "profile_upsert"
        && candidate.entity_key === "profile"
        && needsLegacyRecovery(candidate)
      );
      if (!mutation || cancelled) return;

      const current = await serverProfile();
      if (cancelled) return;
      const serverRevision = current?.revision ?? 0;
      const safeToReplayAutomatically = mutation.expected_revision === null
        ? serverRevision === 0
        : mutation.expected_revision === serverRevision;

      if (safeToReplayAutomatically) {
        await requeue(mutation, serverRevision);
        if (!cancelled) setMessage("未同期プロフィールを現在形式へ更新し、再同期しています…");
        return;
      }

      setRecovery({ mutation, serverRevision });
    })().catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "未同期プロフィールを復旧できませんでした。");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [binding, requeue, serverProfile]);

  async function confirmRecovery() {
    if (!recovery) return;
    setBusy(true);
    setError(null);
    try {
      await requeue(recovery.mutation, recovery.serverRevision);
      setRecovery(null);
      setMessage("端末に残っていたプロフィールを再同期しています…");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未同期プロフィールを復旧できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (!recovery && !message && !error) return null;

  return (
    <section className="notice" aria-label="プロフィール同期状態">
      {recovery ? (
        <>
          <strong>端末に残っているプロフィール変更を復旧できます。</strong>
          <p>
            サーバー側のプロフィール更新と競合する可能性があるため、自動適用を止めています。
            端末側の入力を優先する場合は再同期してください。
          </p>
          <button className="button" type="button" disabled={busy} onClick={() => void confirmRecovery()}>
            {busy ? "再同期中…" : "端末のプロフィールを再同期"}
          </button>
        </>
      ) : message ? (
        <><strong>プロフィール同期を復旧しました。</strong><p>{message}</p></>
      ) : null}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
