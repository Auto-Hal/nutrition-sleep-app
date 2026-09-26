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


  it("does not borrow a neighboring row value when OCR row grouping is wrong", () => {
    const words: OcrWord[] = [
      word("たんぱく質", 20, 110, 150),
      word("5.2", 360, 112, 55),
      word("g", 435, 112, 20),
      word("脂質", 20, 160, 70),
      word("2.6", 360, 160, 55),
      word("g", 435, 160, 20),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "たんぱく質 2.6 g\n5.2 g\n脂質",
      width: 600,
      height: 260,
      words,
      // Simulate a bad OCR visual-line association even though word coordinates are correct.
      lines: [
        {
          text: "たんぱく質 2.6 g",
          words: [words[0], words[4], words[5]],
          box: { minX: 20, minY: 110, maxX: 455, maxY: 188 },
        },
        {
          text: "5.2 g",
          words: [words[1], words[2]],
          box: { minX: 360, minY: 112, maxX: 455, maxY: 140 },
        },
        {
          text: "脂質",
          words: [words[3]],
          box: { minX: 20, minY: 160, maxX: 90, maxY: 188 },
        },
      ],
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "protein", amount: 5.2, unit: "g" },
      { code: "fat", amount: 2.6, unit: "g" },
    ]));
  });

  it("leaves an anchored nutrient unknown instead of stealing the next row value", () => {
    const words: OcrWord[] = [
      word("たんぱく質", 20, 110, 150),
      word("脂質", 20, 160, 70),
      word("2.6", 360, 160, 55),
      word("g", 435, 160, 20),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "たんぱく質\n脂質 2.6 g",
      width: 600,
      height: 260,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients.some((nutrient) => nutrient.code === "protein")).toBe(false);
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "fat", amount: 2.6, unit: "g" },
    ]));
  });


  it("accepts common OCR confusion in kcal units without weakening row pairing", () => {
    const words: OcrWord[] = [
      word("エネルギー", 20, 70, 150),
      word("180", 360, 70, 60),
      word("kcaI", 435, 70, 70),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "エネルギー 180 kcaI",
      width: 600,
      height: 180,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 180, unit: "kcal" },
    ]));
  });


  it("recovers split Japanese energy labels and one-character kcal OCR noise", () => {
    const words: OcrWord[] = [
      word("エ", 20, 70, 24),
      word("ネ", 48, 70, 24),
      word("ル", 76, 70, 24),
      word("ギ", 104, 70, 24),
      word("一", 132, 70, 24),
      word("180", 360, 70, 60),
      word("kca|", 435, 70, 70),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "エ ネ ル ギ 一 180 kca|",
      width: 600,
      height: 180,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 180, unit: "kcal" },
    ]));
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

  it("parses Japanese table rows whose units are attached to labels without stealing the 40 g serving basis", () => {
    const words: OcrWord[] = [
      word("栄養成分表示", 20, 20, 180),
      word("1食分(40g)当たり", 240, 20, 210),
      word("エネルギー(kcal)", 20, 70, 220), word("164", 360, 70, 60),
      word("たんぱく質(g)", 20, 110, 220), word("2.6", 360, 110, 55),
      word("脂質(g)", 20, 150, 160), word("5.0", 360, 150, 55),
      word("炭水化物(g)", 20, 190, 200), word("30.2", 360, 190, 65),
      word("食物繊維(g)", 20, 230, 200), word("4.4", 360, 230, 55),
      word("食塩相当量(g)", 20, 270, 220), word("0.25", 360, 270, 65),
      word("カルシウム(mg)", 20, 310, 220), word("51", 360, 310, 45),
      word("鉄(mg)", 20, 350, 140), word("4.2", 360, 350, 55),
      word("ビタミンB1(mg)", 20, 390, 220), word("0.29", 360, 390, 65),
      word("ビタミンB2(mg)", 20, 430, 220), word("0.11", 360, 430, 65),
      word("ビタミンB6(mg)", 20, 470, 220), word("0.36", 360, 470, 65),
      word("ビタミンB12(μg)", 20, 510, 230), word("0.32", 360, 510, 65),
      word("ビタミンC(mg)", 20, 550, 200), word("24", 360, 550, 45),
      word("ビタミンD(μg)", 20, 590, 200), word("2.6", 360, 590, 55),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: [
        "栄養成分表示 1食分(40g)当たり",
        "エネルギー(kcal) 164",
        "たんぱく質(g) 2.6",
        "脂質(g) 5.0",
        "炭水化物(g) 30.2",
        "食物繊維(g) 4.4",
        "食塩相当量(g) 0.25",
        "カルシウム(mg) 51",
        "鉄(mg) 4.2",
        "ビタミンB1(mg) 0.29",
        "ビタミンB2(mg) 0.11",
        "ビタミンB6(mg) 0.36",
        "ビタミンB12(μg) 0.32",
        "ビタミンC(mg) 24",
        "ビタミンD(μg) 2.6",
      ].join("\n"),
      width: 520,
      height: 660,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.basis).toEqual({ serving_size: 1, serving_unit: "食" });
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "energy", amount: 164, unit: "kcal" },
      { code: "protein", amount: 2.6, unit: "g" },
      { code: "fat", amount: 5, unit: "g" },
      { code: "carbohydrate", amount: 30.2, unit: "g" },
      { code: "fiber", amount: 4.4, unit: "g" },
      { code: "salt_equivalent", amount: 0.25, unit: "g" },
      { code: "calcium", amount: 51, unit: "mg" },
      { code: "iron", amount: 4.2, unit: "mg" },
      { code: "vitamin_b1", amount: 0.29, unit: "mg" },
      { code: "vitamin_b2", amount: 0.11, unit: "mg" },
      { code: "vitamin_b6", amount: 0.36, unit: "mg" },
      { code: "vitamin_b12", amount: 0.32, unit: "ug" },
      { code: "vitamin_c", amount: 24, unit: "mg" },
      { code: "vitamin_d", amount: 2.6, unit: "ug" },
    ]));
    expect(parsed.nutrients.find((nutrient) => nutrient.code === "protein")?.amount).not.toBe(40);
    expect(parsed.diagnostics.basis_detected).toBe(true);
  });


  it("does not let a missing OCR row make the previous unit-attached anchor borrow the next row value", () => {
    const words: OcrWord[] = [
      word("エネルギー(kcal)", 20, 70, 220),
      // Simulate unreadable/missing energy amount on the right side.
      word("2.6", 360, 110, 55),
      word("g", 435, 110, 20),
      word("炭水化物(g)", 20, 190, 200),
      word("30.2", 360, 190, 65),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "エネルギー(kcal)\n2.6 g\n炭水化物(g) 30.2",
      width: 520,
      height: 260,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients.some((nutrient) => nutrient.code === "energy")).toBe(false);
    expect(parsed.nutrients).toEqual(expect.arrayContaining([
      { code: "carbohydrate", amount: 30.2, unit: "g" },
    ]));
  });


  it("does not map the next unsupported folate row into vitamin D when the D value is unreadable", () => {
    const words: OcrWord[] = [
      word("ビタミンD(μg)", 20, 70, 220),
      // Vitamin D amount intentionally missing.
      word("葉酸(μg)", 20, 110, 160),
      word("80", 360, 110, 45),
    ];

    const document: OcrDocument = {
      provider: "google_cloud_vision",
      text: "ビタミンD(μg)\n葉酸(μg) 80",
      width: 520,
      height: 180,
      words,
      lines: groupOcrWordsIntoLines(words),
    };

    const parsed = parseNutritionLabelDocument(document);

    expect(parsed.nutrients.some((nutrient) => nutrient.code === "vitamin_d")).toBe(false);
  });

});
