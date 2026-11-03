import { decimal, numberDecimalText, textDecimal, type Exact } from "@/lib/nutrition/exact";

/** Shared calorie presentation; calculation and stored precision stay intact. */
export function formatEnergyAmount(value: Exact | number | string | null) {
  if (value === null) return "—";
  const amount = typeof value === "object" ? value : decimal(typeof value === "number" ? numberDecimalText(value) : value);
  let text = textDecimal(amount, 0);
  if (amount.n !== 0n && text === "0") {
    text = textDecimal(amount, 8);
    if (text === "0") return amount.n > 0n ? "<0.00000001" : ">-0.00000001";
  }
  const [whole, tail] = text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (tail ? `.${tail}` : "");
}
