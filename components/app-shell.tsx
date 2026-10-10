"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { OutboxRuntime } from "@/components/outbox-runtime";
import { ConnectivityBoundary } from "@/components/connectivity-boundary";
import { AccountHeader } from "@/components/account-header";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import type { OutboxBinding } from "@/lib/offline/outbox-contract";
import { countUnsyncedOutbox, pauseOutboxForBinding } from "@/lib/offline/outbox-idb";

const tabs = [
  { href: "/today", label: "今日", icon: "today" },
  { href: "/nutrition", label: "栄養", icon: "nutrition" },
  { href: "/sleep", label: "睡眠", icon: "sleep" },
  { href: "/settings", label: "設定", icon: "settings" },
] as const satisfies ReadonlyArray<{ href: Route; label: string; icon: AppIconName }>;

export function AppShell({
  children,
  email,
  ownerUserId,
  environmentId,
}: {
  children: ReactNode;
  email?: string;
  ownerUserId: string;
  environmentId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();
  const binding = useMemo<OutboxBinding>(
    () => ({ ownerUserId, environmentId }),
    [ownerUserId, environmentId],
  );

  useEffect(() => {
    for (const tab of tabs) router.prefetch(tab.href);
  }, [router]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  function navigateTab(event: MouseEvent<HTMLAnchorElement>, href: Route) {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;

    const active = pathname === href || (href === "/settings" && pathname.startsWith("/settings"));
    if (active) return;

    event.preventDefault();
    setPendingHref(href);
    startNavigation(() => router.push(href));
  }

  async function logout() {
    try {
      const unsynced = await countUnsyncedOutbox(binding);
      if (unsynced > 0) {
        const accepted = window.confirm(
          `未同期の記録が${unsynced}件あります。端末に保持したままログアウトし、同じアカウントで再ログイン後に同期します。続けますか？`,
        );
        if (!accepted) return;
      }
      await pauseOutboxForBinding(binding);
    } catch {
      const accepted = window.confirm(
        "端末の未同期状態を確認できませんでした。ローカル記録は削除せずにログアウトします。続けますか？",
      );
      if (!accepted) return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-frame" aria-busy={isNavigating || undefined}>
      <AccountHeader email={email} onLogout={() => void logout()} />
      <ConnectivityBoundary binding={binding}>
        {children}
      </ConnectivityBoundary>
      <OutboxRuntime binding={binding} />
      <div
        className="provider-attribution"
        dangerouslySetInnerHTML={{
          __html: '<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet --><span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span><!-- End Yahoo! JAPAN Web Services Attribution Snippet -->',
        }}
      />
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {tabs.map((tab) => {
          const active = pathname === tab.href || (tab.href === "/settings" && pathname.startsWith("/settings"));
          const pending = pendingHref === tab.href && isNavigating;
          return (
            <Link
              key={tab.href}
              className="nav-link"
              href={tab.href}
              prefetch
              aria-current={active ? "page" : undefined}
              aria-label={pending ? `${tab.label} 読み込み中` : tab.label}
              data-pending={pending ? "true" : undefined}
              onClick={(event) => navigateTab(event, tab.href)}
              onPointerEnter={() => router.prefetch(tab.href)}
              onTouchStart={() => router.prefetch(tab.href)}
            >
              <span className="nav-icon" aria-hidden="true"><AppIcon name={tab.icon} /></span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
