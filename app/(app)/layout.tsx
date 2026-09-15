import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");

  return (
    <AppShell email={session.email ?? undefined}>
      {children}
    </AppShell>
  );
}
