import { parseNutritionLabelText, type LabelBasis } from "@/lib/products/label-ocr";
import type { OcrDocument, OcrLine } from "@/lib/products/ocr-document";
import type { CommercialNutrient } from "@/lib/products/open-food-facts";

export type NutritionLabelEvidence = {
  code: CommercialNutrient["code"];
  line: string;
  confidence: number | null;
};

export type ParsedNutritionDocument = {
  basis: LabelBasis;
  nutrients: CommercialNutrient[];
  evidence: NutritionLabelEvidence[];
  diagnostics: {
    word_count: number;
    line_count: number;
    matched_nutrient_count: number;
    basis_detected: boolean;
  };
};

function lineConfidence(line: OcrLine) {
  const values = line.words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasDetectedBasis(basis: LabelBasis) {
  return !(basis.serving_size === 1 && basis.serving_unit === "serving");
}

export function parseNutritionLabelDocument(document: OcrDocument): ParsedNutritionDocument {
  const byCode = new Map<CommercialNutrient["code"], CommercialNutrient>();
  const evidence = new Map<CommercialNutrient["code"], NutritionLabelEvidence>();
  let basis: LabelBasis | null = null;

  // Coordinates are normalized into visual rows first. Parsing each row separately
  // prevents a value from a neighboring table row being paired with the wrong label.
  for (const line of document.lines) {
    const parsed = parseNutritionLabelText(line.text);
    if (!basis && hasDetectedBasis(parsed.basis)) {
      basis = parsed.basis;
    }

    for (const nutrient of parsed.nutrients) {
      if (byCode.has(nutrient.code)) continue;
      byCode.set(nutrient.code, nutrient);
      evidence.set(nutrient.code, {
        code: nutrient.code,
        line: line.text,
        confidence: lineConfidence(line),
      });
    }
  }

  // Full-text fallback recovers labels when Vision split one visual row imperfectly.
  // Row-derived matches win so table relationships remain the primary signal.
  const fallback = parseNutritionLabelText(document.text);
  if (!basis && hasDetectedBasis(fallback.basis)) {
    basis = fallback.basis;
  }
  for (const nutrient of fallback.nutrients) {
    if (byCode.has(nutrient.code)) continue;
    byCode.set(nutrient.code, nutrient);
    evidence.set(nutrient.code, {
      code: nutrient.code,
      line: "full_text_fallback",
      confidence: null,
    });
  }

  return {
    basis: basis ?? fallback.basis,
    nutrients: [...byCode.values()],
    evidence: [...evidence.values()],
    diagnostics: {
      word_count: document.words.length,
      line_count: document.lines.length,
      matched_nutrient_count: byCode.size,
      basis_detected: Boolean(basis),
    },
  };
}
