import { ProfileForm } from "@/components/profile-form";
import { CatalogLibrary } from "@/components/catalog-library";
import { getAppSession } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getAppSession();
  const params = await searchParams;
  const view = params.view === "library" ? "library" : "settings";
  const profile = session ? await getProfile(session.accessToken) : null;

  return (
    <main className="app-main">
      <header className="topbar"><div><p className="eyebrow">Settings</p><h1>設定</h1><p className="muted">プロフィールは参照値として保存します。</p></div></header>
      <nav className="subnav" aria-label="Settings navigation">
        <a href="/settings" aria-current={view === "settings" ? "page" : undefined}>Settings</a>
        <a href="/settings?view=library" aria-current={view === "library" ? "page" : undefined}>Library</a>
      </nav>
      {view === "library" ? (
        <CatalogLibrary />
      ) : (
        <ProfileForm initialProfile={profile} />
      )}
    </main>
  );
}
