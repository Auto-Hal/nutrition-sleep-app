import { chatNutritionDraftSchema, type ChatNutritionDraft } from "@/lib/nutrition/chat-import-contract";

export const CHAT_NUTRITION_FRAGMENT_KEY = "data";
export const MAX_CHAT_NUTRITION_FRAGMENT_LENGTH = 16_384;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeChatNutritionDraft(draft: ChatNutritionDraft) {
  const parsed = chatNutritionDraftSchema.parse(draft);
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(parsed)));
}

export function decodeChatNutritionDraft(encoded: string) {
  if (!encoded || encoded.length > MAX_CHAT_NUTRITION_FRAGMENT_LENGTH) {
    throw new Error("ChatGPTから受け取った登録データの長さを確認してください。");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch {
    throw new Error("ChatGPTから受け取った登録データを読み取れませんでした。");
  }

  const parsed = chatNutritionDraftSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("ChatGPTから受け取った登録データの形式が正しくありません。");
  }
  return parsed.data;
}

export function draftFromLocationHash(hash: string) {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const encoded = new URLSearchParams(fragment).get(CHAT_NUTRITION_FRAGMENT_KEY);
  if (!encoded) throw new Error("登録データが見つかりませんでした。");
  return decodeChatNutritionDraft(encoded);
}

export function chatNutritionImportReturnPath(hash: string) {
  if (!hash) return null;
  try {
    draftFromLocationHash(hash);
    return `/nutrition-import${hash.startsWith("#") ? hash : `#${hash}`}`;
  } catch {
    return null;
  }
}

export function buildChatNutritionImportUrl(origin: string, draft: ChatNutritionDraft) {
  const url = new URL("/nutrition-import", origin);
  url.hash = new URLSearchParams({
    [CHAT_NUTRITION_FRAGMENT_KEY]: encodeChatNutritionDraft(draft),
  }).toString();
  return url.toString();
}
