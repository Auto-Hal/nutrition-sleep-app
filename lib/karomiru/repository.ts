import "server-only";
import { createUserClient } from "@/lib/supabase/user";
import {
  parsePreparedTransfer,
  parseTransferPayload,
  type TransferRequest,
} from "@/lib/karomiru/model";
export async function getKaromiruSource(
  accessToken: string,
  request: TransferRequest,
) {
  const { data, error } = await createUserClient(accessToken).rpc(
    "get_karomiru_source_v1",
    { p_request: request },
  );
  if (error) throw new Error("転送元の記録を確認できませんでした。");
  return parseTransferPayload(data);
}
export async function getKaromiruTransfer(accessToken: string, id: string) {
  const { data, error } = await createUserClient(accessToken).rpc(
    "get_karomiru_transfer_v1",
    { p_transfer_id: id },
  );
  if (error) throw new Error("準備済みの転送を取得できませんでした。");
  return parsePreparedTransfer(data);
}
