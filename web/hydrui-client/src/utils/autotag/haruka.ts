import { type Entry, type FileEntry } from "@zip.js/zip.js";

import {
  type HarukaTaggerModelMeta,
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

export { type LetterboxRect, computeLetterboxRect } from "./common";

export const HARUKA_MODEL_NAME = "Haruka Tagger";

const HARUKA_METADATA_SUFFIX = "_metadata.json";

const HARUKA_CATEGORY_THRESHOLDS: Record<string, number> = {
  general: 0.35,
  character: 0.35,
  copyright: 0.35,
  artist: 0.25,
  year: 0.25,
  rating: 0.5,
};

const HARUKA_MEAN = [0.485, 0.456, 0.406];
const HARUKA_STD = [0.229, 0.224, 0.225];

export interface HarukaMetadata {
  total_tags: number;
  img_size: number;
  backbone?: string;
  num_queries?: number;
  pool_mode?: string;
  idx_to_tag: Record<string, string>;
  tag_to_category: Record<string, string>;
}

export interface HarukaTaggerSession extends SessionCommon {
  modelType: "haruka";
  metadata: HarukaMetadata;
}

export function isHarukaMetadata(value: unknown): value is HarukaMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    "idx_to_tag" in value &&
    "total_tags" in value &&
    "tag_to_category" in value
  );
}

export async function parseModelInfoHaruka(
  url: string,
  metadata: HarukaMetadata,
): Promise<TagModelMeta> {
  const cacheKey = await getCacheKey(HARUKA_MODEL_NAME);
  const metadataPath = `tagModels-${cacheKey}-metadata.json`;
  try {
    await writeOpfsFile(metadataPath, JSON.stringify(metadata));
  } catch (writeError) {
    throw new Error(
      `Failed to save metadata to ${metadataPath}: ${writeError}`,
    );
  }
  return { name: HARUKA_MODEL_NAME, type: "haruka", url, metadataPath };
}

export async function preprocessImageHaruka(
  session: HarukaTaggerSession,
  image: ImageBitmap,
) {
  const { Tensor } = await import("onnxruntime-web");
  const targetSize = session.targetSize;
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = getCanvasContext2D(canvas);
  ctx.fillStyle = "white";
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
          (value - HARUKA_MEAN[channel]!) / HARUKA_STD[channel]!;
      }
    }
  }
  return new Tensor("float32", tensor, [1, 3, targetSize, targetSize]);
}

export function processResultsHaruka(
  session: HarukaTaggerSession,
  logits: Float32Array,
  threshold: number,
): Results {
  // Haruka publishes per-category thresholds, so the UI threshold is unused.
  void threshold;
  const tagResults: { name: string; confidence: number }[] = [];
  let rating: { name: string; confidence: number } | undefined;
  const { idx_to_tag, tag_to_category } = session.metadata;
  for (const [i, logit] of logits.entries()) {
    const tagName = idx_to_tag[i.toString()];
    if (!tagName) {
      continue;
    }
    const category = tag_to_category[tagName] ?? "general";
    const confidence = sigmoid(logit);
    if (confidence <= (HARUKA_CATEGORY_THRESHOLDS[category] ?? 0.35)) {
      continue;
    }
    const namespace = getTagNamespaceForCategory(category);
    const name = joinTagNamespace(
      rewriteUnderscoreTags(
        category === "rating" ? tagName.replace(/^rating_/, "") : tagName,
      ),
      namespace,
    );
    if (category === "rating") {
      if (!rating || confidence > rating.confidence) {
        rating = { name, confidence };
      }
    } else {
      tagResults.push({ name, confidence });
    }
  }
  if (rating) {
    tagResults.push(rating);
  }
  tagResults.sort((a, b) => b.confidence - a.confidence);
  return { tagResults };
}

export async function loadModelHaruka(
  meta: HarukaTaggerModelMeta,
  preferWebGPU = true,
): Promise<HarukaTaggerSession> {
  if (!meta.modelPath || !meta.metadataPath) {
    throw new Error("Model data is not cached.");
  }
  const opfsRoot = await navigator.storage.getDirectory();
  const model = await opfsRoot.getFileHandle(meta.modelPath);
  const modelData = await model.getFile();
  const metadataFile = await opfsRoot.getFileHandle(meta.metadataPath);
  const metadata: HarukaMetadata = JSON.parse(
    await (await metadataFile.getFile()).text(),
  );
  const { session, backend } = await createInferenceSession(
    await modelData.arrayBuffer(),
    preferWebGPU,
  );
  return {
    targetSize: metadata.img_size,
    modelSession: session,
    backend,
    modelType: "haruka",
    metadata,
  };
}

export async function fetchModelFilesHaruka(
  meta: HarukaTaggerModelMeta,
): Promise<string> {
  if (!meta.url) {
    throw new Error("Model entry does not have a URL!");
  }
  const metadataName = meta.url.substring(meta.url.lastIndexOf("/") + 1);
  return metadataName.endsWith(HARUKA_METADATA_SUFFIX)
    ? metadataName.slice(0, -HARUKA_METADATA_SUFFIX.length) + ".onnx"
    : "model.onnx";
}

export async function deleteSavedHarukaFiles(meta: HarukaTaggerModelMeta) {
  const opfsRoot = await navigator.storage.getDirectory();
  if (meta.metadataPath) {
    try {
      await opfsRoot.removeEntry(meta.metadataPath);
    } catch (error) {
      console.warn(`Error deleting ${meta.metadataPath}: ${error}`);
    }
  }
}

export async function loadHarukaModelFromZip(
  entries: Entry[],
  fileMap: Map<string, Entry>,
): Promise<HarukaTaggerModelMeta | null> {
  let metadataEntry: FileEntry | undefined;
  let metadataData: ArrayBuffer | undefined;
  let metadataModelName: string | undefined;
  for (const entry of entries) {
    if (entry.directory || !entry.filename.endsWith(HARUKA_METADATA_SUFFIX)) {
      continue;
    }
    const data = await entry.arrayBuffer();
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!isHarukaMetadata(parsed)) {
      continue;
    }
    metadataEntry = entry;
    metadataData = data;
    metadataModelName =
      entry.filename.slice(0, -HARUKA_METADATA_SUFFIX.length) + ".onnx";
    break;
  }
  if (!metadataEntry || !metadataData || !metadataModelName) {
    return null;
  }
  const modelEntry =
    fileMap.get(metadataModelName) ||
    fileMap.get(metadataModelName.replace(/\.onnx$/, ".ort"));
  if (!modelEntry || modelEntry.directory) {
    throw new Error(
      `Could not find ${metadataModelName} in zipped Haruka Tagger model.`,
    );
  }
  const cacheKey = await getCacheKey(HARUKA_MODEL_NAME);
  const cachedModelName = `tagModels-${cacheKey}-model.onnx`;
  const cachedMetadataName = `tagModels-${cacheKey}-metadata.json`;
  try {
    await writeOpfsFile(cachedModelName, await modelEntry.arrayBuffer());
  } catch (writeError) {
    throw new Error(
      `Failed to save model to ${cachedModelName}: ${writeError}`,
    );
  }
  try {
    await writeOpfsFile(cachedMetadataName, metadataData);
  } catch (writeError) {
    throw new Error(
      `Failed to save metadata to ${cachedMetadataName}: ${writeError}`,
    );
  }
  return {
    name: HARUKA_MODEL_NAME,
    type: "haruka",
    modelPath: cachedModelName,
    metadataPath: cachedMetadataName,
  };
}
