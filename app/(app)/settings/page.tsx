import Link from "next/link";
import { ProfileForm } from "@/components/profile-form";
import { appEnvironmentId } from "@/lib/app-environment";
import { CatalogLibrary } from "@/components/catalog-library";
import { DataExport } from "@/components/data-export";
import { AccountDeletion } from "@/components/account-deletion";
import { AcceptanceOutboxControl } from "@/components/acceptance-outbox-control";
import { accountDeletionAdminEnv } from "@/lib/env";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getAppSessionForRsc();
  const params = await searchParams;
  const view = params.view === "library" ? "library" : "settings";
  const profile = session ? await getProfile(session.accessToken) : null;

  return (
    <main className="app-main">
      <header className="topbar"><div><p className="eyebrow">Settings</p><h1>設定</h1><p className="muted">プロフィールは参照値として保存します。</p></div></header>
      <nav className="subnav" aria-label="Settings navigation">
        <Link href="/settings" aria-current={view === "settings" ? "page" : undefined}>Settings</Link>
        <Link href="/settings?view=library" aria-current={view === "library" ? "page" : undefined}>Library</Link>
      </nav>
      {view === "library" ? (
        <CatalogLibrary
          ownerUserId={session?.userId ?? ""}
          environmentId={appEnvironmentId()}
        />
      ) : (
        <div className="stack">
          <ProfileForm
            initialProfile={profile}
            ownerUserId={session?.userId ?? ""}
            environmentId={appEnvironmentId()}
          />
          <DataExport
            ownerUserId={session?.userId ?? ""}
            environmentId={appEnvironmentId()}
          />
          {process.env.VERCEL_ENV === "preview" ? (
            <AcceptanceOutboxControl
              ownerUserId={session?.userId ?? ""}
              environmentId={appEnvironmentId()}
            />
          ) : null}
          <AccountDeletion available={Boolean(accountDeletionAdminEnv())} />
        </div>
      )}
    </main>
  );
}
