import { NextResponse } from "next/server";
import { fetchYahooShoppingIdentity } from "@/lib/products/yahoo-shopping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAMPLES = [
  ["4901777300446", "tea"],
  ["4909411097646", "tea"],
  ["4901085621547", "tea"],
  ["4901277252856", "tea"],
  ["4902102156936", "coffee"],
  ["4901351026304", "confectionery"],
  ["4902105299852", "instant-noodle"],
  ["4902105295632", "instant-noodle"],
  ["4901085649725", "tea"],
  ["4902102158145", "tea"],
  ["4901033630041", "soy-drink"],
  ["4930726102428", "soy-drink"],
  ["4901330523145", "snack"],
  ["4901113464382", "cereal"],
  ["4902777124636", "chocolate"],
  ["4901735022052", "snack"],
  ["4901335118988", "snack"],
  ["4946842529643", "protein-bar"],
  ["4902663015994", "instant-soup"],
  ["4930726100219", "soy-drink"],
] as const;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const batch = Number(url.searchParams.get("batch"));
  if (!Number.isInteger(batch) || batch < 0 || batch > 3) {
    return NextResponse.json({ error: "batch must be 0..3" }, { status: 400 });
  }

  const selected = SAMPLES.slice(batch * 5, batch * 5 + 5);
  const results = [];

  for (let index = 0; index < selected.length; index += 1) {
    const [jan, category] = selected[index];
    const result = await fetchYahooShoppingIdentity(jan);
    results.push({
      jan,
      category,
      status: result.status,
      candidate_count:
        result.status === "found" ? 1
        : result.status === "ambiguous" ? result.candidates.length
        : 0,
      unavailable_reason: result.status === "unavailable" ? result.reason : null,
      exact_returned_jan_required: result.status === "found" || result.status === "ambiguous",
      identity_only: result.status === "found" || result.status === "ambiguous",
      nutrition_adopted: false,
    });

    if (index < selected.length - 1) await wait(1100);
  }

  return NextResponse.json(
    {
      acceptance: "yahoo-real-jan",
      batch,
      sample_count: selected.length,
      exact_jan_validation: true,
      identity_only: true,
      nutrition_authority: false,
      raw_provider_payload_returned: false,
      results,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
