import { type Entry, type FileEntry } from "@zip.js/zip.js";

import {
  type PixAITaggerModelMeta,
  type TagModelMeta,
} from "@/store/modelMetaStore";

import {
  Results,
  SessionCommon,
  computeLetterboxRect,
  createCanvas,
  createInferenceSession,
  getCacheKey,
  getCanvasContext2D,
  getTagNamespaceForCategory,
  joinTagNamespace,
  rewriteUnderscoreTags,
  sigmoid,
  writeOpfsFile,
} from "./common";

export const PIXAI_MODEL_NAME = "PixAI Tagger v1.0";

const PIXAI_DEFAULT_TARGET_SIZE = 1008;
const PIXAI_DEFAULT_CATEGORY_THRESHOLD = 0.2;
const PIXAI_CONFIG_SUFFIX = "config.json";
const PIXAI_MODEL_FILE = "model.onnx";

export interface PixAIModelConfig {
  img_size?: number;
  tags: string[];
  tags_split: [string, number][];
  category_best_threshold: Record<string, number>;
}

export interface PixAITaggerSession extends SessionCommon {
  modelType: "pixai";
  config: PixAIModelConfig;
  tagCategories: string[];
  applySigmoid: boolean;
}

export function isPixAIConfig(value: unknown): value is PixAIModelConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "tags" in value &&
    Array.isArray(value.tags) &&
    "tags_split" in value &&
    Array.isArray(value.tags_split) &&
    "category_best_threshold" in value &&
    typeof value.category_best_threshold === "object" &&
    value.category_best_threshold !== null &&
    !Array.isArray(value.category_best_threshold)
  );
}

export function buildTagCategories(config: PixAIModelConfig): string[] {
  const categories: string[] = [];
  for (const [category, count] of config.tags_split) {
    for (let i = 0; i < count; i++) {
      categories.push(category);
    }
  }
  while (categories.length < config.tags.length) {
    categories.push("general");
  }
  return categories;
}

export function shouldApplySigmoid(outputNames: readonly string[]): boolean {
  // The common exports already apply sigmoid and name the output "prediction".
  // Exports that output "logits" are pre-sigmoid.
  return !outputNames.includes("prediction");
}

function getPixAITagNamespace(category: string): string {
  switch (category) {
    case "style":
      return "creator";
    case "meta":
      return "";
    default:
      return getTagNamespaceForCategory(category);
  }
}

export async function parseModelInfoPixAI(
  url: string,
  config: PixAIModelConfig,
): Promise<TagModelMeta> {
  const cacheKey = await getCacheKey(PIXAI_MODEL_NAME);
  const configPath = `tagModels-${cacheKey}-config.json`;
  try {
    await writeOpfsFile(configPath, JSON.stringify(config));
  } catch (writeError) {
    throw new Error(`Failed to save config to ${configPath}: ${writeError}`);
  }
  return { name: PIXAI_MODEL_NAME, type: "pixai", url, configPath };
}

export async function fetchModelFilesPixAI(
  meta: PixAITaggerModelMeta,
): Promise<string> {
  if (!meta.url) {
    throw new Error("Model entry does not have a URL!");
  }
  return PIXAI_MODEL_FILE;
}

export async function deleteSavedPixAIFiles(meta: PixAITaggerModelMeta) {
  const opfsRoot = await navigator.storage.getDirectory();
  if (meta.configPath) {
    try {
      await opfsRoot.removeEntry(meta.configPath);
    } catch (error) {
      console.warn(`Error deleting ${meta.configPath}: ${error}`);
    }
  }
}

export async function loadModelPixAI(
  meta: PixAITaggerModelMeta,
  preferWebGPU = true,
): Promise<PixAITaggerSession> {
  if (!meta.modelPath || !meta.configPath) {
    throw new Error("Model data is not cached.");
  }
  const opfsRoot = await navigator.storage.getDirectory();
  const model = await opfsRoot.getFileHandle(meta.modelPath);
  const modelData = await model.getFile();
  const configFile = await opfsRoot.getFileHandle(meta.configPath);
  const config: PixAIModelConfig = JSON.parse(
    await (await configFile.getFile()).text(),
  );
  const { session, backend } = await createInferenceSession(
    await modelData.arrayBuffer(),
    preferWebGPU,
  );
  return {
    targetSize: config.img_size ?? PIXAI_DEFAULT_TARGET_SIZE,
    modelSession: session,
    backend,
    modelType: "pixai",
    config,
    tagCategories: buildTagCategories(config),
    applySigmoid: shouldApplySigmoid(session.outputNames),
  };
}

export async function preprocessImagePixAI(
  session: PixAITaggerSession,
  image: ImageBitmap,
) {
  const { Tensor } = await import("onnxruntime-web");
  const targetSize = session.targetSize;
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = getCanvasContext2D(canvas);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, targetSize, targetSize);
  const rect = computeLetterboxRect(image.width, image.height, targetSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const data = imageData.data;
  const tensor = new Float32Array(1 * 3 * targetSize * targetSize);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const pixelIndex = (y * targetSize + x) * 4;
      const tensorIdx = y * targetSize + x;
      for (let channel = 0; channel < 3; channel++) {
        const value = data[pixelIndex + channel]! / 255.0;
        tensor[channel * targetSize * targetSize + tensorIdx] =
          (value - 0.5) / 0.5;
      }
    }
  }
  return new Tensor("float32", tensor, [1, 3, targetSize, targetSize]);
}

export function processResultsPixAI(
  session: PixAITaggerSession,
  predictions: Float32Array,
  threshold: number,
): Results {
  // PixAI publishes per-category thresholds, so the UI threshold is unused.
  void threshold;
  const tagResults: { name: string; confidence: number }[] = [];
  let rating: { name: string; confidence: number } | undefined;
  const { tags, category_best_threshold } = session.config;
  for (const [i, tagName] of tags.entries()) {
    const prediction = predictions[i];
    if (prediction === undefined) {
      continue;
    }
    const category = session.tagCategories[i] ?? "general";
    const confidence = session.applySigmoid ? sigmoid(prediction) : prediction;
    const categoryThreshold =
      category_best_threshold[category] ?? PIXAI_DEFAULT_CATEGORY_THRESHOLD;
    if (confidence <= categoryThreshold) {
      continue;
    }
    if (category === "rating") {
      // Rating tags already carry their namespace, e.g. "rating:s".
      if (!rating || confidence > rating.confidence) {
        rating = { name: tagName, confidence };
      }
      continue;
    }
    const name = joinTagNamespace(
      rewriteUnderscoreTags(tagName),
      getPixAITagNamespace(category),
    );
    tagResults.push({ name, confidence });
  }
  if (rating) {
    tagResults.push(rating);
  }
  tagResults.sort((a, b) => b.confidence - a.confidence);
  return { tagResults };
}

export async function loadPixAIModelFromZip(
  entries: Entry[],
  fileMap: Map<string, Entry>,
): Promise<PixAITaggerModelMeta | null> {
  let configEntry: FileEntry | undefined;
  let configData: ArrayBuffer | undefined;
  for (const entry of entries) {
    if (entry.directory || !entry.filename.endsWith(PIXAI_CONFIG_SUFFIX)) {
      continue;
    }
    const data = await entry.arrayBuffer();
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!isPixAIConfig(parsed)) {
      continue;
    }
    configEntry = entry;
    configData = data;
    break;
  }
  if (!configEntry || !configData) {
    return null;
  }
  const configDirectory = configEntry.filename.slice(
    0,
    configEntry.filename.lastIndexOf("/") + 1,
  );
  const modelName = `${configDirectory}${PIXAI_MODEL_FILE}`;
  const modelEntry = fileMap.get(modelName);
  if (!modelEntry || modelEntry.directory) {
    throw new Error(
      `Could not find ${modelName} in zipped PixAI Tagger model.`,
    );
  }
  const cacheKey = await getCacheKey(PIXAI_MODEL_NAME);
  const cachedModelName = `tagModels-${cacheKey}-model.onnx`;
  const cachedConfigName = `tagModels-${cacheKey}-config.json`;
  try {
    await writeOpfsFile(cachedModelName, await modelEntry.arrayBuffer());
  } catch (writeError) {
    throw new Error(
      `Failed to save model to ${cachedModelName}: ${writeError}`,
    );
  }
  try {
    await writeOpfsFile(cachedConfigName, configData);
  } catch (writeError) {
    throw new Error(
      `Failed to save config to ${cachedConfigName}: ${writeError}`,
    );
  }
  return {
    name: PIXAI_MODEL_NAME,
    type: "pixai",
    modelPath: cachedModelName,
    configPath: cachedConfigName,
  };
}
