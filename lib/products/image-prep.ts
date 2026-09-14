"use client";

const MAX_EDGE = 2200;
const MAX_OUTPUT_BYTES = 3_000_000;

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("画像を変換できませんでした。"));
    }, "image/jpeg", quality);
  });
}

export async function prepareNutritionLabelImage(file: File) {
  const image = await loadImage(file);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("画像を処理できませんでした。");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.92, 0.86, 0.78, 0.7]) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= MAX_OUTPUT_BYTES) {
      return new File([blob], "nutrition-label.jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }
  }

  throw new Error("画像サイズを3MB未満にできませんでした。栄養成分表示へもう少し近づいて撮影してください。");
}
