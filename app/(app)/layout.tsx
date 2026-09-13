import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAppSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getAppSession();
  if (!session) redirect("/login");

  return (
    <AppShell email={session.email ?? undefined}>
      {children}
    </AppShell>
  );
}
