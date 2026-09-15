"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode, useEffect, useState, useTransition } from "react";

const tabs = [
  { href: "/today", label: "Today", icon: "◷" },
  { href: "/nutrition", label: "Nutrition", icon: "◌" },
  { href: "/sleep", label: "Sleep", icon: "☾" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function AppShell({ children, email }: { children: ReactNode; email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();

  useEffect(() => {
    for (const tab of tabs) router.prefetch(tab.href);
  }, [router]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  function navigateTab(event: MouseEvent<HTMLAnchorElement>, href: string) {
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
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-frame" aria-busy={isNavigating || undefined}>
      <div className="app-main" style={{ paddingBottom: 0 }}>
        <div className="topbar" style={{ marginBottom: 0 }}>
          <span className="eyebrow">{email ?? "アカウント"}</span>
          <button className="button ghost" type="button" onClick={logout}>ログアウト</button>
        </div>
      </div>
      {children}
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
              <span className="nav-icon" aria-hidden="true">{pending ? "•" : tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
