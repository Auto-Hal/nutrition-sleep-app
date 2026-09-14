"use client";

export type OcrProgress = {
  status: string;
  progress: number | null;
};

export async function recognizeNutritionLabel(
  image: File,
  onProgress?: (progress: OcrProgress) => void,
) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["jpn", "eng"], 1, {
    logger(message) {
      const progress = typeof message.progress === "number" ? message.progress : null;
      onProgress?.({ status: message.status ?? "processing", progress });
    },
  });

  try {
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}
