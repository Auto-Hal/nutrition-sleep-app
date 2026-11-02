import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { KaromiruTransfer } from "@/components/karomiru-transfer";
import { getAppSessionForRsc } from "@/lib/auth/session-rsc";
import { appEnvironmentId } from "@/lib/app-environment";
import {
  getKaromiruSource,
  getKaromiruTransfer,
  getRecentKaromiruTransfers,
} from "@/lib/karomiru/repository";
import {
  transferRequestSchema,
  type PreparedTransfer,
  type TransferPayload,
} from "@/lib/karomiru/model";
export const dynamic = "force-dynamic";
export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; id?: string; transfer?: string }>;
}) {
  const session = await getAppSessionForRsc();
  if (!session) redirect("/login");
  const params = await searchParams;
  let initial: TransferPayload,
    prepared: PreparedTransfer | null = null;
  if (params.transfer) {
    if (!z.string().uuid().safeParse(params.transfer).success) notFound();
    try {
      prepared = await getKaromiruTransfer(
        session.accessToken,
        params.transfer,
      );
      initial = prepared.fixed_payload;
    } catch {
      notFound();
    }
  } else {
    const request = transferRequestSchema.safeParse({
      source_kind: params.source,
      source_id: params.id,
      mode: "basic7",
    });
    if (!request.success) notFound();
    try {
      initial = await getKaromiruSource(session.accessToken, request.data);
    } catch {
      notFound();
    }
  }
  const recent = await getRecentKaromiruTransfers(
    session.accessToken,
    initial.source.kind,
    initial.source.id,
  );
  return (
    <main className="app-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">栄養成分表を画像で共有</p>
          <h1>カロミルへ転送</h1>
        </div>
        <Link href="/today" className="button ghost">
          今日へ
        </Link>
      </header>
      <KaromiruTransfer
        initial={initial}
        initialPrepared={prepared}
        initialRecent={recent}
        binding={{
          ownerUserId: session.userId,
          environmentId: appEnvironmentId(),
        }}
      />
    </main>
  );
}
