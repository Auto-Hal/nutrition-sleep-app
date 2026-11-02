"use client";
import { nutrientUnitLabel } from "@/lib/nutrition/presentation";
import { useState } from "react";
import {
  editedNutrientPayload,
  nutrientFormValues,
  STANDARD_NUTRIENT_DEFINITIONS,
  type CatalogItem,
  type NutrientMetadata,
  type NutrientValue,
} from "@/lib/nutrition/catalog";
import {
  applyManualCalculations,
  type ManualCalculation,
} from "@/lib/nutrition/manual-calculations";
import { nutrientWriteSchema } from "@/lib/nutrition/nutrient-schema";
import { NutrientCalculationActions } from "@/components/nutrient-calculation-actions";
export type ManualProductValues = {
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  nutrients: NutrientValue[];
  confirm_verified_overwrite: boolean;
};
export function ProductManualEditor({
  item,
  onSave,
  onClose,
  busy,
}: {
  item: CatalogItem | null;
  onSave: (value: ManualProductValues) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(item?.name ?? ""),
    [brand, setBrand] = useState(item?.brand ?? ""),
    [size, setSize] = useState(String(item?.serving_size ?? 100)),
    [unit, setUnit] = useState(item?.serving_unit ?? "g");
  const [values, setValues] = useState(() => nutrientFormValues(item)),
    [origin, setOrigin] =
      useState<NonNullable<NutrientMetadata["value_origin"]>>("user_reported"),
    [source, setSource] = useState("");
  const [reviewed, setReviewed] = useState(false),
    [overwrite, setOverwrite] = useState(false),
    [calculations, setCalculations] = useState<ManualCalculation[]>([]),
    [error, setError] = useState<string | null>(null);
  const basisChanged = Boolean(
    item &&
      (Number(size) !== item.serving_size || unit.trim() !== item.serving_unit),
  );
  const getNutrients = () =>
    editedNutrientPayload(
      values,
      item,
      origin,
      source.trim() || null,
      basisChanged,
    );
  function result(c: ManualCalculation) {
    setCalculations((old) => [
      ...old.filter((x) => x.nutrient.code !== c.nutrient.code),
      c,
    ]);
    setValues((old) => ({
      ...old,
      [c.nutrient.code]:
        c.nutrient.amount === null ? "" : String(c.nutrient.amount),
    }));
  }
  function clear(code: string) {
    setCalculations((old) => old.filter((c) => c.nutrient.code !== code));
    setValues((old) => ({ ...old, [code]: "" }));
  }
  async function save() {
    try {
      if (
        !name.trim() ||
        !Number.isFinite(Number(size)) ||
        Number(size) <= 0 ||
        !unit.trim()
      )
        throw new Error("商品名・基準量・単位を確認してください。");
      if (basisChanged && !reviewed)
        throw new Error("基準量変更後の栄養値をすべて確認してください。");
      if (
        item?.nutrients.some((n) => n.quality === "user_verified") &&
        !overwrite
      )
        throw new Error("確認済みの現在値を更新することを確認してください。");
      const nutrients = applyManualCalculations(getNutrients(), calculations);
      if (nutrients.some((n) => !nutrientWriteSchema.safeParse(n).success))
        throw new Error(
          "栄養値の定義・出典URL・計算根拠を確認してください。公式資料にはURLが必要です。",
        );
      await onSave({
        name: name.trim(),
        brand: brand.trim() || null,
        serving_size: Number(size),
        serving_unit: unit.trim(),
        nutrients,
        confirm_verified_overwrite: overwrite,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした。");
    }
  }
  return (
    <div className="form library-form stack" aria-label="写真なしの商品編集">
      <h3>{item ? "登録済み商品を手動編集" : "写真なしで商品を登録"}</h3>
      <p className="muted">
        すべて表示基準量あたりです。空欄は不明、0は確認したゼロ。変更しない値の出典・推定情報は維持します。
      </p>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="manual-product-name">商品名</label>
          <input
            id="manual-product-name"
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="manual-product-brand">ブランド（任意）</label>
          <input
            id="manual-product-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="manual-product-size">表示基準量</label>
          <input
            id="manual-product-size"
            type="number"
            min="0.001"
            step="0.001"
            value={size}
            onChange={(e) => {
              setSize(e.target.value);
              setReviewed(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="manual-product-unit">表示基準単位</label>
          <input
            id="manual-product-unit"
            maxLength={32}
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value);
              setReviewed(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="manual-product-origin">変更する栄養値の出典</label>
          <select
            id="manual-product-origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as typeof origin)}
          >
            <option value="user_reported">ユーザー申告・入力</option>
            <option value="label">現物の栄養表示</option>
            <option value="measured">実測値</option>
            <option value="official">確認した公式資料</option>
            <option value="database">食品データベース</option>
            <option value="estimated">推定値</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="manual-product-source">変更値の出典URL（任意）</label>
          <input
            id="manual-product-source"
            type="url"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
      </div>
      {basisChanged && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          新しい基準量・単位に対してすべての栄養値を確認しました（過去の食事は変わりません）
        </label>
      )}
      <fieldset className="nutrient-fieldset">
        <legend>標準29項目</legend>
        <div className="nutrient-grid">
          {STANDARD_NUTRIENT_DEFINITIONS.map((d) => (
            <div className="field" key={d.code}>
              <label htmlFor={`manual-product-${d.code}`}>
                {d.label}（{nutrientUnitLabel(d.unit)}）
              </label>
              <input
                id={`manual-product-${d.code}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={values[d.code] ?? ""}
                onChange={(e) =>
                  setValues((old) => ({ ...old, [d.code]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      </fieldset>
      <details>
        <summary>内部管理用ナトリウム</summary>
        <div className="field">
          <label htmlFor="manual-product-sodium">ナトリウム（mg）</label>
          <input
            id="manual-product-sodium"
            type="number"
            min="0"
            step="any"
            value={values.sodium ?? ""}
            onChange={(e) =>
              setValues((old) => ({ ...old, sodium: e.target.value }))
            }
          />
        </div>
        <p>食塩相当量と合算しません。</p>
      </details>
      <NutrientCalculationActions
        getNutrients={getNutrients}
        calculations={calculations}
        onResult={result}
        onClear={clear}
      />
      {item?.nutrients.some((n) => n.quality === "user_verified") && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          確認済みの現在値をこの内容で更新します（過去の食事は維持）
        </label>
      )}
      <div className="form-actions">
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          入力内容を確認して端末に保存
        </button>
        <button
          className="button ghost"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          編集を閉じる
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
