import "server-only";

import { groupOcrWordsIntoLines, type OcrBox, type OcrDocument, type OcrWord } from "@/lib/products/ocr-document";

type Vertex = {
  x?: number;
  y?: number;
};

type VisionSymbol = {
  text?: string;
};

type VisionWord = {
  symbols?: VisionSymbol[];
  confidence?: number;
  boundingBox?: {
    vertices?: Vertex[];
  };
};

type VisionParagraph = {
  words?: VisionWord[];
};

type VisionBlock = {
  paragraphs?: VisionParagraph[];
};

type VisionPage = {
  width?: number;
  height?: number;
  blocks?: VisionBlock[];
};

type VisionResponseBody = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
      pages?: VisionPage[];
    };
    error?: {
      code?: number;
      message?: string;
      status?: string;
    };
  }>;
};

export class GoogleVisionError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "rate_limited" | "upstream_error" | "invalid_response",
  ) {
    super(message);
    this.name = "GoogleVisionError";
  }
}

function verticesToBox(vertices: Vertex[] | undefined): OcrBox | null {
  if (!vertices || vertices.length === 0) return null;
  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function normalizeVisionDocument(body: VisionResponseBody): OcrDocument {
  const annotation = body.responses?.[0]?.fullTextAnnotation;
  if (!annotation) {
    throw new GoogleVisionError("Cloud Vision returned no OCR document.", "invalid_response");
  }

  const pages = annotation.pages ?? [];
  const words: OcrWord[] = pages.flatMap((page) =>
    (page.blocks ?? []).flatMap((block) =>
      (block.paragraphs ?? []).flatMap((paragraph) =>
        (paragraph.words ?? []).flatMap((word) => {
          const text = (word.symbols ?? []).map((symbol) => symbol.text ?? "").join("").trim();
          const box = verticesToBox(word.boundingBox?.vertices);
          if (!text || !box) return [];
          return [{
            text,
            confidence: typeof word.confidence === "number" ? word.confidence : null,
            box,
          }];
        }),
      ),
    ),
  );

  const firstPage = pages[0];
  return {
    provider: "google_cloud_vision",
    text: annotation.text ?? "",
    width: typeof firstPage?.width === "number" ? firstPage.width : null,
    height: typeof firstPage?.height === "number" ? firstPage.height : null,
    words,
    lines: groupOcrWordsIntoLines(words),
  };
}

export async function recognizeWithGoogleCloudVision(image: Uint8Array): Promise<OcrDocument> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new GoogleVisionError("Google Cloud Vision is not configured.", "not_configured");
  }

  const response = await fetch(
    "https://vision.googleapis.com/v1/images:annotate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        requests: [{
          image: { content: Buffer.from(image).toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["ja", "en"] },
        }],
      }),
    },
  );

  if (response.status === 429) {
    throw new GoogleVisionError("Google Cloud Vision rate limit reached.", "rate_limited");
  }
  if (!response.ok) {
    throw new GoogleVisionError("Google Cloud Vision request failed.", "upstream_error");
  }

  const body = await response.json().catch(() => null) as VisionResponseBody | null;
  if (!body) {
    throw new GoogleVisionError("Google Cloud Vision returned invalid JSON.", "invalid_response");
  }

  const providerError = body.responses?.[0]?.error;
  if (providerError) {
    throw new GoogleVisionError("Google Cloud Vision returned an OCR error.", "upstream_error");
  }

  return normalizeVisionDocument(body);
}
