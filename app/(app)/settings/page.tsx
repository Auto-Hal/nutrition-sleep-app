import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { appEnvironmentId } from "@/lib/app-environment";
import { CatalogLibrary } from "@/components/catalog-library";
import { DataExport } from "@/components/data-export";
import { AccountDeletion } from "@/components/account-deletion";
import { ProviderBrandingSanitizer } from "@/components/provider-branding-sanitizer";
import { accountDeletionAdminEnv } from "@/lib/env";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getAppSessionForRsc();
  const params = await searchParams;
  const view = params.view === "library" ? "library" : "settings";
  const profile = session ? await getProfile(session.accessToken) : null;
  const ownerUserId = session?.userId ?? "";
  const environmentId = appEnvironmentId();

  return (
    <main className="app-main settings-page">
      <ProviderBrandingSanitizer />
      <header className="topbar settings-topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>設定</h1>
        </div>
      </header>
      <nav className="subnav settings-subnav" aria-label="設定メニュー">
        <Link href="/settings" aria-current={view === "settings" ? "page" : undefined}>プロフィール</Link>
        <Link href="/settings?view=library" aria-current={view === "library" ? "page" : undefined}>ライブラリ</Link>
      </nav>
      {view === "library" ? (
        <CatalogLibrary
          ownerUserId={ownerUserId}
          environmentId={environmentId}
        />
      ) : (
        <div className="stack settings-stack">
          <ProfileForm
            initialProfile={profile}
            ownerUserId={ownerUserId}
            environmentId={environmentId}
          />
          <DataExport
            ownerUserId={ownerUserId}
            environmentId={environmentId}
          />
          <section className="card settings-links-card" aria-labelledby="settings-info-title">
            <h2 id="settings-info-title">アプリ情報</h2>
            <nav className="settings-link-list" aria-label="プライバシーとアプリ情報">
              <Link href="/privacy"><span>プライバシー</span><span aria-hidden="true">›</span></Link>
              <Link href="/terms"><span>利用規約</span><span aria-hidden="true">›</span></Link>
              <Link href="/about"><span>このアプリについて</span><span aria-hidden="true">›</span></Link>
            </nav>
          </section>
          <AccountDeletion available={Boolean(accountDeletionAdminEnv())} />
        </div>
      )}
    </main>
  );
}
