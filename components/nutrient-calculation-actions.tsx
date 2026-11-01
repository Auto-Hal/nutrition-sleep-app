"use client";
import { useId, useState } from "react";
import {
  explicitCalculation,
  type ManualCalculation,
} from "@/lib/nutrition/manual-calculations";
import type { NutrientValue } from "@/lib/nutrition/catalog";
export function NutrientCalculationActions({
  getNutrients,
  calculations,
  onResult,
  onClear,
}: {
  getNutrients: () => NutrientValue[];
  calculations: ManualCalculation[];
  onResult: (value: ManualCalculation) => void;
  onClear: (code: string) => void;
}) {
  const id = useId(),
    [sameLabel, setSameLabel] = useState(false),
    [error, setError] = useState<string | null>(null);
  function calculate(code: "salt_equivalent" | "carbohydrate_excluding_fiber") {
    try {
      onResult(explicitCalculation(code, getNutrients(), sameLabel));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "計算できませんでした。");
    }
  }
  return (
    <details className="inline-help">
      <summary>不明な食塩相当量・糖質を根拠から算出</summary>
      <p className="muted">
        既知値は上書きしません。計算値・元の出典・推定情報を保存します。
      </p>
      <button
        className="button secondary"
        type="button"
        onClick={() => calculate("salt_equivalent")}
      >
        ナトリウムmg × 2.54 ÷ 1000で食塩相当量を算出
      </button>
      <label className="checkbox-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={sameLabel}
          onChange={(e) => setSameLabel(e.target.checked)}
        />
        炭水化物は食物繊維を含む日本の表示で、食物繊維と同じ資料・同じ基準量です
      </label>
      <p className="muted">
        出典は共通のURL、または「現物の栄養表示」を選んで確認してください。糖類や欧州の利用可能炭水化物は差し引き計算に使いません。
      </p>
      <button
        className="button secondary"
        type="button"
        disabled={!sameLabel}
        onClick={() => calculate("carbohydrate_excluding_fiber")}
      >
        総炭水化物 − 食物繊維で糖質を算出
      </button>
      {calculations.map((c) => (
        <p className="notice" key={c.nutrient.code}>
          {c.nutrient.code === "salt_equivalent" ? "食塩相当量" : "糖質"}：
          {c.nutrient.amount === null
            ? "保存精度未満・判定保留"
            : `${c.nutrient.amount} g`}
          {c.nutrient.contains_estimates
            ? "（推定値を元に計算）"
            : "（計算値）"}
          <button
            className="button ghost"
            type="button"
            onClick={() => onClear(c.nutrient.code)}
          >
            計算結果を解除
          </button>
        </p>
      ))}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </details>
  );
}
