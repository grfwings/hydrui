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
  relativeUrl,
  rewriteUnderscoreTags,
  sigmoid,
  writeOpfsFile,
} from "./common";

export const PIXAI_MODEL_NAME = "PixAI Tagger v1.0";
export const PIXAI_INT8_MODEL_NAME = "PixAI Tagger v1.0 (INT8)";

const PIXAI_DEFAULT_TARGET_SIZE = 1008;
const PIXAI_DEFAULT_CATEGORY_THRESHOLD = 0.2;
const PIXAI_CONFIG_SUFFIX = "config.json";
const PIXAI_PREPROCESS_SUFFIX = "preprocess.json";
const PIXAI_MODEL_FILE = "model.onnx";
const PIXAI_INT8_MODEL_FILE = "model_int8.onnx";
const PIXAI_TAGS_FILE = "selected_tags.csv";

const PIXAI_CATEGORY_NAMES: Record<number, string> = {
  0: "general",
  1: "style",
  3: "copyright",
  4: "character",
  5: "meta",
  9: "rating",
};

const PIXAI_CATEGORY_THRESHOLDS: Record<string, number> = {
  general: 0.17,
  character: 0.27,
  copyright: 0.24,
  style: 0.15,
  meta: 0.17,
  rating: 0.41,
};

export interface PixAIModelConfig {
  img_size?: number;
  tags: string[];
  tags_split: [string, number][];
  category_best_threshold: Record<string, number>;
}

export interface PixAIPreprocessStage {
  type: string;
  size?: number;
  pad_value?: number;
  mean?: number[];
  std?: number[];
}

export interface PixAIPreprocessDescriptor {
  stages: PixAIPreprocessStage[];
}

export interface PixAISelectedTag {
  id: number;
  name: string;
  category: number;
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

function isRescalePadStage(stage: unknown): boolean {
  return (
    typeof stage === "object" &&
    stage !== null &&
    "type" in stage &&
    stage.type === "rescale_pad"
  );
}

export function isPixAIPreprocessDescriptor(
  value: unknown,
): value is PixAIPreprocessDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    "stages" in value &&
    Array.isArray(value.stages) &&
    value.stages.some(isRescalePadStage)
  );
}

function getPixAIImgSize(descriptor: PixAIPreprocessDescriptor): number {
  for (const stage of descriptor.stages) {
    if (
      stage.type === "rescale_pad" &&
      typeof stage.size === "number" &&
      Number.isFinite(stage.size) &&
      stage.size > 0
    ) {
      return stage.size;
    }
  }
  return PIXAI_DEFAULT_TARGET_SIZE;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === ",") {
      result.push(current);
      current = "";
      i++;
    } else {
      current += char;
      i++;
    }
  }
  result.push(current);
  return result;
}

export function parseSelectedTagsCsv(text: string): PixAISelectedTag[] {
  let headers: string[] | undefined;
  const tags: PixAISelectedTag[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const values = parseCsvLine(line);
    if (!headers) {
      headers = values.map((value) => value.trim());
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    const id = Number(row["tag_id"]);
    const name = row["name"] ?? "";
    const category = Number(row["category"]);
    if (!Number.isFinite(id) || name === "") {
      continue;
    }
    tags.push({
      id,
      name,
      category: Number.isFinite(category) ? category : 0,
    });
  }
  tags.sort((a, b) => a.id - b.id);
  return tags;
}

export function buildPixAIConfigFromTags(
  tags: PixAISelectedTag[],
  imgSize: number = PIXAI_DEFAULT_TARGET_SIZE,
): PixAIModelConfig {
  const tagsSplit: [string, number][] = [];
  for (const tag of tags) {
    // The exports only use the known category ids. Treat anything else as a
    // general tag rather than failing the whole import.
    const category = PIXAI_CATEGORY_NAMES[tag.category] ?? "general";
    const last = tagsSplit[tagsSplit.length - 1];
    if (last && last[0] === category) {
      last[1] += 1;
    } else {
      tagsSplit.push([category, 1]);
    }
  }
  return {
    img_size: imgSize,
    tags: tags.map((tag) => tag.name),
    tags_split: tagsSplit,
    category_best_threshold: { ...PIXAI_CATEGORY_THRESHOLDS },
  };
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
  // The common exports already apply sigmoid and name the output "prediction";
  // some float16 exports use "probs". Exports that output "logits" are
  // pre-sigmoid.
  return !outputNames.some((name) => name === "prediction" || name === "probs");
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

export async function parseModelInfoPixAIFromPreprocess(
  url: string,
  descriptor: PixAIPreprocessDescriptor,
): Promise<TagModelMeta> {
  const tagsUrl = relativeUrl(url, PIXAI_TAGS_FILE);
  const tagsResponse = await fetch(tagsUrl);
  if (!tagsResponse.ok) {
    throw new Error(
      `Failed to fetch ${tagsUrl}: ${tagsResponse.status} ${tagsResponse.statusText}`,
    );
  }
  const tags = parseSelectedTagsCsv(await tagsResponse.text());
  if (tags.length === 0) {
    throw new Error(`No tags found in ${tagsUrl}.`);
  }
  const config = buildPixAIConfigFromTags(tags, getPixAIImgSize(descriptor));
  const cacheKey = await getCacheKey(PIXAI_INT8_MODEL_NAME);
  const configPath = `tagModels-${cacheKey}-config.json`;
  try {
    await writeOpfsFile(configPath, JSON.stringify(config));
  } catch (writeError) {
    throw new Error(`Failed to save config to ${configPath}: ${writeError}`);
  }
  return {
    name: PIXAI_INT8_MODEL_NAME,
    type: "pixai",
    url,
    configPath,
    modelFileName: PIXAI_INT8_MODEL_FILE,
  };
}

export async function fetchModelFilesPixAI(
  meta: PixAITaggerModelMeta,
): Promise<string> {
  if (!meta.url) {
    throw new Error("Model entry does not have a URL!");
  }
  return meta.modelFileName ?? PIXAI_MODEL_FILE;
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

async function cachePixAIModel(
  name: string,
  modelEntry: FileEntry,
  configData: BlobPart,
) {
  const cacheKey = await getCacheKey(name);
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
  return { cachedModelName, cachedConfigName };
}

function getDirectory(filename: string): string {
  return filename.slice(0, filename.lastIndexOf("/") + 1);
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
  if (configEntry && configData) {
    const modelName = `${getDirectory(configEntry.filename)}${PIXAI_MODEL_FILE}`;
    const modelEntry = fileMap.get(modelName);
    if (!modelEntry || modelEntry.directory) {
      throw new Error(
        `Could not find ${modelName} in zipped PixAI Tagger model.`,
      );
    }
    const { cachedModelName, cachedConfigName } = await cachePixAIModel(
      PIXAI_MODEL_NAME,
      modelEntry,
      configData,
    );
    return {
      name: PIXAI_MODEL_NAME,
      type: "pixai",
      modelPath: cachedModelName,
      configPath: cachedConfigName,
    };
  }

  // INT8 exports ship a preprocess descriptor and selected_tags.csv instead of
  // config.json.
  for (const entry of entries) {
    if (entry.directory || !entry.filename.endsWith(PIXAI_PREPROCESS_SUFFIX)) {
      continue;
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(await entry.arrayBuffer()),
    );
    if (!isPixAIPreprocessDescriptor(parsed)) {
      continue;
    }
    const directory = getDirectory(entry.filename);
    const tagsEntry = fileMap.get(`${directory}${PIXAI_TAGS_FILE}`);
    if (!tagsEntry || tagsEntry.directory) {
      throw new Error(
        `Could not find ${directory}${PIXAI_TAGS_FILE} in zipped PixAI Tagger model.`,
      );
    }
    const tags = parseSelectedTagsCsv(
      new TextDecoder().decode(await tagsEntry.arrayBuffer()),
    );
    if (tags.length === 0) {
      throw new Error(
        `No tags found in ${directory}${PIXAI_TAGS_FILE} in zipped PixAI Tagger model.`,
      );
    }
    const int8Entry = fileMap.get(`${directory}${PIXAI_INT8_MODEL_FILE}`);
    const modelEntry =
      int8Entry && !int8Entry.directory
        ? int8Entry
        : fileMap.get(`${directory}${PIXAI_MODEL_FILE}`);
    if (!modelEntry || modelEntry.directory) {
      throw new Error(
        `Could not find ${directory}${PIXAI_INT8_MODEL_FILE} in zipped PixAI Tagger model.`,
      );
    }
    const config = buildPixAIConfigFromTags(tags, getPixAIImgSize(parsed));
    const isInt8 = modelEntry === int8Entry;
    const { cachedModelName, cachedConfigName } = await cachePixAIModel(
      PIXAI_INT8_MODEL_NAME,
      modelEntry,
      JSON.stringify(config),
    );
    return {
      name: PIXAI_INT8_MODEL_NAME,
      type: "pixai",
      modelPath: cachedModelName,
      configPath: cachedConfigName,
      modelFileName: isInt8 ? PIXAI_INT8_MODEL_FILE : PIXAI_MODEL_FILE,
    };
  }
  return null;
}
