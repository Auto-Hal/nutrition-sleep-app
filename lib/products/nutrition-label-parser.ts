import { parseNutritionLabelText, type LabelBasis } from "@/lib/products/label-ocr";
import type { OcrBox, OcrDocument, OcrLine, OcrWord } from "@/lib/products/ocr-document";
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
    geometry_anchor_count: number;
  };
};

type NutrientAnchorDefinition = {
  code: CommercialNutrient["code"];
  labels: string[];
  parserLabel: string;
};

type LabelAnchor = {
  code: CommercialNutrient["code"];
  parserLabel: string;
  text: string;
  box: OcrBox;
  confidence: number | null;
};

type ValueCandidate = {
  amount: number;
  unit: string;
  text: string;
  box: OcrBox;
  confidence: number | null;
};

const ANCHORS: NutrientAnchorDefinition[] = [
  { code: "energy", labels: ["エネルギー", "熱量", "energy"], parserLabel: "エネルギー" },
  { code: "protein", labels: ["たんぱく質", "タンパク質", "蛋白質", "protein"], parserLabel: "たんぱく質" },
  { code: "fat", labels: ["脂質", "fat"], parserLabel: "脂質" },
  { code: "carbohydrate", labels: ["炭水化物", "carbohydrate"], parserLabel: "炭水化物" },
  { code: "fiber", labels: ["食物繊維", "食物せんい", "fiber"], parserLabel: "食物繊維" },
  { code: "calcium", labels: ["カルシウム", "calcium"], parserLabel: "カルシウム" },
  { code: "iron", labels: ["鉄", "iron"], parserLabel: "鉄" },
  { code: "zinc", labels: ["亜鉛", "zinc"], parserLabel: "亜鉛" },
  { code: "vitamin_a", labels: ["ビタミンA", "vitamin A"], parserLabel: "ビタミンA" },
  { code: "vitamin_b1", labels: ["ビタミンB1", "vitamin B1"], parserLabel: "ビタミンB1" },
  { code: "vitamin_b2", labels: ["ビタミンB2", "vitamin B2"], parserLabel: "ビタミンB2" },
  { code: "vitamin_b6", labels: ["ビタミンB6", "vitamin B6"], parserLabel: "ビタミンB6" },
  { code: "vitamin_b12", labels: ["ビタミンB12", "vitamin B12"], parserLabel: "ビタミンB12" },
  { code: "vitamin_c", labels: ["ビタミンC", "vitamin C"], parserLabel: "ビタミンC" },
  { code: "vitamin_d", labels: ["ビタミンD", "vitamin D"], parserLabel: "ビタミンD" },
  { code: "vitamin_e", labels: ["ビタミンE", "vitamin E"], parserLabel: "ビタミンE" },
  { code: "sodium", labels: ["ナトリウム", "sodium"], parserLabel: "ナトリウム" },
  { code: "salt_equivalent", labels: ["食塩相当量", "食塩 相当量", "salt equivalent"], parserLabel: "食塩相当量" },
];

function normalizeToken(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/[\s:：=・.()（）\-]/g, "")
    .toLowerCase();
}

function unionBox(boxes: OcrBox[]): OcrBox {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

function centerY(box: OcrBox) {
  return (box.minY + box.maxY) / 2;
}

function boxHeight(box: OcrBox) {
  return Math.max(1, box.maxY - box.minY);
}

function averageConfidence(words: OcrWord[]) {
  const values = words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lineConfidence(line: OcrLine) {
  return averageConfidence(line.words);
}

function hasDetectedBasis(basis: LabelBasis) {
  return !(basis.serving_size === 1 && basis.serving_unit === "serving");
}

function findLabelAnchors(document: OcrDocument): LabelAnchor[] {
  const candidates: LabelAnchor[] = [];

  for (const line of document.lines) {
    const words = [...line.words].sort((a, b) => a.box.minX - b.box.minX);
    for (let start = 0; start < words.length; start += 1) {
      for (let length = 1; length <= 3 && start + length <= words.length; length += 1) {
        const phraseWords = words.slice(start, start + length);
        const phrase = phraseWords.map((word) => word.text).join("");
        const normalizedPhrase = normalizeToken(phrase);

        for (const definition of ANCHORS) {
          const matched = definition.labels.some((label) => normalizeToken(label) === normalizedPhrase);
          if (!matched) continue;

          candidates.push({
            code: definition.code,
            parserLabel: definition.parserLabel,
            text: phrase,
            box: unionBox(phraseWords.map((word) => word.box)),
            confidence: averageConfidence(phraseWords),
          });
        }
      }
    }
  }

  const byCode = new Map<CommercialNutrient["code"], LabelAnchor>();
  for (const candidate of candidates) {
    const existing = byCode.get(candidate.code);
    if (!existing) {
      byCode.set(candidate.code, candidate);
      continue;
    }

    const candidateWidth = candidate.box.maxX - candidate.box.minX;
    const existingWidth = existing.box.maxX - existing.box.minX;
    if (candidateWidth < existingWidth) byCode.set(candidate.code, candidate);
  }

  return [...byCode.values()].sort((a, b) => centerY(a.box) - centerY(b.box));
}

function normalizeUnit(value: string) {
  const unit = value
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/[.,:;]$/g, "")
    .trim()
    .toLowerCase()
    .replace(/^kca[i1l]$/, "kcal");

  if (unit === "kcal" || unit === "kj" || unit === "mg" || unit === "ug" || unit === "g") return unit;
  return null;
}

function parseCombinedValue(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[，,]/g, "")
    .replace(/[μµ]/g, "u")
    .replace(/kca[li1]/gi, "kcal")
    .trim();

  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*(kca[i1l]|kJ|mg|ug|g)$/i);
  if (!match) return null;
  const unit = normalizeUnit(match[2]);
  if (!unit) return null;
  return { amount: Number(match[1]), unit };
}

function parseNumber(value: string) {
  const normalized = value.normalize("NFKC").replace(/[，,]/g, "").trim();
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function findValueCandidates(document: OcrDocument): ValueCandidate[] {
  const words = [...document.words].sort((a, b) => {
    const y = centerY(a.box) - centerY(b.box);
    return Math.abs(y) > 4 ? y : a.box.minX - b.box.minX;
  });

  const candidates: ValueCandidate[] = [];
  const consumedUnits = new Set<number>();

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const combined = parseCombinedValue(word.text);
    if (combined) {
      candidates.push({
        ...combined,
        text: word.text,
        box: word.box,
        confidence: word.confidence,
      });
      continue;
    }

    const amount = parseNumber(word.text);
    if (amount === null) continue;

    let bestUnitIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let unitIndex = 0; unitIndex < words.length; unitIndex += 1) {
      if (unitIndex === index || consumedUnits.has(unitIndex)) continue;
      const unit = normalizeUnit(words[unitIndex].text);
      if (!unit) continue;

      const unitWord = words[unitIndex];
      const verticalDistance = Math.abs(centerY(unitWord.box) - centerY(word.box));
      const maxVertical = Math.max(boxHeight(unitWord.box), boxHeight(word.box)) * 0.8;
      if (verticalDistance > maxVertical) continue;

      const horizontalGap = unitWord.box.minX - word.box.maxX;
      if (horizontalGap < -8 || horizontalGap > Math.max(160, boxHeight(word.box) * 6)) continue;

      const distance = Math.abs(horizontalGap) + verticalDistance * 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestUnitIndex = unitIndex;
      }
    }

    if (bestUnitIndex === null) continue;
    consumedUnits.add(bestUnitIndex);
    const unitWord = words[bestUnitIndex];
    const unit = normalizeUnit(unitWord.text);
    if (!unit) continue;

    candidates.push({
      amount,
      unit,
      text: `${word.text} ${unitWord.text}`,
      box: unionBox([word.box, unitWord.box]),
      confidence: averageConfidence([word, unitWord]),
    });
  }

  return candidates;
}

function parseCandidateForAnchor(anchor: LabelAnchor, candidate: ValueCandidate) {
  const parsed = parseNutritionLabelText(`${anchor.parserLabel} ${candidate.amount} ${candidate.unit}`);
  return parsed.nutrients.find((nutrient) => nutrient.code === anchor.code) ?? null;
}

function geometryMatches(document: OcrDocument) {
  const anchors = findLabelAnchors(document);
  const values = findValueCandidates(document);
  const nutrients = new Map<CommercialNutrient["code"], CommercialNutrient>();
  const evidence = new Map<CommercialNutrient["code"], NutritionLabelEvidence>();

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const currentY = centerY(anchor.box);
    const previousY = index > 0 ? centerY(anchors[index - 1].box) : null;
    const nextY = index + 1 < anchors.length ? centerY(anchors[index + 1].box) : null;

    const rowTop = previousY === null
      ? currentY - Math.max(24, boxHeight(anchor.box) * 1.3)
      : (previousY + currentY) / 2;
    const rowBottom = nextY === null
      ? currentY + Math.max(24, boxHeight(anchor.box) * 1.3)
      : (currentY + nextY) / 2;

    const maxVerticalDistance = Math.max(24, boxHeight(anchor.box) * 1.5);
    const candidates = values
      .filter((candidate) => {
        const valueY = centerY(candidate.box);
        return valueY >= rowTop
          && valueY < rowBottom
          && Math.abs(valueY - currentY) <= maxVerticalDistance
          && candidate.box.minX >= anchor.box.maxX - 8;
      })
      .map((candidate) => ({
        candidate,
        nutrient: parseCandidateForAnchor(anchor, candidate),
        distance: Math.abs(centerY(candidate.box) - currentY),
      }))
      .filter((entry): entry is { candidate: ValueCandidate; nutrient: CommercialNutrient; distance: number } =>
        entry.nutrient !== null,
      )
      .sort((a, b) => a.distance - b.distance || a.candidate.box.minX - b.candidate.box.minX);

    const best = candidates[0];
    if (!best) continue;

    nutrients.set(anchor.code, best.nutrient);
    evidence.set(anchor.code, {
      code: anchor.code,
      line: `geometry: ${anchor.text} -> ${best.candidate.text}`,
      confidence: best.candidate.confidence === null || anchor.confidence === null
        ? best.candidate.confidence ?? anchor.confidence
        : (best.candidate.confidence + anchor.confidence) / 2,
    });
  }

  return { anchors, nutrients, evidence };
}

export function parseNutritionLabelDocument(document: OcrDocument): ParsedNutritionDocument {
  const byCode = new Map<CommercialNutrient["code"], CommercialNutrient>();
  const evidence = new Map<CommercialNutrient["code"], NutritionLabelEvidence>();
  let basis: LabelBasis | null = null;

  const geometry = geometryMatches(document);
  const anchoredCodes = new Set(geometry.anchors.map((anchor) => anchor.code));

  for (const [code, nutrient] of geometry.nutrients) {
    byCode.set(code, nutrient);
    const matchedEvidence = geometry.evidence.get(code);
    if (matchedEvidence) evidence.set(code, matchedEvidence);
  }

  // Row parsing is secondary. If a label anchor was detected, geometry owns that
  // nutrient even when its value is unreadable. This prevents borrowing a value
  // from the neighboring table row.
  for (const line of document.lines) {
    const parsed = parseNutritionLabelText(line.text);
    if (!basis && hasDetectedBasis(parsed.basis)) {
      basis = parsed.basis;
    }

    for (const nutrient of parsed.nutrients) {
      if (anchoredCodes.has(nutrient.code) || byCode.has(nutrient.code)) continue;
      byCode.set(nutrient.code, nutrient);
      evidence.set(nutrient.code, {
        code: nutrient.code,
        line: line.text,
        confidence: lineConfidence(line),
      });
    }
  }

  const fallback = parseNutritionLabelText(document.text);
  if (!basis && hasDetectedBasis(fallback.basis)) {
    basis = fallback.basis;
  }
  for (const nutrient of fallback.nutrients) {
    if (anchoredCodes.has(nutrient.code) || byCode.has(nutrient.code)) continue;
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
      geometry_anchor_count: geometry.anchors.length,
    },
  };
}
