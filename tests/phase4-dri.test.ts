import { describe, expect, it } from "vitest";
import { stableReferences } from "@/lib/nutrition/analytics";
import { DRI_2025_ADULT_REFERENCES, DRI_2025_SOURCE } from "@/lib/nutrition/dri/2025";
import { evaluateDriSet, describeDriPosition } from "@/lib/nutrition/dri/evaluate";
import { ageOnLocalDate, resolveDri2025 } from "@/lib/nutrition/dri/resolve";

describe("Phase 4 DRI 2025 adult reference model", () => {
  it("calculates age on the user's local calendar date", () => {
    expect(ageOnLocalDate("2001-09-15", "2026-09-14")).toBe(24);
    expect(ageOnLocalDate("2001-09-15", "2026-09-15")).toBe(25);
  });

  it("resolves the official 18-29 male moderate energy reference", () => {
    const resolved = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "energy",
    );

    expect(resolved.unavailableReason).toBeNull();
    expect(resolved.references).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: "EER_REFERENCE",
        unit: "kcal",
        value: 2600,
        activityLevel: "moderate",
        comparable: false,
      }),
    ]));
  });

  it("keeps protein EAR, RDA and DG as distinct references", () => {
    const resolved = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "protein",
    );

    expect(resolved.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR", value: 50, unit: "g" }),
      expect.objectContaining({ metric: "RDA", value: 65, unit: "g" }),
      expect.objectContaining({ metric: "DG", lower: 13, upper: 20, unit: "percent_energy" }),
    ]));
  });

  it("evaluates EAR/RDA as one adequacy axis", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "protein",
    ).references.filter((reference) => reference.unit === "g");

    expect(evaluateDriSet(references, 45).adequacy).toBe("below_ear");
    expect(evaluateDriSet(references, 55).adequacy).toBe("ear_to_rda");
    expect(evaluateDriSet(references, 70).adequacy).toBe("at_or_above_rda");
  });

  it("does not call intake below AI a deficiency", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "vitamin_d",
    ).references;

    const evaluation = evaluateDriSet(references, 5);
    expect(evaluation.adequacy).toBe("below_ai_indeterminate");
    expect(describeDriPosition(evaluation.adequacy!)).toBe("AI未満（不足とは判定できません）");
  });

  it("keeps energy reference-only rather than assigning adequacy", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "energy",
    ).references;

    const evaluation = evaluateDriSet(references, 1800);
    expect(evaluation.hasEnergyReference).toBe(true);
    expect(evaluation.adequacy).toBeNull();
    expect(evaluation.target).toBeNull();
    expect(evaluation.upperLimit).toBeNull();
  });

  it("marks vitamin A UL as non-comparable to total vitamin A RAE", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "vitamin_a",
    ).references;

    const evaluation = evaluateDriSet(references, 3000);
    expect(evaluation.upperLimit).toBeNull();
    expect(evaluation.nonComparableMetrics).toContain("UL");
  });

  it("requires activity level for energy reference", () => {
    const resolved = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: null },
      "2026-09-14",
      "energy",
    );

    expect(resolved.references).toEqual([]);
    expect(resolved.unavailableReason).toContain("身体活動レベル");
  });

  it("does not guess female iron requirements when menstrual status is absent", () => {
    const resolved = resolveDri2025(
      { birthDate: "2001-01-01", sex: "female", activityLevel: "moderate" },
      "2026-09-14",
      "iron",
    );

    expect(resolved.references).toEqual([]);
    expect(resolved.unavailableReason).toContain("月経状況");
  });

  it("resolves female iron from age 65 when the official table no longer branches by menstrual status", () => {
    const resolved = resolveDri2025(
      { birthDate: "1957-01-01", sex: "female", activityLevel: "moderate" },
      "2026-09-14",
      "iron",
    );

    expect(resolved.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR", value: 5.0, unit: "mg" }),
      expect.objectContaining({ metric: "RDA", value: 6.0, unit: "mg" }),
    ]));
  });

  it("contains adult salt-equivalent DG for both sexes", () => {
    const male = DRI_2025_ADULT_REFERENCES.find((reference) =>
      reference.nutrientCode === "salt_equivalent"
      && reference.sex === "male"
      && reference.ageMin === 18
      && reference.metric === "DG",
    );
    const female = DRI_2025_ADULT_REFERENCES.find((reference) =>
      reference.nutrientCode === "salt_equivalent"
      && reference.sex === "female"
      && reference.ageMin === 18
      && reference.metric === "DG",
    );

    expect(male?.upper).toBe(7.5);
    expect(female?.upper).toBe(6.5);
  });
});


describe("Phase 4 Astra DRI corrections", () => {
  it("treats the salt-equivalent DG upper bound as exclusive", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "salt_equivalent",
    ).references;

    expect(evaluateDriSet(references, 7.49).target).toBe("within_dg");
    expect(evaluateDriSet(references, 7.5).target).toBe("above_dg");
    expect(evaluateDriSet(references, 7.51).target).toBe("above_dg");
  });

  it("keeps vitamin B6 UL reference-only until chemical-form compatibility is proven", () => {
    const references = resolveDri2025(
      { birthDate: "2001-01-01", sex: "male", activityLevel: "moderate" },
      "2026-09-14",
      "vitamin_b6",
    ).references;

    const evaluation = evaluateDriSet(references, 100);
    expect(evaluation.upperLimit).toBeNull();
    expect(evaluation.nonComparableMetrics).toContain("UL");
  });

  it("pins DRI interpretation to the corrected 2025 report revision", () => {
    expect(DRI_2025_SOURCE.revision).toBe("report-corrected-2025-03-25");
    expect(DRI_2025_SOURCE.correctionsReflectedOn).toBe("2025-03-25");
  });
});


describe("Phase 4 DRI period boundary stability", () => {
  const maleProfile = {
    birthDate: "1976-09-15",
    sex: "male" as const,
    activityLevel: "moderate" as const,
  };

  it("keeps unchanged protein gram references across age 49 to 50", () => {
    const result = stableReferences(
      maleProfile,
      "protein",
      ["2026-09-14", "2026-09-15"],
      "g",
    );

    expect(result.unstableMetrics).toEqual([]);
    expect(result.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "EAR", value: 50 }),
      expect.objectContaining({ metric: "RDA", value: 65 }),
    ]));
  });

  it("stops only the changing protein percent-energy DG across age 49 to 50", () => {
    const result = stableReferences(
      maleProfile,
      "protein",
      ["2026-09-14", "2026-09-15"],
      "percent_energy",
    );

    expect(result.references).toEqual([]);
    expect(result.unstableMetrics).toEqual(["DG"]);
  });

  it("keeps stable protein references across age 29 to 30 and 74 to 75", () => {
    const at30 = stableReferences(
      { ...maleProfile, birthDate: "1996-09-15" },
      "protein",
      ["2026-09-14", "2026-09-15"],
      "g",
    );
    const at75 = stableReferences(
      { ...maleProfile, birthDate: "1951-09-15" },
      "protein",
      ["2026-09-14", "2026-09-15"],
      "g",
    );

    expect(at30.unstableMetrics).toEqual([]);
    expect(at75.unstableMetrics).toEqual([]);
  });
});
