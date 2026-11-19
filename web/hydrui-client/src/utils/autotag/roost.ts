import { type RoostTagModelMeta } from "@/store/modelMetaStore";

import {
  type Results,
  createCanvas,
  getCanvasContext2D,
  joinTagNamespace,
  rewriteUnderscoreTags,
} from "./common";
import { type AutotagWorker } from "./worker";

export const ROOST_DEFAULT_URL = "http://127.0.0.1:21911";
const ROOST_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ROOST_MAX_RASTER_DIM = 2048;

export interface RoostModelInfo {
  id: string;
  adapter: string;
  labels: number;
  thresholds: Record<string, number>;
}

const PREFIX_BY_CATEGORY: Record<string, string> = {
  rating: "rating:",
  style: "creator:",
  artist: "creator:",
  copyright: "series:",
  character: "character:",
  species: "species:",
  meta: "meta:",
  year: "year:",
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripRoostEndpointSuffix(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  for (const suffix of ["/v1/tag", "/v1/model", "/v1"]) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
}

export function normalizeRoostBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter a Roost server URL.");
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (trimmed.includes("?") || trimmed.includes("#")) {
      throw new Error(
        "Roost server URL must not include a query string or fragment.",
      );
    }
    const pathname = stripRoostEndpointSuffix(trimmed);
    if (!pathname) {
      throw new Error("Enter a Roost server URL.");
    }
    return pathname;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid http:// or https:// Roost URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Enter a valid http:// or https:// Roost URL.");
  }
  if (url.username || url.password) {
    throw new Error(
      "Do not embed credentials in the Roost URL; use the API token field.",
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      "Roost server URL must not include a query string or fragment.",
    );
  }
  const pathname = stripRoostEndpointSuffix(url.pathname);
  return `${url.origin}${pathname}`;
}

export function readServerRoostModel(
  element: HTMLElement | null | undefined,
): RoostTagModelMeta | null {
  if (!element || element.dataset["serverMode"] !== "true") {
    return null;
  }
  if (element.dataset["roostEnabled"] !== "true") {
    return null;
  }
  const name = element.dataset["roostName"]?.trim() || "Roost (Server)";
  return {
    type: "roost",
    name,
    url: "/roost",
    serverManaged: true,
  };
}

export const serverRoostModel =
  typeof document !== "undefined" ? readServerRoostModel(document.body) : null;

function authHeaders(
  apiKey: string | undefined,
): Record<string, string> | undefined {
  const token = apiKey?.trim();
  if (!token) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function parseRoostJson(response: Response): Promise<unknown> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Roost returned HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const detail = isRecord(data) ? data["detail"] : undefined;
    throw new Error(
      typeof detail === "string" && detail.length > 0
        ? detail
        : `Roost returned HTTP ${response.status}.`,
    );
  }
  return data;
}

export function roostPredictionToHydrusTag(prediction: {
  label: string;
  category?: string;
}): string {
  const { label, category } = prediction;
  if (category === "general") {
    return joinTagNamespace(rewriteUnderscoreTags(label), "");
  }
  const expectedPrefix = category ? PREFIX_BY_CATEGORY[category] : undefined;
  if (expectedPrefix && label.startsWith(expectedPrefix)) {
    const namespace = expectedPrefix.slice(0, -1);
    const rawName = label.slice(expectedPrefix.length);
    return joinTagNamespace(rewriteUnderscoreTags(rawName), namespace);
  }
  if (category && category in PREFIX_BY_CATEGORY) {
    // Known category emitted without namespace prefix (e.g. PixAI meta tags).
    return joinTagNamespace(rewriteUnderscoreTags(label), "");
  }
  const match = /^([a-z][a-z_-]*):(.+)$/.exec(label);
  if (match && match[1] && match[2]) {
    return joinTagNamespace(rewriteUnderscoreTags(match[2]), match[1]);
  }
  return joinTagNamespace(rewriteUnderscoreTags(label), "");
}

export async function fetchRoostModelInfo(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<RoostModelInfo> {
  const normalized = normalizeRoostBaseUrl(baseUrl);
  const headers = authHeaders(apiKey);
  let response: Response;
  try {
    response = await fetch(`${normalized}/v1/model`, {
      ...(headers ? { headers } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(`Could not reach Roost at ${normalized}.`);
  }
  const data = await parseRoostJson(response);
  if (
    !isRecord(data) ||
    typeof data["id"] !== "string" ||
    !data["id"] ||
    typeof data["adapter"] !== "string" ||
    typeof data["labels"] !== "number" ||
    !isRecord(data["thresholds"])
  ) {
    throw new Error("Endpoint did not return valid Roost /v1/model metadata.");
  }
  const thresholds: Record<string, number> = {};
  for (const [key, value] of Object.entries(data["thresholds"])) {
    if (typeof value === "number" && Number.isFinite(value)) {
      thresholds[key] = value;
    }
  }
  return {
    id: data["id"],
    adapter: data["adapter"],
    labels: data["labels"],
    thresholds,
  };
}

function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({
      type,
      ...(quality !== undefined ? { quality } : {}),
    });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to encode image for Roost upload."));
        }
      },
      type,
      quality,
    );
  });
}

async function bitmapToRoostBlob(image: ImageBitmap): Promise<Blob> {
  const scale = Math.min(
    1,
    ROOST_MAX_RASTER_DIM / Math.max(image.width || 1, image.height || 1),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = getCanvasContext2D(canvas);
  ctx.drawImage(image, 0, 0, width, height);

  const pngBlob = await canvasToBlob(canvas, "image/png");
  if (pngBlob.size <= ROOST_MAX_UPLOAD_BYTES) {
    return pngBlob;
  }
  return canvasToBlob(canvas, "image/jpeg", 0.92);
}

export async function tagImageWithRoost(options: {
  baseUrl: string;
  apiKey?: string;
  blob: Blob;
  generalThreshold?: number | null;
  signal?: AbortSignal;
}): Promise<Results> {
  const normalized = normalizeRoostBaseUrl(options.baseUrl);
  const headers = authHeaders(options.apiKey);
  const mimeType = options.blob.type || "image/png";
  const filename = `upload.${EXTENSIONS[mimeType] ?? "png"}`;
  const form = new FormData();
  form.append("image", new File([options.blob], filename, { type: mimeType }));
  if (
    typeof options.generalThreshold === "number" &&
    Number.isFinite(options.generalThreshold)
  ) {
    form.append(
      "thresholds",
      JSON.stringify({ general: options.generalThreshold }),
    );
  }

  let response: Response;
  try {
    response = await fetch(`${normalized}/v1/tag`, {
      method: "POST",
      ...(headers ? { headers } : {}),
      body: form,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(`Could not reach Roost at ${normalized}.`);
  }

  const data = await parseRoostJson(response);
  const predictions = isRecord(data) ? data["predictions"] : undefined;
  if (!Array.isArray(predictions)) {
    throw new Error("Roost returned an invalid response.");
  }

  const bestConfidenceByTag = new Map<string, number>();
  for (const item of predictions) {
    if (!isRecord(item)) {
      throw new Error("Roost returned an invalid response.");
    }
    const label = item["label"];
    const score = item["score"];
    const category = item["category"];
    if (
      typeof label !== "string" ||
      !label ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      (category !== undefined && typeof category !== "string")
    ) {
      throw new Error("Roost returned an invalid response.");
    }
    const tag = roostPredictionToHydrusTag({
      label,
      ...(category !== undefined ? { category } : {}),
    });
    const prev = bestConfidenceByTag.get(tag);
    if (prev === undefined || score > prev) {
      bestConfidenceByTag.set(tag, score);
    }
  }

  const tagResults = Array.from(
    bestConfidenceByTag.entries(),
    ([name, confidence]) => ({ name, confidence }),
  ).sort((a, b) => b.confidence - a.confidence);

  return { tagResults };
}

export class RoostAutotagWorker implements AutotagWorker {
  private meta: RoostTagModelMeta;

  constructor(meta: RoostTagModelMeta) {
    this.meta = meta;
  }

  async loadModel(meta: RoostTagModelMeta): Promise<void> {
    this.meta = meta;
  }

  async processImage(
    threshold: number | null,
    image: ImageBitmap,
    signal?: AbortSignal,
  ): Promise<Results> {
    const blob = await bitmapToRoostBlob(image);
    return tagImageWithRoost({
      baseUrl: this.meta.url,
      ...(this.meta.apiKey ? { apiKey: this.meta.apiKey } : {}),
      blob,
      generalThreshold: threshold,
      ...(signal ? { signal } : {}),
    });
  }

  release(): void {}
}
