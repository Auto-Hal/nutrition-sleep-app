import type { ReactNode } from "react";

export type AppIconName = "today" | "nutrition" | "sleep" | "settings" | "account" | "sparkles" | "arrow-up-right";

const paths: Record<AppIconName, ReactNode> = {
  today: <><rect x="3.5" y="5" width="17" height="16" rx="3" /><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 15h3" /></>,
  nutrition: <><path d="M5 19c0-7 4-12 14-14 0 10-5 14-12 14H5Z" /><path d="m5 19 9-9M10 14v-4M10 14h4" /></>,
  sleep: <path d="M20.5 14.3A8.8 8.8 0 0 1 9.7 3.5a9 9 0 1 0 10.8 10.8Z" />,
  settings: <><path d="M4 7h5M13 7h7M4 17h9M17 17h3" /><circle cx="11" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  account: <><circle cx="12" cy="8" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="M20 3v4M18 5h4" /></>,
  "arrow-up-right": <path d="M6 18 18 6M7 6h11v11" />,
};

export function AppIcon({ name, className = "app-icon" }: { name: AppIconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
