import { describe, expect, it } from "vitest";
import { decimal } from "@/lib/nutrition/exact";
import { formatEnergyAmount } from "@/lib/nutrition/energy-display";

describe("shared recorded calorie display", () => {
  it("formats exact period totals and legacy numeric totals identically", () => {
    expect(formatEnergyAmount(decimal("1500.25"))).toBe("1,500");
    expect(formatEnergyAmount(1500.25)).toBe("1,500");
    expect(formatEnergyAmount("1500.5")).toBe("1,501");
  });
  it("keeps unknown, explicit zero and a tiny positive amount distinct", () => {
    expect(formatEnergyAmount(null)).toBe("—");
    expect(formatEnergyAmount(0)).toBe("0");
    expect(formatEnergyAmount(0.000001)).toBe("0.000001");
    expect(formatEnergyAmount(0.000000001)).toBe("<0.00000001");
  });
  it("does not convert exact stored numbers through floating point", () => {
    expect(formatEnergyAmount("9007199254740993.5")).toBe("9,007,199,254,740,994");
  });
});
