import { redirect } from "next/navigation";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  redirect(await getAppSessionForRsc() ? "/today" : "/login");
}
