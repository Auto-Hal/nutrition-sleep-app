import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { appEnvironmentId } from "@/lib/app-environment";
import { getViewingSessionForRsc } from "@/lib/public-view/access";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getViewingSessionForRsc();
  if (!session) redirect("/login");
  if (session.readOnly) return <PublicShell>{children}</PublicShell>;

  return (
    <AppShell
      email={session.email ?? undefined}
      ownerUserId={session.userId}
      environmentId={appEnvironmentId()}
    >
      {children}
    </AppShell>
  );
}
