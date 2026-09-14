import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { groupOcrWordsIntoLines, type OcrDocument, type OcrWord } from "@/lib/products/ocr-document";
import { parseNutritionLabelDocument } from "@/lib/products/nutrition-label-parser";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function word(text: string, x: number, y: number, width = 90, height = 28): OcrWord {
  return {
    text,
    confidence: 0.98,
    box: { minX: x, minY: y, maxX: x + width, maxY: y + height },
  };
}

describe("Phase 3 Cloud Vision nutrition extraction", () => {
  it("groups OCR words into visual rows before nutrition parsing", () => {
    const lines = groupOcrWordsIntoLines([
      word("180", 360, 100, 60),
      word("エネルギー", 20, 100, 150),
      word("kcal", 440, 100, 70),
      word("脂質", 20, 160, 80),
      word("2.6", 360, 160, 55),
      word("g", 440, 160, 20),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toContain("エネルギー");
    expect(lines[0].text).toContain("180");
    expect(lines[1].text).toContain("脂質");
    expect(lines[1].text).toContain("2.6");
  });

  it("extracts the Pasco acceptance values and 1-sheet basis from table-like OCR rows", () => {
    const words: OcrWord[] = [
      word("栄養成分表示", 20, 20, 180), word("(1枚当たり)", 220, 20, 150),
      word("エネルギー", 20, 70, 150), word("180", 360, 70, 60), word("kcal", 435, 70, 70),
      word("たんぱく質", 20, 115, 150), word("5.2", 360, 115, 55), word("g", 435, 115, 20),
      word("脂質", 20, 160, 70), word("2.6", 360, 160, 55), word("g", 435, 160, 20),
      word("炭水化物", 20, 205, 140), word("34.0", 360, 205, 65), word("g", 435, 205, 20),
      word("食塩相当量", 20, 250, 150), word("0.6", 360, 250, 55), word("g", 435, 250, 20),
    ];
    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "栄養成分表示（1枚当たり）\nエネルギー 180 kcal\nたんぱく質 5.2 g\n脂質 2.6 g\n炭水化物 34.0 g\n食塩相当量 0.6 g",
      width: 600,
      height: 360,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.basis).toEqual({ serving_size: 1, serving_unit: "枚" });
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 180, unit: "kcal" },
      { code: "protein", amount: 5.2, unit: "g" },
      { code: "fat", amount: 2.6, unit: "g" },
      { code: "carbohydrate", amount: 34, unit: "g" },
      { code: "salt_equivalent", amount: 0.6, unit: "g" },
    ]));
    expect(parsed.diagnostics.matched_nutrient_count).toBe(5);
    expect(parsed.diagnostics.basis_detected).toBe(true);
  });

  it("uses a server-only synchronous Cloud Vision route without persisting images", () => {
    const route = read("app/api/ocr/nutrition-label/route.ts");
    const adapter = read("lib/products/google-cloud-vision.ts");
    const prep = read("lib/products/image-prep.ts");

    expect(route).toContain("isAllowedOrigin");
    expect(route).toContain("getAppSession");
    expect(route).toContain("MAX_IMAGE_BYTES = 3_200_000");
    expect(route).toContain("recognizeWithGoogleCloudVision");
    expect(adapter).toContain("DOCUMENT_TEXT_DETECTION");
    expect(adapter).toContain('languageHints: ["ja", "en"]');
    expect(adapter).toContain("GOOGLE_CLOUD_VISION_API_KEY");
    expect(adapter).not.toContain("console.");
    expect(prep).toContain("MAX_OUTPUT_BYTES = 3_000_000");
    expect(prep).toContain('type: "image/jpeg"');
  });
});
