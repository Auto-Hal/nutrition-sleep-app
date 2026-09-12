"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const tabs = [
  { href: "/today", label: "Today", icon: "◷" },
  { href: "/nutrition", label: "Nutrition", icon: "◌" },
  { href: "/sleep", label: "Sleep", icon: "☾" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function AppShell({ children, email }: { children: ReactNode; email?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <div className="app-main" style={{ paddingBottom: 0 }}>
        <div className="topbar" style={{ marginBottom: 0 }}>
          <span className="eyebrow">{email ?? "Astra"}</span>
          <button className="button ghost" type="button" onClick={logout}>ログアウト</button>
        </div>
      </div>
      {children}
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {tabs.map((tab) => {
          const active = pathname === tab.href || (tab.href === "/settings" && pathname.startsWith("/settings"));
          return <Link key={tab.href} className="nav-link" href={tab.href} aria-current={active ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
