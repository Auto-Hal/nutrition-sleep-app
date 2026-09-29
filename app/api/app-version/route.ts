import { NextResponse } from "next/server";
import { appRuntimeContract } from "@/lib/app-version";

export const dynamic = "force-dynamic";

export async function GET() {
  const contract = appRuntimeContract();
  return NextResponse.json(
    {
      build_version: contract.buildVersion,
      outbox_contract_version: contract.outboxContractVersion,
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
