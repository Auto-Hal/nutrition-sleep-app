"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/app-icon";
import { RecordRefresh } from "@/components/record-refresh";

const tabs = [
  { href: "/today", label: "今日", icon: "today" },
  { href: "/nutrition", label: "栄養", icon: "nutrition" },
  { href: "/body", label: "からだ", icon: "body" },
  { href: "/sleep", label: "睡眠", icon: "sleep" },
  { href: "/settings", label: "設定", icon: "settings" },
] as const;

/** No outbox runtime, owner email, provider credentials or write controls. */
export function PublicShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="app-frame" data-area={pathname.startsWith("/sleep") ? "sleep" : pathname.startsWith("/nutrition") ? "nutrition" : undefined}>
    <header className="public-view-header"><span>栄養・睡眠管理 <small>公開閲覧</small></span><div className="public-view-actions"><RecordRefresh /><Link href="/login" prefetch={false}>記録・編集に切替</Link></div></header>
    {children}
    <nav className="bottom-nav" aria-label="メインナビゲーション">{tabs.map((tab) => <Link className="nav-link" href={tab.href} key={tab.href} aria-current={pathname === tab.href ? "page" : undefined}><span className="nav-icon" aria-hidden="true"><AppIcon name={tab.icon} /></span><span>{tab.label}</span></Link>)}</nav>
  </div>;
}
