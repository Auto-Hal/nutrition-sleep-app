import type { DriActivityLevel, DriReference, DriSex } from "@/lib/nutrition/dri/types";

type AdultBand = { ageMin: number; ageMax: number | null };
const ADULT_BANDS: AdultBand[] = [
  { ageMin: 18, ageMax: 29 },
  { ageMin: 30, ageMax: 49 },
  { ageMin: 50, ageMax: 64 },
  { ageMin: 65, ageMax: 74 },
  { ageMin: 75, ageMax: null },
];

function point(
  nutrientCode: DriReference["nutrientCode"],
  sex: DriSex,
  metric: DriReference["metric"],
  unit: DriReference["unit"],
  values: Array<number | null>,
  options: { comparable?: boolean; caveat?: string } = {},
): DriReference[] {
  return ADULT_BANDS.flatMap((band, index) => {
    const value = values[index];
    if (value === null) return [];
    return [{
      edition: "2025" as const,
      nutrientCode,
      sex,
      ageMin: band.ageMin,
      ageMax: band.ageMax,
      metric,
      unit,
      value,
      comparable: options.comparable ?? true,
      caveat: options.caveat,
    }];
  });
}

function range(
  nutrientCode: DriReference["nutrientCode"],
  sex: DriSex,
  metric: "DG",
  unit: DriReference["unit"],
  values: Array<[number, number]>,
): DriReference[] {
  return ADULT_BANDS.map((band, index) => ({
    edition: "2025" as const,
    nutrientCode,
    sex,
    ageMin: band.ageMin,
    ageMax: band.ageMax,
    metric,
    unit,
    lower: values[index][0],
    upper: values[index][1],
    comparable: true,
  }));
}

function minimum(
  nutrientCode: DriReference["nutrientCode"],
  sex: DriSex,
  values: number[],
): DriReference[] {
  return ADULT_BANDS.map((band, index) => ({
    edition: "2025" as const,
    nutrientCode,
    sex,
    ageMin: band.ageMin,
    ageMax: band.ageMax,
    metric: "DG" as const,
    unit: "g" as const,
    lower: values[index],
    comparable: true,
  }));
}

function maximum(
  nutrientCode: DriReference["nutrientCode"],
  sex: DriSex,
  unit: DriReference["unit"],
  values: number[],
): DriReference[] {
  return ADULT_BANDS.map((band, index) => ({
    edition: "2025" as const,
    nutrientCode,
    sex,
    ageMin: band.ageMin,
    ageMax: band.ageMax,
    metric: "DG" as const,
    unit,
    upper: values[index],
    comparable: true,
  }));
}

function energy(
  sex: DriSex,
  activityLevel: DriActivityLevel,
  values: Array<number | null>,
): DriReference[] {
  return ADULT_BANDS.flatMap((band, index) => {
    const value = values[index];
    if (value === null) return [];
    return [{
      edition: "2025" as const,
      nutrientCode: "energy" as const,
      sex,
      ageMin: band.ageMin,
      ageMax: band.ageMax,
      metric: "EER_REFERENCE" as const,
      unit: "kcal" as const,
      value,
      activityLevel,
      comparable: false,
      caveat: "エネルギー過不足は摂取量と推定必要量の単純比較だけでは判定しない。",
    }];
  });
}

const vitaminAUlCaveat = "ビタミンAのULはプロビタミンAカロテノイドを含まないため、総ビタミンA RAEとは直接比較しない。";
const vitaminECaveat = "2025年版のビタミンE基準はα-トコフェロールについて算定。catalog値の意味が一致する場合のみ解釈できる。";

export const DRI_2025_ADULT_REFERENCES: DriReference[] = [
  ...energy("male", "low", [2250, 2350, 2250, 2100, 1850]),
  ...energy("male", "moderate", [2600, 2750, 2650, 2350, 2250]),
  ...energy("male", "high", [3000, 3150, 3000, 2650, null]),
  ...energy("female", "low", [1700, 1750, 1700, 1650, 1450]),
  ...energy("female", "moderate", [1950, 2050, 1950, 1850, 1750]),
  ...energy("female", "high", [2250, 2350, 2250, 2050, null]),

  ...point("protein", "male", "EAR", "g", [50, 50, 50, 50, 50]),
  ...point("protein", "male", "RDA", "g", [65, 65, 65, 60, 60]),
  ...range("protein", "male", "DG", "percent_energy", [[13, 20], [13, 20], [14, 20], [15, 20], [15, 20]]),
  ...point("protein", "female", "EAR", "g", [40, 40, 40, 40, 40]),
  ...point("protein", "female", "RDA", "g", [50, 50, 50, 50, 50]),
  ...range("protein", "female", "DG", "percent_energy", [[13, 20], [13, 20], [14, 20], [15, 20], [15, 20]]),

  ...range("fat", "male", "DG", "percent_energy", [[20, 30], [20, 30], [20, 30], [20, 30], [20, 30]]),
  ...range("fat", "female", "DG", "percent_energy", [[20, 30], [20, 30], [20, 30], [20, 30], [20, 30]]),

  ...range("carbohydrate", "male", "DG", "percent_energy", [[50, 65], [50, 65], [50, 65], [50, 65], [50, 65]]),
  ...range("carbohydrate", "female", "DG", "percent_energy", [[50, 65], [50, 65], [50, 65], [50, 65], [50, 65]]),

  ...minimum("fiber", "male", [20, 22, 22, 21, 20]),
  ...minimum("fiber", "female", [18, 18, 18, 18, 17]),

  ...point("calcium", "male", "EAR", "mg", [650, 650, 600, 600, 600]),
  ...point("calcium", "male", "RDA", "mg", [800, 750, 750, 750, 750]),
  ...point("calcium", "male", "UL", "mg", [2500, 2500, 2500, 2500, 2500]),
  ...point("calcium", "female", "EAR", "mg", [550, 550, 550, 550, 500]),
  ...point("calcium", "female", "RDA", "mg", [650, 650, 650, 650, 600]),
  ...point("calcium", "female", "UL", "mg", [2500, 2500, 2500, 2500, 2500]),

  ...point("iron", "male", "EAR", "mg", [5.5, 6.0, 6.0, 5.5, 5.5]),
  ...point("iron", "male", "RDA", "mg", [7.0, 7.5, 7.0, 7.0, 6.5]),
  // For women under 65, the official adult table differs by menstrual status,
  // which is not present in Profile. From 65 onward the table has one value set.
  ...point("iron", "female", "EAR", "mg", [null, null, null, 5.0, 4.5]),
  ...point("iron", "female", "RDA", "mg", [null, null, null, 6.0, 5.5]),

  ...point("zinc", "male", "EAR", "mg", [7.5, 8.0, 8.0, 7.5, 7.5]),
  ...point("zinc", "male", "RDA", "mg", [9.0, 9.5, 9.5, 9.0, 9.0]),
  ...point("zinc", "male", "UL", "mg", [40, 45, 45, 45, 40]),
  ...point("zinc", "female", "EAR", "mg", [6.0, 6.5, 6.5, 6.5, 6.0]),
  ...point("zinc", "female", "RDA", "mg", [7.5, 8.0, 8.0, 7.5, 7.0]),
  ...point("zinc", "female", "UL", "mg", [35, 35, 35, 35, 35]),

  ...point("vitamin_a", "male", "EAR", "ug_rae", [600, 650, 650, 600, 550]),
  ...point("vitamin_a", "male", "RDA", "ug_rae", [850, 900, 900, 850, 800]),
  ...point("vitamin_a", "male", "UL", "ug_rae", [2700, 2700, 2700, 2700, 2700], { comparable: false, caveat: vitaminAUlCaveat }),
  ...point("vitamin_a", "female", "EAR", "ug_rae", [450, 500, 500, 500, 450]),
  ...point("vitamin_a", "female", "RDA", "ug_rae", [650, 700, 700, 700, 650]),
  ...point("vitamin_a", "female", "UL", "ug_rae", [2700, 2700, 2700, 2700, 2700], { comparable: false, caveat: vitaminAUlCaveat }),

  ...point("vitamin_b1", "male", "EAR", "mg", [0.8, 0.8, 0.8, 0.7, 0.7]),
  ...point("vitamin_b1", "male", "RDA", "mg", [1.1, 1.2, 1.1, 1.0, 1.0]),
  ...point("vitamin_b1", "female", "EAR", "mg", [0.6, 0.6, 0.6, 0.6, 0.5]),
  ...point("vitamin_b1", "female", "RDA", "mg", [0.8, 0.9, 0.8, 0.8, 0.7]),

  ...point("vitamin_b2", "male", "EAR", "mg", [1.3, 1.4, 1.3, 1.2, 1.1]),
  ...point("vitamin_b2", "male", "RDA", "mg", [1.6, 1.7, 1.6, 1.4, 1.4]),
  ...point("vitamin_b2", "female", "EAR", "mg", [1.0, 1.0, 1.0, 0.9, 0.9]),
  ...point("vitamin_b2", "female", "RDA", "mg", [1.2, 1.2, 1.2, 1.1, 1.1]),

  ...point("vitamin_b6", "male", "EAR", "mg", [1.2, 1.2, 1.2, 1.2, 1.2]),
  ...point("vitamin_b6", "male", "RDA", "mg", [1.5, 1.5, 1.5, 1.4, 1.4]),
  ...point("vitamin_b6", "male", "UL", "mg", [55, 60, 60, 55, 50]),
  ...point("vitamin_b6", "female", "EAR", "mg", [1.0, 1.0, 1.0, 1.0, 1.0]),
  ...point("vitamin_b6", "female", "RDA", "mg", [1.2, 1.2, 1.2, 1.2, 1.2]),
  ...point("vitamin_b6", "female", "UL", "mg", [45, 45, 45, 45, 40]),

  ...point("vitamin_b12", "male", "AI", "ug", [4.0, 4.0, 4.0, 4.0, 4.0]),
  ...point("vitamin_b12", "female", "AI", "ug", [4.0, 4.0, 4.0, 4.0, 4.0]),

  ...point("vitamin_c", "male", "EAR", "mg", [80, 80, 80, 80, 80]),
  ...point("vitamin_c", "male", "RDA", "mg", [100, 100, 100, 100, 100]),
  ...point("vitamin_c", "female", "EAR", "mg", [80, 80, 80, 80, 80]),
  ...point("vitamin_c", "female", "RDA", "mg", [100, 100, 100, 100, 100]),

  ...point("vitamin_d", "male", "AI", "ug", [9.0, 9.0, 9.0, 9.0, 9.0]),
  ...point("vitamin_d", "male", "UL", "ug", [100, 100, 100, 100, 100]),
  ...point("vitamin_d", "female", "AI", "ug", [9.0, 9.0, 9.0, 9.0, 9.0]),
  ...point("vitamin_d", "female", "UL", "ug", [100, 100, 100, 100, 100]),

  ...point("vitamin_e", "male", "AI", "mg", [6.5, 6.5, 6.5, 7.5, 7.0], { comparable: false, caveat: vitaminECaveat }),
  ...point("vitamin_e", "male", "UL", "mg", [800, 800, 800, 800, 800], { comparable: false, caveat: vitaminECaveat }),
  ...point("vitamin_e", "female", "AI", "mg", [5.0, 6.0, 6.0, 7.0, 6.0], { comparable: false, caveat: vitaminECaveat }),
  ...point("vitamin_e", "female", "UL", "mg", [650, 700, 700, 700, 650], { comparable: false, caveat: vitaminECaveat }),

  ...point("sodium", "male", "EAR", "mg", [600, 600, 600, 600, 600]),
  ...point("sodium", "female", "EAR", "mg", [600, 600, 600, 600, 600]),

  ...maximum("salt_equivalent", "male", "g", [7.5, 7.5, 7.5, 7.5, 7.5]),
  ...maximum("salt_equivalent", "female", "g", [6.5, 6.5, 6.5, 6.5, 6.5]),
];

export const DRI_2025_SOURCE = {
  edition: "2025",
  period: "FY2025-FY2029",
  authority: "厚生労働省",
  url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyun.html",
  legalTableUrl: "https://www.mhlw.go.jp/web/t_doc?dataId=78ab4652&dataType=0",
} as const;
