import type { NutrientCode } from "@/lib/nutrition/catalog";
import type { CommercialNutrient } from "@/lib/products/open-food-facts";

export type LabelBasis = {
  serving_size: number;
  serving_unit: string;
};

export type ParsedNutritionLabel = {
  basis: LabelBasis;
  nutrients: CommercialNutrient[];
};

type ParserDefinition = {
  code: NutrientCode;
  labels: string[];
  targetUnit: CommercialNutrient["unit"];
};

const DEFINITIONS: ParserDefinition[] = [
  { code: "energy", labels: ["エネルギー", "エネルキー", "熱量", "energy"], targetUnit: "kcal" },
  { code: "protein", labels: ["たんぱく質", "タンパク質", "蛋白質", "protein"], targetUnit: "g" },
  { code: "fat", labels: ["脂質", "fat"], targetUnit: "g" },
  { code: "carbohydrate", labels: ["炭水化物", "carbohydrate"], targetUnit: "g" },
  { code: "fiber", labels: ["食物繊維", "食物せんい", "fiber"], targetUnit: "g" },
  { code: "calcium", labels: ["カルシウム", "calcium"], targetUnit: "mg" },
  { code: "iron", labels: ["鉄", "iron"], targetUnit: "mg" },
  { code: "zinc", labels: ["亜鉛", "zinc"], targetUnit: "mg" },
  { code: "vitamin_a", labels: ["ビタミンA", "vitamin A"], targetUnit: "ug_rae" },
  { code: "vitamin_b1", labels: ["ビタミンB1", "vitamin B1"], targetUnit: "mg" },
  { code: "vitamin_b2", labels: ["ビタミンB2", "vitamin B2"], targetUnit: "mg" },
  { code: "vitamin_b6", labels: ["ビタミンB6", "vitamin B6"], targetUnit: "mg" },
  { code: "vitamin_b12", labels: ["ビタミンB12", "vitamin B12"], targetUnit: "ug" },
  { code: "vitamin_c", labels: ["ビタミンC", "vitamin C"], targetUnit: "mg" },
  { code: "vitamin_d", labels: ["ビタミンD", "vitamin D"], targetUnit: "ug" },
  { code: "vitamin_e", labels: ["ビタミンE", "vitamin E"], targetUnit: "mg" },
  { code: "sodium", labels: ["ナトリウム", "sodium"], targetUnit: "mg" },
  { code: "salt_equivalent", labels: ["食塩相当量", "食塩 相当量", "salt equivalent"], targetUnit: "g" },
];

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/[，,]/g, "")
    .replace(/[：:]/g, ":")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[・·]/g, ".")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/kca[li1]/gi, "kcal")
    .replace(/k[jJ]/g, "kJ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
}

function flexibleLabelPattern(label: string) {
  return [...label]
    .map((character) => character === " " ? "\\s*" : escapeRegExp(character))
    .join("\\s*");
}

function convertValue(value: number, sourceUnit: string, targetUnit: CommercialNutrient["unit"]) {
  const unit = sourceUnit.toLowerCase();
  if (!Number.isFinite(value) || value < 0) return null;

  if (targetUnit === "kcal") {
    if (unit === "kcal") return value;
    if (unit === "kj") return Math.round((value / 4.184) * 1_000_000) / 1_000_000;
    return null;
  }

  const grams = unit === "g"
    ? value
    : unit === "mg"
      ? value / 1_000
      : unit === "ug"
        ? value / 1_000_000
        : null;
  if (grams === null) return null;

  if (targetUnit === "g") return grams;
  if (targetUnit === "mg") return grams * 1_000;
  if (targetUnit === "ug" || targetUnit === "ug_rae") return grams * 1_000_000;
  return null;
}

function findBasis(text: string): LabelBasis {
  const natural = text.match(/([0-9]+(?:\\.[0-9]+)?)\\s*(個|本|枚|袋|錠|粒|食|杯)(?:\\s*分)?(?:\\s*\\([^)]*\\))?\\s*(?:当たり|あたり)/);
  if (natural) {
    return { serving_size: Number(natural[1]), serving_unit: natural[2] };
  }

  const metric = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(g|ml)\s*(?:当たり|あたり)/i);
  if (metric) {
    return { serving_size: Number(metric[1]), serving_unit: metric[2].toLowerCase() };
  }

  return { serving_size: 1, serving_unit: "serving" };
}

function findNutrient(text: string, definition: ParserDefinition): CommercialNutrient | null {
  const labelAlternation = definition.labels.map(flexibleLabelPattern).join("|");
  const separator = "[\\s:：=・.\\-()（）]{0,24}";
  const pattern = "(?:" + labelAlternation + ")" + separator + "([0-9]+(?:\\.[0-9]+)?)\\s*(kcal|kJ|mg|ug|g)";
  const match = text.match(new RegExp(pattern, "i"));
  if (!match) return null;

  const converted = convertValue(Number(match[1]), match[2], definition.targetUnit);
  if (converted === null) return null;
  return { code: definition.code, amount: converted, unit: definition.targetUnit };
}

export function parseNutritionLabelText(rawText: string): ParsedNutritionLabel {
  const text = normalizeText(rawText);
  const nutrients = DEFINITIONS.flatMap((definition) => {
    const nutrient = findNutrient(text, definition);
    return nutrient ? [nutrient] : [];
  });

  return {
    basis: findBasis(text),
    nutrients,
  };
}
