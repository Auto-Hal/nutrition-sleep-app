"use client";

import { parseNutritionLabelText } from "@/lib/products/label-ocr";

export type OcrProgress = {
  status: string;
  progress: number | null;
};

function nutrientScore(text: string) {
  const parsed = parseNutritionLabelText(text);
  const basisBonus = parsed.basis.serving_unit === "serving" ? 0 : 1;
  return parsed.nutrients.length * 10 + basisBonus;
}

export async function recognizeNutritionLabel(
  image: File,
  onProgress?: (progress: OcrProgress) => void,
) {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker(["jpn", "eng"], 1, {
    logger(message) {
      const progress = typeof message.progress === "number" ? message.progress : null;
      onProgress?.({ status: message.status ?? "processing", progress });
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });

    const first = await worker.recognize(image, { rotateAuto: true });
    if (parseNutritionLabelText(first.data.text).nutrients.length >= 5) {
      return first.data.text;
    }

    onProgress?.({ status: "retrying-layout", progress: null });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const second = await worker.recognize(image, { rotateAuto: true });

    return nutrientScore(second.data.text) > nutrientScore(first.data.text)
      ? second.data.text
      : first.data.text;
  } finally {
    await worker.terminate();
  }
}
