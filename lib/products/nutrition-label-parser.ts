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
  unit: string | null;
  box: OcrBox;
  confidence: number | null;
};

type ValueCandidate = {
  amount: number;
  unit: string;
  text: string;
  box: OcrBox;
  amountBox: OcrBox;
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
    .replace(/一/g, "ー")
    .toLowerCase();
}

function editDistanceAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function labelMatches(phrase: string, label: string) {
  const normalizedPhrase = normalizeToken(phrase);
  const normalizedLabel = normalizeToken(label);
  if (normalizedPhrase === normalizedLabel) return true;

  if (normalizedPhrase.startsWith(normalizedLabel)) {
    const suffix = normalizedPhrase.slice(normalizedLabel.length);
    if (["g", "mg", "ug", "kcal", "kj"].includes(suffix)) return true;
  }

  const vitaminFamily = normalizedLabel.startsWith("ビタミン") || normalizedLabel.startsWith("vitamin");
  if (vitaminFamily) return false;

  // Fuzzy matching is intentionally limited to longer known nutrition labels.
  // It repairs one-character OCR noise without making short labels such as 鉄 ambiguous.
  return normalizedLabel.length >= 4
    && normalizedPhrase.length >= 4
    && editDistanceAtMostOne(normalizedPhrase, normalizedLabel);
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
      for (let length = 1; length <= 6 && start + length <= words.length; length += 1) {
        const phraseWords = words.slice(start, start + length);
        const phrase = phraseWords.map((word) => word.text).join("");
        for (const definition of ANCHORS) {
          const matched = definition.labels.some((label) => labelMatches(phrase, label));
          if (!matched) continue;

          candidates.push({
            code: definition.code,
            parserLabel: definition.parserLabel,
            text: phrase,
            unit: normalizeUnit(phrase),
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
    if (candidate.unit && !existing.unit) {
      byCode.set(candidate.code, candidate);
    } else if (Boolean(candidate.unit) === Boolean(existing.unit) && candidateWidth < existingWidth) {
      byCode.set(candidate.code, candidate);
    }
  }

  return [...byCode.values()].sort((a, b) => centerY(a.box) - centerY(b.box));
}

function normalizeUnit(value: string) {
  const unit = value
    .normalize("NFKC")
    .replace(/[μµ]/g, "u")
    .replace(/[.,:;]$/g, "")
    .replace(/[^a-zA-Z0-9|!]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[|!1i]$/g, "l");

  if (unit === "g") return "g";

  for (const expected of ["kcal", "kj", "mg", "ug"] as const) {
    if (unit === expected) return expected;
    if (unit.length >= 2 && editDistanceAtMostOne(unit, expected)) return expected;

    if (unit.endsWith(expected)) {
      const prefix = unit.slice(0, -expected.length);
      if (/[a-z]/.test(prefix)) return expected;
    }
  }

  if (unit.endsWith("g")) {
    const prefix = unit.slice(0, -1);
    if (/[a-z]/.test(prefix)) return "g";
  }

  return null;
}

function parseCombinedValue(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[，,]/g, "")
    .replace(/[μµ]/g, "u")
    .replace(/kca[li1]/gi, "kcal")
    .trim();

  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([^\s]+)$/i);
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

function structuralUnitRowCenters(document: OcrDocument) {
  const numericWords = document.words.filter((word) => parseNumber(word.text) !== null);
  if (numericWords.length === 0) return [];

  const numericXs = numericWords
    .map((word) => word.box.minX)
    .sort((a, b) => a - b);
  const numericColumnX = numericXs[Math.floor(numericXs.length / 2)];

  const centers = document.words
    .filter((word) =>
      parseNumber(word.text) === null
      && normalizeUnit(word.text) !== null
      && word.box.maxX < numericColumnX
    )
    .map((word) => centerY(word.box))
    .sort((a, b) => a - b);

  const deduped: number[] = [];
  for (const value of centers) {
    const previous = deduped[deduped.length - 1];
    if (previous === undefined || Math.abs(value - previous) > 6) {
      deduped.push(value);
    } else {
      deduped[deduped.length - 1] = (previous + value) / 2;
    }
  }
  return deduped;
}

function structuralBoundsForAnchor(
  anchor: LabelAnchor,
  rowCenters: number[],
) {
  if (rowCenters.length === 0) return null;
  const anchorY = centerY(anchor.box);
  let rowIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rowCenters.length; index += 1) {
    const distance = Math.abs(rowCenters[index] - anchorY);
    if (distance < bestDistance) {
      bestDistance = distance;
      rowIndex = index;
    }
  }

  const current = rowCenters[rowIndex];
  const previous = rowIndex > 0 ? rowCenters[rowIndex - 1] : null;
  const next = rowIndex + 1 < rowCenters.length ? rowCenters[rowIndex + 1] : null;
  const fallback = Math.max(16, boxHeight(anchor.box) * 0.85);

  return {
    center: current,
    top: previous === null ? current - fallback : (previous + current) / 2,
    bottom: next === null ? current + fallback : (current + next) / 2,
  };
}

function hasConflictingInlineUnit(
  document: OcrDocument,
  amountWord: OcrWord,
  anchorUnit: string,
) {
  const amountY = centerY(amountWord.box);
  const maxVertical = Math.max(8, boxHeight(amountWord.box) * 0.8);

  return document.words.some((word) => {
    if (word === amountWord || parseNumber(word.text) !== null) return false;
    const unit = normalizeUnit(word.text);
    if (!unit || unit === anchorUnit) return false;

    const vertical = Math.abs(centerY(word.box) - amountY);
    const horizontal = word.box.minX - amountWord.box.maxX;
    return vertical <= maxVertical && horizontal >= -4 && horizontal <= 120;
  });
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
        amountBox: word.box,
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

      const gapToRight = unitWord.box.minX - word.box.maxX;
      const gapToLeft = word.box.minX - unitWord.box.maxX;
      const horizontalGap = gapToRight >= -8
        ? Math.max(0, gapToRight)
        : gapToLeft >= -8
          ? Math.max(0, gapToLeft)
          : Number.POSITIVE_INFINITY;
      if (horizontalGap > Math.max(240, boxHeight(word.box) * 10)) continue;

      const distance = horizontalGap + verticalDistance * 2;
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
      amountBox: word.box,
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

    const maxVerticalDistance = Math.max(10, boxHeight(anchor.box) * 0.8);

    const anchorUnit = anchor.unit;
    const structuralRows = structuralUnitRowCenters(document);
    const structuralBounds = anchorUnit ? structuralBoundsForAnchor(anchor, structuralRows) : null;

    const directCandidates = anchorUnit && structuralBounds
      ? document.words
        .map((word) => {
          const amount = parseNumber(word.text);
          if (amount === null) return null;
          const valueY = centerY(word.box);
          if (
            valueY < structuralBounds.top
            || valueY >= structuralBounds.bottom
            || word.box.minX < anchor.box.maxX - 8
            || hasConflictingInlineUnit(document, word, anchorUnit)
          ) return null;

          const candidate: ValueCandidate = {
            amount,
            unit: anchorUnit,
            text: `${word.text} [unit from ${anchor.text}]`,
            box: word.box,
            amountBox: word.box,
            confidence: word.confidence,
          };
          const nutrient = parseCandidateForAnchor(anchor, candidate);
          if (!nutrient) return null;
          return {
            candidate,
            nutrient,
            distance: Math.abs(valueY - structuralBounds.center),
          };
        })
        .filter((entry): entry is { candidate: ValueCandidate; nutrient: CommercialNutrient; distance: number } =>
          entry !== null,
        )
      : [];

    const genericCandidates = anchorUnit ? [] : values
      .filter((candidate) => {
        const valueY = centerY(candidate.amountBox);
        return valueY >= rowTop
          && valueY < rowBottom
          && Math.abs(valueY - currentY) <= maxVerticalDistance
          && candidate.amountBox.minX >= anchor.box.maxX - 8;
      })
      .map((candidate) => ({
        candidate,
        nutrient: parseCandidateForAnchor(anchor, candidate),
        distance: Math.abs(centerY(candidate.amountBox) - currentY),
      }))
      .filter((entry): entry is { candidate: ValueCandidate; nutrient: CommercialNutrient; distance: number } =>
        entry.nutrient !== null,
      );

    const candidates = [...directCandidates, ...genericCandidates]
      .sort((a, b) => a.distance - b.distance || a.candidate.amountBox.minX - b.candidate.amountBox.minX);

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
