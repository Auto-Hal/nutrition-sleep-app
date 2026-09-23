"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NUTRIENT_DEFINITIONS, type NutrientCode } from "@/lib/nutrition/catalog";
import { isValidGtin, normalizeBarcode } from "@/lib/products/barcode";
import { prepareNutritionLabelImage } from "@/lib/products/image-prep";
import type { CommercialNutrient } from "@/lib/products/open-food-facts";
import type {
  ProductCandidateBundle,
  ProductIdentityCandidate,
  ProductNutrientCandidate,
} from "@/lib/products/types";

type ProductItemType = "product" | "supplement";

type PersistableIdentitySource = ProductIdentityCandidate["source"];

type OcrDraftCandidate = {
  draft_id: string;
  barcode: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  package_amount: number | null;
  package_unit: string | null;
  serving_size: number;
  serving_unit: string;
  identity_source: PersistableIdentitySource;
  nutrient_source_provider: string;
  nutrient_source_observed_at: string;
};

type LocalIdentitySource = {
  type: "manufacturer_official" | "external_database" | "user_entered" | "legacy_unknown";
  provider: string | null;
  uri: string | null;
  observed_at: string | null;
  confirmed_at: string | null;
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
    source_type: "manufacturer_official" | "label_ocr" | "external_database" | null;
    source_provider: string | null;
    source_uri: string | null;
    source_observed_at: string | null;
    confirmed_at: string;
    identity_source: LocalIdentitySource;
  };
  nutrients: Array<{
    nutrient_code: NutrientCode;
    amount: number | null;
    unit: string;
    provenance: string;
    quality: string;
    source_uri: string | null;
    source_observed_at: string | null;
  }>;
};

type ResolveResponse =
  | { status: "local"; draft_id: string; item: LocalProductItem }
  | { status: "external"; draft_id: string; candidate: ProductCandidateBundle }
  | { status: "not_found"; draft_id: string; fallback: "ocr" }
  | { status: "external_unavailable"; draft_id: string; reason: string; fallback: "ocr" }
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

function nutrientDraft(
  values: Array<{ code: NutrientCode; amount: number | null }>,
): NutrientDraft {
  return Object.fromEntries(
    NUTRIENT_DEFINITIONS.map(({ code }) => {
      const nutrient = values.find((value) => value.code === code);
      return [code, nutrient?.amount === null || nutrient?.amount === undefined
        ? ""
        : String(nutrient.amount)];
    }),
  ) as NutrientDraft;
}

function ocrNutrientPayload(
  values: NutrientDraft,
  provider: string,
  observedAt: string,
): ProductNutrientCandidate[] {
  return NUTRIENT_DEFINITIONS.flatMap((definition) => {
    const raw = values[definition.code].trim();
    if (!raw) return [];
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${definition.label}の値を確認してください。`);
    }
    return [{
      code: definition.code,
      amount,
      unit: definition.unit,
      provenance: "ocr" as const,
      quality: "user_verified" as const,
      source_uri: null,
      source_observed_at: observedAt,
    }];
  });
}

function identitySourceForLocal(
  item: LocalProductItem,
  observedAt: string,
): PersistableIdentitySource {
  const source = item.product.identity_source;
  if (
    source.type !== "legacy_unknown"
    && source.provider
    && source.observed_at
  ) {
    return {
      type: source.type,
      provider: source.provider,
      uri: source.uri,
      observed_at: source.observed_at,
    };
  }

  // A legacy row has no proven identity provenance. Re-saving from the v2
  // confirmation form is an explicit user confirmation, so only then may it
  // acquire user_entered identity provenance.
  return {
    type: "user_entered",
    provider: "user_confirmed",
    uri: null,
    observed_at: observedAt,
  };
}

function userEnteredIdentitySource(): PersistableIdentitySource {
  return {
    type: "user_entered",
    provider: "user",
    uri: null,
    observed_at: new Date().toISOString(),
  };
}

function identitySourceLabel(source: LocalIdentitySource) {
  if (source.type === "legacy_unknown") return "旧データ（identity出典不明）";
  if (source.type === "user_entered") return "ユーザー入力";
  if (source.type === "manufacturer_official") return "メーカー公式";
  return source.provider ? `外部DB: ${source.provider}` : "外部DB";
}

export function ProductIngestion({ onSaved }: { onSaved: () => Promise<void> }) {
  const [barcode, setBarcode] = useState("");
  const [itemType, setItemType] = useState<ProductItemType>("product");
  const [externalCandidate, setExternalCandidate] = useState<ProductCandidateBundle | null>(null);
  const [localItem, setLocalItem] = useState<LocalProductItem | null>(null);
  const [ocrCandidate, setOcrCandidate] = useState<OcrDraftCandidate | null>(null);
  const [ocrNutrients, setOcrNutrients] = useState<NutrientDraft>(() => nutrientDraft([]));
  const [scannerOpen, setScannerOpen] = useState(false);
  const [needsOcr, setNeedsOcr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeDraftRef = useRef<{ draft_id: string; barcode: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);
  const ocrPreviewRef = useRef<string | null>(null);

  const replaceOcrPreview = useCallback((file: File | null) => {
    if (ocrPreviewRef.current) URL.revokeObjectURL(ocrPreviewRef.current);
    const next = file ? URL.createObjectURL(file) : null;
    ocrPreviewRef.current = next;
    setOcrPreviewUrl(next);
  }, []);

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
  }, [replaceOcrPreview]);

  const resolveBarcode = useCallback(async (value: string) => {
    const normalized = normalizeBarcode(value);
    setBarcode(normalized);
    resetResolution();

    if (!isValidGtin(normalized)) {
      activeDraftRef.current = null;
      setError("JAN / EAN / UPC / GTINの番号を確認してください。");
      return;
    }

    const draft = { draft_id: crypto.randomUUID(), barcode: normalized };
    activeDraftRef.current = draft;

    setBusy(true);
    try {
      const response = await fetch(
        `/api/products/resolve?barcode=${encodeURIComponent(normalized)}&draft_id=${encodeURIComponent(draft.draft_id)}`,
        { cache: "no-store" },
      );
      const result = await response.json() as ResolveResponse;
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "商品を検索できませんでした。");
      }

      const current = activeDraftRef.current;
      if (
        !current
        || current.draft_id !== draft.draft_id
        || current.barcode !== normalized
        || result.draft_id !== draft.draft_id
      ) {
        return;
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
        if (result.candidate.nutrition) {
          setMessage("外部商品DBにidentityと栄養候補が見つかりました。内容を確認してから保存してください。");
        } else {
          setNeedsOcr(true);
          setMessage("商品名は外部DBで見つかりました。栄養値・表示基準量は現物ラベルから確認してください。");
        }
        return;
      }

      setNeedsOcr(true);
      setMessage(result.status === "external_unavailable"
        ? "外部商品DBを利用できません。商品名を確認し、現物ラベルから登録できます。"
        : "商品DBで安全に特定できませんでした。商品名を確認し、現物ラベルを撮影してください。");
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
          (result, decodeError, scanControls) => {
            if (!result) {
              void decodeError;
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
    const draftAtStart = activeDraftRef.current;

    if (!isValidGtin(normalized) || !draftAtStart || draftAtStart.barcode !== normalized) {
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

      const current = activeDraftRef.current;
      if (
        !current
        || current.draft_id !== draftAtStart.draft_id
        || current.barcode !== draftAtStart.barcode
        || normalizeBarcode(barcode) !== draftAtStart.barcode
      ) {
        return;
      }

      const externalIdentity = externalCandidate?.identity.draft_id === draftAtStart.draft_id
        ? externalCandidate.identity
        : null;

      const identitySource = externalIdentity?.source
        ?? (localItem
          ? identitySourceForLocal(localItem, parsed.source_observed_at)
          : userEnteredIdentitySource());

      const draft: OcrDraftCandidate = {
        draft_id: draftAtStart.draft_id,
        barcode: normalized,
        name: externalIdentity?.name ?? localItem?.name ?? "",
        brand: externalIdentity?.brand ?? localItem?.brand ?? null,
        manufacturer: externalIdentity?.manufacturer ?? localItem?.product.manufacturer ?? null,
        serving_size: parsed.basis.serving_size,
        serving_unit: parsed.basis.serving_unit,
        package_amount: externalIdentity?.package_amount ?? localItem?.product.package_amount ?? null,
        package_unit: externalIdentity?.package_unit ?? localItem?.product.package_unit ?? null,
        identity_source: identitySource,
        nutrient_source_provider: parsed.provider,
        nutrient_source_observed_at: parsed.source_observed_at,
      };
      setOcrCandidate(draft);
      setOcrNutrients(nutrientDraft(parsed.nutrients));
      setNeedsOcr(false);

      const basisMessage = parsed.diagnostics.basis_detected
        ? `基準量: ${parsed.basis.serving_size} ${parsed.basis.serving_unit}`
        : "基準量は読み取れなかったため確認してください";
      setMessage(
        `Cloud OCRで${parsed.diagnostics.matched_nutrient_count}項目を抽出しました（${basisMessage}）。商品identityと栄養表示を確認して保存してください。`,
      );
    } catch (requestError) {
      setNeedsOcr(true);
      setError(requestError instanceof Error ? requestError.message : "OCRに失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function postProduct(payload: Record<string, unknown>) {
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "商品を保存できませんでした。");
  }

  async function patchProduct(id: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "商品を更新できませんでした。");
  }

  async function finishSave() {
    await onSaved();
    activeDraftRef.current = null;
    setExternalCandidate(null);
    setLocalItem(null);
    setOcrCandidate(null);
    setOcrNutrients(nutrientDraft([]));
    replaceOcrPreview(null);
    setNeedsOcr(false);
    setMessage("Libraryに保存しました。次回から同じバーコードは自前DBから解決します。");
  }

  async function saveExternalCandidate() {
    if (!externalCandidate?.nutrition) {
      setError("栄養表示の基準量が未確定です。現物ラベルを確認してください。");
      return;
    }

    const { identity, nutrition } = externalCandidate;
    if (nutrition.serving_size === null || !nutrition.serving_unit) {
      setError("栄養表示の基準量が未確定です。現物ラベルを確認してください。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await postProduct({
        item_type: itemType,
        barcode: identity.barcode,
        name: identity.name,
        brand: identity.brand,
        serving_size: nutrition.serving_size,
        serving_unit: nutrition.serving_unit,
        manufacturer: identity.manufacturer,
        package_amount: identity.package_amount,
        package_unit: identity.package_unit,
        identity_source_type: identity.source.type,
        identity_source_provider: identity.source.provider,
        identity_source_uri: identity.source.uri,
        identity_source_observed_at: identity.source.observed_at,
        nutrients: nutrition.nutrients,
        idempotency_key: crypto.randomUUID(),
      });
      await finishSave();
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

    const current = activeDraftRef.current;
    if (
      !current
      || current.draft_id !== ocrCandidate.draft_id
      || current.barcode !== ocrCandidate.barcode
    ) {
      setError("商品候補が切り替わっています。バーコードからやり直してください。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nutrients = ocrNutrientPayload(
        ocrNutrients,
        ocrCandidate.nutrient_source_provider,
        ocrCandidate.nutrient_source_observed_at,
      );

      const common = {
        name: ocrCandidate.name.trim(),
        brand: ocrCandidate.brand,
        serving_size: ocrCandidate.serving_size,
        serving_unit: ocrCandidate.serving_unit,
        manufacturer: ocrCandidate.manufacturer,
        package_amount: ocrCandidate.package_amount,
        package_unit: ocrCandidate.package_unit,
        identity_source_type: ocrCandidate.identity_source.type,
        identity_source_provider: ocrCandidate.identity_source.provider,
        identity_source_uri: ocrCandidate.identity_source.uri,
        identity_source_observed_at: ocrCandidate.identity_source.observed_at,
        nutrients,
      };

      const updatingLocal = Boolean(
        localItem
        && localItem.product.barcode === ocrCandidate.barcode,
      );

      if (updatingLocal) {
        await patchProduct(localItem!.id, {
          ...common,
          expected_revision: localItem!.revision,
          active: localItem!.active,
          replace_all_nutrients: true,
          confirm_verified_overwrite: true,
        });
      } else {
        await postProduct({
          ...common,
          item_type: itemType,
          barcode: ocrCandidate.barcode,
          idempotency_key: crypto.randomUUID(),
        });
      }

      await finishSave();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "商品を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const markIdentityEdited = useCallback((next: Partial<Pick<OcrDraftCandidate, "name" | "brand" | "manufacturer">>) => {
    setOcrCandidate((current) => current ? {
      ...current,
      ...next,
      identity_source: userEnteredIdentitySource(),
    } : current);
  }, []);

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
          <select
            id="commercial-item-type"
            value={itemType}
            onChange={(event) => setItemType(event.target.value as ProductItemType)}
          >
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
            onChange={(event) => {
              setBarcode(event.target.value);
              activeDraftRef.current = null;
            }}
            placeholder="バーコードを読み取るか入力"
          />
        </div>
      </div>

      <div className="form-actions">
        <button
          className="button"
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={busy || scannerOpen}
        >
          ライブカメラで読む
        </button>
        <label className="button secondary">
          バーコードを撮影
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readBarcodePhoto(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button
          className="button secondary"
          type="button"
          onClick={() => void resolveBarcode(barcode)}
          disabled={busy}
        >
          番号で検索
        </button>
      </div>

      {scannerOpen && (
        <div className="stack" aria-live="polite">
          <div className="barcode-camera-shell">
            <video ref={videoRef} className="barcode-video" muted playsInline />
            <div className="barcode-guide" aria-hidden="true"><span /></div>
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
              <div className="muted">identity: {identitySourceLabel(localItem.product.identity_source)}</div>
            </div>
          </div>
          <label className="button secondary">
            現物ラベルで更新
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readLabel(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      )}

      {externalCandidate && !ocrCandidate && (
        <div className="stack">
          <div className="catalog-row">
            <div>
              <strong>{externalCandidate.identity.name}</strong>
              <div className="muted">
                {externalCandidate.identity.brand ?? "ブランド不明"} · identity: {externalCandidate.identity.source.provider}
              </div>
              <div className="muted">
                {externalCandidate.nutrition
                  ? `栄養候補あり · ${externalCandidate.nutrition.serving_size} ${externalCandidate.nutrition.serving_unit}基準`
                  : "栄養値・表示基準量は未確定"}
              </div>
            </div>
          </div>

          {externalCandidate.nutrition && (
            <div className="nutrient-grid">
              {externalCandidate.nutrition.nutrients.map((nutrient) => {
                const definition = NUTRIENT_DEFINITIONS.find(({ code }) => code === nutrient.code);
                return (
                  <div key={nutrient.code}>
                    <strong>{definition?.label ?? nutrient.code}</strong>
                    <div className="muted">
                      {nutrient.amount === null ? "—" : nutrient.amount} {nutrient.unit}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="form-actions">
            {externalCandidate.nutrition && (
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void saveExternalCandidate()}
              >
                この候補を確認して保存
              </button>
            )}
            <label className="button secondary">
              栄養成分表示を撮影
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readLabel(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}

      {needsOcr && !ocrCandidate && !externalCandidate && (
        <div className="stack">
          <p className="muted">商品DBでは安全に特定できませんでした。商品名を入力するため、まず栄養成分表示を撮影してください。</p>
          <label className="button secondary">
            栄養成分表示を撮影
            <input
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readLabel(file);
                event.currentTarget.value = "";
              }}
            />
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
              <input
                id="ocr-product-name"
                value={ocrCandidate.name}
                onChange={(event) => markIdentityEdited({ name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="ocr-product-brand">メーカー・ブランド（任意）</label>
              <input
                id="ocr-product-brand"
                value={ocrCandidate.brand ?? ""}
                onChange={(event) => {
                  const value = event.target.value || null;
                  markIdentityEdited({ brand: value, manufacturer: value });
                }}
              />
            </div>
          </div>

          <div className="nutrition-meta">
            identity出典: {ocrCandidate.identity_source.type === "user_entered"
              ? "ユーザー確認・入力"
              : ocrCandidate.identity_source.provider}
            <span aria-hidden="true"> · </span>
            栄養出典: {ocrCandidate.nutrient_source_provider}（現物ラベルOCR）
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="ocr-serving-size">表示基準量</label>
              <input
                id="ocr-serving-size"
                type="number"
                min="0.001"
                step="any"
                value={ocrCandidate.serving_size}
                onChange={(event) => setOcrCandidate((current) => current
                  ? { ...current, serving_size: Number(event.target.value) }
                  : current)}
              />
            </div>
            <div className="field">
              <label htmlFor="ocr-serving-unit">表示基準単位</label>
              <input
                id="ocr-serving-unit"
                value={ocrCandidate.serving_unit}
                onChange={(event) => setOcrCandidate((current) => current
                  ? { ...current, serving_unit: event.target.value }
                  : current)}
              />
            </div>
          </div>

          <fieldset className="nutrient-fieldset">
            <legend>OCR結果（現物ラベルと照合してから保存）</legend>
            <div className="nutrient-grid">
              {NUTRIENT_DEFINITIONS.map((definition) => (
                <div className="field" key={definition.code}>
                  <label htmlFor={`ocr-${definition.code}`}>
                    {definition.label}（{definition.unit}）
                  </label>
                  <input
                    id={`ocr-${definition.code}`}
                    type="number"
                    min="0"
                    step="any"
                    value={ocrNutrients[definition.code]}
                    onChange={(event) => setOcrNutrients((current) => ({
                      ...current,
                      [definition.code]: event.target.value,
                    }))}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <div className="form-actions">
            <button className="button" type="button" disabled={busy} onClick={() => void saveOcr()}>
              identityと現物ラベルを確認して保存
            </button>
            <label className="button secondary">
              撮り直す
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void readLabel(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}

      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
