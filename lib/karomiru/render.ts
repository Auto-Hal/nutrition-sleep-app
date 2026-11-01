import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import { transferRows, type TransferPayload } from "@/lib/karomiru/model";
export const PNG_RENDERER_VERSION = "nutrition-png-v1";
export function transferImageLayout(payload: TransferPayload) {
  const rows = transferRows(payload),
    all = payload.mode === "all29",
    width = all ? 1440 : 1200,
    font = all ? 44 : 48,
    rowHeight = all ? 76 : 88;
  return {
    ...rows,
    width,
    height: 350 + Math.max(1, rows.included.length) * rowHeight + 80,
    font,
    rowHeight,
    headerHeight: 350,
  };
}
export async function renderTransferPng(
  payload: TransferPayload,
): Promise<{ blob: Blob; width: number; height: number }> {
  const layout = transferImageLayout(payload);
  if (layout.included.length === 0)
    throw new Error(
      "出力できる既知の栄養値がありません。食品の値と出典を確認してください。",
    );
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("この端末で画像を生成できませんでした。");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.font = "bold 48px sans-serif";
  ctx.fillText("栄養成分表示", 64, 72);
  ctx.font = "28px sans-serif";
  ctx.fillText("アプリの摂取記録に基づく共有表", 64, 126);
  const name = payload.menu_name;
  ctx.font = "bold 36px sans-serif";
  // The name is copied separately; keep the OCR header short and deterministic.
  let shortName = name;
  while (
    ctx.measureText(shortName).width > layout.width - 128 &&
    shortName.length > 0
  )
    shortName = shortName.slice(0, -1);
  if (shortName !== name) shortName = shortName.slice(0, -1) + "…";
  ctx.fillText(shortName, 64, 196);
  ctx.font = "32px sans-serif";
  const basis = payload.basis.already_scaled_snapshot
    ? payload.basis.quantity_kind === "entire_meal"
      ? "表示対象：記録した食事全体"
      : "表示対象：記録した食品の摂取量"
    : `表示対象：${payload.basis.selected_quantity} ${payload.basis.selected_unit}`;
  ctx.fillText(basis, 64, 258);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 306);
  ctx.lineTo(layout.width - 64, 306);
  ctx.stroke();
  layout.included.forEach((row, index) => {
    const definition = STANDARD_NUTRIENT_DEFINITIONS.find(
      (n) => n.code === row.code,
    )!;
    const unit =
      row.unit === "ug_rae" ? "µg RAE" : row.unit === "ug" ? "µg" : row.unit;
    const y = layout.headerHeight + index * layout.rowHeight;
    ctx.font = `${layout.font}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(definition.label, 64, y);
    ctx.font = `${layout.font}px sans-serif`;
    ctx.textAlign = "right";
    const value = `${row.display_amount} ${unit}`;
    // A long exact fraction is omitted at the model boundary; do not squeeze
    // readable text or overwrite a positive amount with zero to make it fit.
    if (ctx.measureText(value).width > layout.width * 0.53)
      throw new Error(
        `${definition.label}の数値が長いため画像化できません。対象量を確認してください。`,
      );
    ctx.fillText(value, layout.width - 64, y);
  });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("PNGを書き出せませんでした。")),
      "image/png",
    ),
  );
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width: layout.width, height: layout.height };
}
