import type { Route } from "next";
import Link from "next/link";
import type { TransferRequest } from "@/lib/karomiru/model";
export function KaromiruTransferLink({
  source,
  id,
  label = "カロミルへ転送",
}: {
  source: TransferRequest["source_kind"];
  id: string;
  label?: string;
}) {
  return (
    <Link
      className="button ghost transfer-link"
      href={`/transfer?source=${source}&id=${encodeURIComponent(id)}` as Route}
    >
      {label}
    </Link>
  );
}
