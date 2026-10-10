import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ui-refresh.css";
import { PwaRuntime } from "@/components/pwa-runtime";
import { appBuildVersion } from "@/lib/app-version";

export const metadata: Metadata = {
  title: "栄養・睡眠管理",
  description: "食事と睡眠を記録し、傾向を確認して次の行動につなげる",
  applicationName: "栄養・睡眠管理",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  appleWebApp: {
    capable: true,
    title: "栄養・睡眠管理",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f7f4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <PwaRuntime initialBuildVersion={appBuildVersion()} />
        {children}
      </body>
    </html>
  );
}
