"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import { prepareNutritionLabelImage } from "@/lib/products/image-prep";
import type { CommercialNutrient, ExternalProductCandidate } from "@/lib/products/open-food-facts";

type ProductItemType = "product" | "supplement";
type SourceType = "label_ocr" | "external_database";

type DraftCandidate = {
  barcode: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  serving_size: number;
  serving_unit: string;
  package_amount: number | null;
  package_unit: string | null;
  source_type: SourceType;
  source_provider: string;
  source_uri: string | null;
  source_observed_at: string;
  nutrients: CommercialNutrient[];
};

type LocalProductItem = {
  id: string;
  item_type: ProductItemType;
  name: string;
  brand: string | null;
  serving_size: number;
  serving_unit: string;
  active: boolean;
  revision: number;
  product: {
    barcode: string;
    manufacturer: string | null;
    package_amount: number | null;
    package_unit: string | null;
    source_type: "manufacturer_official" | "label_ocr" | "external_database";
    source_provider: string;
    source_uri: string | null;
    source_observed_at: string;
    confirmed_at: string;
  };
  nutrients: Array<{
    nutrient_code: NutrientCode;
    amount: number | null;
    unit: string;
    provenance: string;
    quality: string;
  }>;
};

type ResolveResponse =
  | { status: "local"; item: LocalProductItem }
  | { status: "external"; candidate: ExternalProductCandidate }
  | { status: "not_found"; fallback: "ocr" }
  | { status: "external_unavailable"; reason: string; fallback: "ocr" }
  | { error: string };

type OcrResponse = {
  provider: string;
  source_observed_at: string;
  basis: { serving_size: number; serving_unit: string };
  nutrients: CommercialNutrient[];
  diagnostics: {
    matched_nutrient_count: number;
    basis_detected: boolean;
  };
  error?: string;
  code?: string;
};

type NutrientDraft = Record<NutrientCode, string>;

function nutrientDraft(values: CommercialNutrient[]): NutrientDraft {
  return Object.fromEntries(
    NUTRIENT_DEFINITIONS.map(({ code }) => {
      const nutrient = values.find((value) => value.code === code);
      return [code, nutrient ? String(nutrient.amount) : ""];
    }),
  ) as NutrientDraft;
}

function nutrientPayload(values: NutrientDraft): CommercialNutrient[] {
  return NUTRIENT_DEFINITIONS.flatMap((definition) => {
    const raw = values[definition.code].trim();
    if (!raw) return [];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${definition.label}の値を確認してください。`);
    }
    return [{ code: definition.code, amount, unit: definition.unit }];
  });
}

export function ProductIngestion({ onSaved }: { onSaved: () => Promise<void> }) {
  const [barcode, setBarcode] = useState("");
  const [itemType, setItemType] = useState<ProductItemType>("product");
  const [externalCandidate, setExternalCandidate] = useState<ExternalProductCandidate | null>(null);
  const [localItem, setLocalItem] = useState<LocalProductItem | null>(null);
  const [ocrCandidate, setOcrCandidate] = useState<DraftCandidate | null>(null);
  const [ocrNutrients, setOcrNutrients] = useState<NutrientDraft>(() => nutrientDraft([]));
  const [scannerOpen, setScannerOpen] = useState(false);
  const [needsOcr, setNeedsOcr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);
  const ocrPreviewRef = useRef<string | null>(null);

  const replaceOcrPreview = useCallback((file: File | null) => {
    if (ocrPreviewRef.current) URL.revokeObjectURL(ocrPreviewRef.current);
    const next = file ? URL.createObjectURL(file) : null;
    ocrPreviewRef.current = next;
    setOcrPreviewUrl(next);
  }, [replaceOcrPreview]);

  useEffect(() => () => {
    if (ocrPreviewRef.current) URL.revokeObjectURL(ocrPreviewRef.current);
  }, []);

  const resetResolution = useCallback(() => {
    setExternalCandidate(null);
    setLocalItem(null);
    setOcrCandidate(null);
    setOcrNutrients(nutrientDraft([]));
    replaceOcrPreview(null);
    setNeedsOcr(false);
    setMessage(null);
    setError(null);
  }, []);

  const resolveBarcode = useCallback(async (value: string) => {
    const normalized = normalizeBarcode(value);
    setBarcode(normalized);
    resetResolution();

    if (!isValidGtin(normalized)) {
      setError("JAN / EAN / UPC / GTINの番号を確認してください。");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/products/resolve?barcode=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const result = await response.json() as ResolveResponse;
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "商品を検索できませんでした。");
      }

      if (result.status === "local") {
        setLocalItem(result.item);
        setItemType(result.item.item_type);
        setMessage(result.item.active
          ? `「${result.item.name}」はLibraryに登録済みです。現物ラベルで更新する場合のみ下から撮影してください。`
          : `「${result.item.name}」はLibraryに登録済みですが、現在は無効です。`);
        return;
      }

      if (result.status === "external") {
        setExternalCandidate(result.candidate);
        setMessage("外部商品DBに候補が見つかりました。内容を確認してから保存してください。");
        return;
      }

      setNeedsOcr(true);
      setMessage(result.status === "external_unavailable"
        ? "外部商品DBを利用できません。現物ラベルから登録できます。"
        : "商品DBに見つかりませんでした。現物ラベルを撮影してください。");
    } catch (requestError) {
      setNeedsOcr(false);
      setError(requestError instanceof Error ? requestError.message : "商品検索に失敗しました。");
    } finally {
      setBusy(false);
    }
  }, [resetResolution]);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;

    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatOneDReader();
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          },
          videoRef.current,
          (result, error, scanControls) => {
            if (!result) {
              void error;
              return;
            }
            scanControls.stop();
            stopScannerRef.current = null;
            setScannerOpen(false);
            void resolveBarcode(result.getText());
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        stopScannerRef.current = () => controls.stop();
      } catch {
        if (!cancelled) {
          setScannerOpen(false);
          setError("カメラを開始できませんでした。カメラ権限を確認するか、番号入力を使用してください。");
        }
      }
    })();

    return () => {
      cancelled = true;
      stopScannerRef.current?.();
      stopScannerRef.current = null;
    };
  }, [scannerOpen, resolveBarcode]);

  async function readBarcodePhoto(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatOneDReader();
      const url = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(url);
        await resolveBarcode(result.getText());
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      setError("バーコードを写真から読み取れませんでした。バーコード全体が大きく、水平に写るよう撮り直してください。");
    } finally {
      setBusy(false);
    }
  }

  async function readLabel(file: File) {
    const normalized = normalizeBarcode(barcode);
    if (!isValidGtin(normalized)) {
      setError("先に商品バーコードを読み取ってください。");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage("画像を最適化しています。元画像は保存しません。");

    try {
      const prepared = await prepareNutritionLabelImage(file);
      replaceOcrPreview(prepared);
      setMessage("Google Cloud Visionで栄養成分表示を解析しています…");

      const body = new FormData();
      body.set("image", prepared);
      const response = await fetch("/api/ocr/nutrition-label", {
        method: "POST",
        body,
      });
      const parsed = await response.json() as OcrResponse;
      if (!response.ok) {
        throw new Error(parsed.error ?? "Cloud OCRに失敗しました。");
      }

      const draft: DraftCandidate = {
        barcode: normalized,
        name: externalCandidate?.name ?? localItem?.name ?? "",
        brand: externalCandidate?.brand ?? localItem?.brand ?? null,
        manufacturer: externalCandidate?.manufacturer ?? localItem?.product.manufacturer ?? null,
        serving_size: parsed.basis.serving_size,
        serving_unit: parsed.basis.serving_unit,
        package_amount: externalCandidate?.package_amount ?? localItem?.product.package_amount ?? null,
        package_unit: externalCandidate?.package_unit ?? localItem?.product.package_unit ?? null,
        source_type: "label_ocr",
        source_provider: parsed.provider,
        source_uri: null,
        source_observed_at: parsed.source_observed_at,
        nutrients: parsed.nutrients,
      };
      setOcrCandidate(draft);
      setOcrNutrients(nutrientDraft(parsed.nutrients));
      setNeedsOcr(false);

      const basisMessage = parsed.diagnostics.basis_detected
        ? `基準量: ${parsed.basis.serving_size} ${parsed.basis.serving_unit}`
        : "基準量は読み取れなかったため確認してください";
      setMessage(`Cloud OCRで${parsed.diagnostics.matched_nutrient_count}項目を抽出しました（${basisMessage}）。画像と照合し、誤りだけ修正して保存してください。`);
    } catch (requestError) {
      setNeedsOcr(true);
      setError(requestError instanceof Error ? requestError.message : "OCRに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function save(candidate: DraftCandidate | ExternalProductCandidate, nutrients: CommercialNutrient[]) {
    setBusy(true);
    setError(null);
    try {
      const common = {
        name: candidate.name,
        brand: candidate.brand,
        serving_size: candidate.serving_size,
        serving_unit: candidate.serving_unit,
        manufacturer: candidate.manufacturer,
        package_amount: candidate.package_amount,
        package_unit: candidate.package_unit,
        source_type: candidate.source_type,
        source_provider: candidate.source_provider,
        source_uri: candidate.source_uri,
        source_observed_at: candidate.source_observed_at,
        nutrients,
      };
      const updatingLocal = Boolean(
        localItem
        && localItem.product.barcode === candidate.barcode
        && candidate.source_type === "label_ocr",
      );
      const response = await fetch(updatingLocal ? `/api/products/${localItem!.id}` : "/api/products", {
        method: updatingLocal ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updatingLocal
          ? { ...common, expected_revision: localItem!.revision, active: localItem!.active }
          : { ...common, item_type: itemType, barcode: candidate.barcode, idempotency_key: crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "商品を保存できませんでした。");

      await onSaved();
      setExternalCandidate(null);
      setLocalItem(null);
      setOcrCandidate(null);
      replaceOcrPreview(null);
      setNeedsOcr(false);
      setMessage("Libraryに保存しました。次回から同じバーコードは自前DBから解決します。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "商品を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function saveOcr() {
    if (!ocrCandidate) return;
    if (!ocrCandidate.name.trim()) {
      setError("商品名を入力してください。");
      return;
    }
    try {
      const nutrients = nutrientPayload(ocrNutrients);
      await save({ ...ocrCandidate, name: ocrCandidate.name.trim() }, nutrients);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "栄養値を確認してください。");
    }
  }

  return (
    <section className="card stack" aria-labelledby="product-ingestion-title">
      <div className="section-heading">
        <div>
          <h2 id="product-ingestion-title">市販品・サプリを追加</h2>
          <p className="muted">バーコード → 登録済みLibrary → 外部商品DB → 現物ラベルOCRの順で解決します。</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="commercial-item-type">種類</label>
          <select id="commercial-item-type" value={itemType} onChange={(event) => setItemType(event.target.value as ProductItemType)}>
            <option value="product">市販品</option>
            <option value="supplement">サプリ</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="product-barcode">JAN / EAN / UPC / GTIN</label>
          <input
            id="product-barcode"
            inputMode="numeric"
            autoComplete="off"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            placeholder="バーコードを読み取るか入力"
          />
        </div>
      </div>

      <div className="form-actions">
        <button className="button" type="button" onClick={() => setScannerOpen(true)} disabled={busy || scannerOpen}>ライブカメラで読む</button>
        <label className="button secondary">
          バーコードを撮影
          <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readBarcodePhoto(file);
            event.currentTarget.value = "";
          }} />
        </label>
        <button className="button secondary" type="button" onClick={() => void resolveBarcode(barcode)} disabled={busy}>番号で検索</button>
      </div>

      {scannerOpen && (
        <div className="stack" aria-live="polite">
          <div className="barcode-camera-shell">
            <video ref={videoRef} className="barcode-video" muted playsInline />
            <div className="barcode-guide" aria-hidden="true">
              <span />
            </div>
          </div>
          <p className="muted">バーコードを横向きにし、中央の枠いっぱいに入れてください。合わせにくい場合は「バーコードを撮影」の方が確実です。</p>
          <button className="button ghost" type="button" onClick={() => setScannerOpen(false)}>カメラを閉じる</button>
        </div>
      )}

      {localItem && !ocrCandidate && (
        <div className="stack">
          <div className="catalog-row">
            <div>
              <strong>{localItem.name}</strong>
              <div className="muted">{localItem.brand ?? "ブランド不明"} · 登録済みLibrary</div>
              <div className="muted">現在のsource: {localItem.product.source_type}</div>
            </div>
          </div>
          <label className="button secondary">
            現物ラベルで更新
            <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readLabel(file);
              event.currentTarget.value = "";
            }} />
          </label>
        </div>
      )}

      {externalCandidate && !ocrCandidate && (
        <div className="stack">
          <div className="catalog-row">
            <div>
              <strong>{externalCandidate.name}</strong>
              <div className="muted">{externalCandidate.brand ?? "ブランド不明"} · 100 {externalCandidate.serving_unit}基準</div>
              <div className="muted">Open Food Facts · 外部DB（未検証）</div>
            </div>
          </div>
          <div className="nutrient-grid">
            {externalCandidate.nutrients.map((nutrient) => {
              const definition = NUTRIENT_DEFINITIONS.find(({ code }) => code === nutrient.code);
              return <div key={nutrient.code}><strong>{definition?.label ?? nutrient.code}</strong><div className="muted">{nutrient.amount} {nutrient.unit}</div></div>;
            })}
          </div>
          <div className="form-actions">
            <button className="button" type="button" disabled={busy} onClick={() => void save(externalCandidate, externalCandidate.nutrients)}>この候補を保存</button>
            <label className="button secondary">
              現物ラベルを優先
              <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readLabel(file);
                event.currentTarget.value = "";
              }} />
            </label>
          </div>
        </div>
      )}

      {needsOcr && !ocrCandidate && (
        <div className="stack">
          <p className="muted">商品DBにない場合は、栄養成分表示が画面の大半を占め、反射が少なくなるよう近づいて撮影してください。</p>
          <label className="button secondary">
            栄養成分表示を撮影
            <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readLabel(file);
              event.currentTarget.value = "";
            }} />
          </label>
        </div>
      )}

      {ocrCandidate && (
        <div className="form library-form stack">
          {ocrPreviewUrl && (
            <figure className="ocr-preview-frame">
              <img className="ocr-preview" src={ocrPreviewUrl} alt="確認用の栄養成分表示" />
              <figcaption className="muted">この画像とOCR候補を見比べて確認してください。画像は保存しません。</figcaption>
            </figure>
          )}
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ocr-product-name">商品名</label>
              <input id="ocr-product-name" value={ocrCandidate.name} onChange={(event) => setOcrCandidate((current) => current ? { ...current, name: event.target.value } : current)} />
            </div>
            <div className="field">
              <label htmlFor="ocr-product-brand">メーカー・ブランド（任意）</label>
              <input id="ocr-product-brand" value={ocrCandidate.brand ?? ""} onChange={(event) => setOcrCandidate((current) => current ? { ...current, brand: event.target.value || null, manufacturer: event.target.value || null } : current)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ocr-serving-size">表示基準量</label>
              <input id="ocr-serving-size" type="number" min="0.001" step="any" value={ocrCandidate.serving_size} onChange={(event) => setOcrCandidate((current) => current ? { ...current, serving_size: Number(event.target.value) } : current)} />
            </div>
            <div className="field">
              <label htmlFor="ocr-serving-unit">表示基準単位</label>
              <input id="ocr-serving-unit" value={ocrCandidate.serving_unit} onChange={(event) => setOcrCandidate((current) => current ? { ...current, serving_unit: event.target.value } : current)} />
            </div>
          </div>

          <fieldset className="nutrient-fieldset">
            <legend>OCR結果（現物ラベルと照合してから保存）</legend>
            <div className="nutrient-grid">
              {NUTRIENT_DEFINITIONS.map((definition) => (
                <div className="field" key={definition.code}>
                  <label htmlFor={`ocr-${definition.code}`}>{definition.label}（{definition.unit}）</label>
                  <input
                    id={`ocr-${definition.code}`}
                    type="number"
                    min="0"
                    step="any"
                    value={ocrNutrients[definition.code]}
                    onChange={(event) => setOcrNutrients((current) => ({ ...current, [definition.code]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <div className="form-actions">
            <button className="button" type="button" disabled={busy} onClick={() => void saveOcr()}>現物と確認して保存</button>
            <label className="button secondary">
              撮り直す
              <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readLabel(file);
                event.currentTarget.value = "";
              }} />
            </label>
          </div>
        </div>
      )}

      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
