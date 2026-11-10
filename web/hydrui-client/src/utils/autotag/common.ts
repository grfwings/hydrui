import { type InferenceSession } from "onnxruntime-web";

const KNOWN_KAOMOJI = new Set([
  "0_0",
  "(o)_(o)",
  "+_+",
  "+_-",
  "._.",
  "<o>_<o>",
  "<|>_<|>",
  "=_=",
  ">_<",
  "3_3",
  "6_9",
  ">_o",
  "@_@",
  "^_^",
  "o_o",
  "u_u",
  "x_x",
  "|_|",
  "||_||",
]);

export type AutotagBackend = "webgpu" | "wasm";

export interface SessionCommon {
  modelSession: InferenceSession;
  targetSize: number;
  backend: AutotagBackend;
}

export interface Results {
  tagResults: { name: string; confidence: number }[];
  backend?: AutotagBackend;
}

export interface LetterboxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeLetterboxRect(
  imageWidth: number,
  imageHeight: number,
  targetSize: number,
): LetterboxRect {
  const scale = Math.min(targetSize / imageWidth, targetSize / imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return {
    x: Math.floor((targetSize - width) / 2),
    y: Math.floor((targetSize - height) / 2),
    width,
    height,
  };
}

export function getExecutionProviders(
  preferWebGPU: boolean,
  hasWebGPU: boolean,
): AutotagBackend[] {
  return preferWebGPU && hasWebGPU ? ["webgpu", "wasm"] : ["wasm"];
}

export async function createInferenceSession(
  modelData: ArrayBuffer,
  preferWebGPU: boolean,
): Promise<{ session: InferenceSession; backend: AutotagBackend }> {
  const { InferenceSession } = await import("onnxruntime-web");
  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const executionProviders = getExecutionProviders(preferWebGPU, hasWebGPU);
  if (executionProviders[0] === "webgpu") {
    try {
      const session = await InferenceSession.create(modelData, {
        executionProviders,
      });
      return { session, backend: "webgpu" };
    } catch (error) {
      console.warn(
        `WebGPU inference session creation failed; falling back to the CPU: ${error}`,
      );
    }
  }
  const session = await InferenceSession.create(modelData, {
    executionProviders: ["wasm"],
  });
  return { session, backend: "wasm" };
}

export function relativeUrl(urlString: URL | string, path: string): URL {
  return new URL(path, new URL(urlString, document.baseURI));
}

export function rewriteUnderscoreTags(name: string): string {
  return KNOWN_KAOMOJI.has(name) ? name : name.replace(/_/g, " ");
}

export function joinTagNamespace(name: string, namespace: string): string {
  return namespace === "" && name.startsWith(":")
    ? `:${name}`
    : namespace !== ""
      ? `${namespace}:${name}`
      : name;
}

export function getTagNamespaceForCategory(category: string): string {
  switch (category) {
    case "general":
      return "";
    case "artist":
      return "creator";
    case "copyright":
      return "series";
    default:
      return category;
  }
}

export function sigmoid(x: number): number {
  return 1.0 / (1.0 + Math.exp(-x));
}

export async function getCacheKey(name: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(name);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}

export async function writeOpfsFile(
  path: string,
  data: BlobPart,
): Promise<void> {
  const opfsRoot = await navigator.storage.getDirectory();
  const fileHandle = await opfsRoot.getFileHandle(path, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([data]));
  await writable.close();
}

export function createCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}
export function getCanvasContext2D(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  let context:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (
    typeof OffscreenCanvas !== "undefined" &&
    canvas instanceof OffscreenCanvas
  ) {
    context = canvas.getContext("2d");
  } else if (
    typeof HTMLCanvasElement !== "undefined" &&
    canvas instanceof HTMLCanvasElement
  ) {
    context = canvas.getContext("2d");
  } else {
    throw new Error("Unable to determine type of canvas");
  }
  if (!context) {
    throw new Error("Unable to get 2D Canvas context");
  }
  return context;
}
