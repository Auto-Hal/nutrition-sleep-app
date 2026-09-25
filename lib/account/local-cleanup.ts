"use client";

import { clearOutboxStorage } from "@/lib/offline/outbox-idb";

export async function clearThisDeviceAfterAccountDeletion() {
  await clearOutboxStorage().catch(() => undefined);

  try {
    localStorage.clear();
  } catch {
    // Best-effort local cleanup after authoritative server deletion.
  }

  try {
    sessionStorage.clear();
  } catch {
    // Best-effort local cleanup after authoritative server deletion.
  }

  if ("caches" in globalThis) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
  }
}
