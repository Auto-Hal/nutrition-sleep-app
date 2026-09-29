"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OUTBOX_CONTRACT_VERSION } from "@/lib/offline/outbox-contract";

type RuntimeVersion = {
  build_version: string;
  outbox_contract_version: number;
};

export function PwaRuntime({ initialBuildVersion }: { initialBuildVersion: string }) {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const checkingRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const checkVersion = useCallback(async () => {
    if (!navigator.onLine || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const response = await fetch("/api/app-version", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json() as RuntimeVersion;
      if (
        payload.build_version !== initialBuildVersion
        || payload.outbox_contract_version !== OUTBOX_CONTRACT_VERSION
      ) {
        setUpdateAvailable(true);
      }
    } catch {
      // Offline/temporary version-check failure must not affect the outbox.
    } finally {
      checkingRef.current = false;
    }
  }, [initialBuildVersion]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let active = true;
    void navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(initialBuildVersion)}`, { scope: "/" })
      .then((registration) => {
        if (!active) return;
        registrationRef.current = registration;
        return registration.update();
      })
      .then(() => checkVersion())
      .catch(() => {
        // PWA registration failure must not block the online application.
      });

    const onOnline = () => {
      void registrationRef.current?.update();
      void checkVersion();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void registrationRef.current?.update();
        void checkVersion();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkVersion, initialBuildVersion]);

  if (!updateAvailable) return null;

  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <div>
        <strong>アプリの更新があります</strong>
        <p>
          未同期の記録はIndexedDBに保持したまま、新しいアプリへ読み直せます。
        </p>
      </div>
      <button
        className="button"
        type="button"
        onClick={() => window.location.reload()}
      >
        更新して再読み込み
      </button>
    </div>
  );
}
