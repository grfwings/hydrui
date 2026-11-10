import { type Entry } from "@zip.js/zip.js";

import { type TagModelMeta } from "@/store/modelMetaStore";

import {
  type CamieMetadata,
  deleteSavedCamieFiles,
  fetchModelFilesCamie,
  loadCamieModelFromZip,
  parseModelInfoCamie,
} from "./camie";
import { getCacheKey, relativeUrl } from "./common";
import {
  type HarukaMetadata,
  deleteSavedHarukaFiles,
  fetchModelFilesHaruka,
  isHarukaMetadata,
  loadHarukaModelFromZip,
  parseModelInfoHaruka,
} from "./haruka";
import {
  type PixAIModelConfig,
  deleteSavedPixAIFiles,
  fetchModelFilesPixAI,
  isPixAIConfig,
  loadPixAIModelFromZip,
  parseModelInfoPixAI,
} from "./pixai";
import {
  type WDTaggerModelInfo,
  deleteSavedWDFiles,
  fetchModelFilesWD,
  loadWDModelFromZip,
  parseModelInfoWD,
} from "./wd";

interface ModelFileNaming {
  extension: "onnx" | "ort";
  resolveModelFile: (modelFile: string) => string;
}

const MODEL_FILE_NAMING: Record<TagModelMeta["type"], ModelFileNaming> = {
  wd: {
    extension: "ort",
    resolveModelFile: (modelFile) => modelFile.replace(".onnx", ".ort"),
  },
  camie: {
    extension: "ort",
    resolveModelFile: (modelFile) => modelFile.replace(".onnx", ".ort"),
  },
  haruka: {
    extension: "onnx",
    resolveModelFile: (modelFile) => modelFile,
  },
  pixai: {
    extension: "onnx",
    resolveModelFile: (modelFile) => modelFile,
  },
};

export async function fetchModelInfo(url: string): Promise<TagModelMeta> {
  const infoResponse = await fetch(url);
  const info:
    | WDTaggerModelInfo
    | CamieMetadata
    | HarukaMetadata
    | PixAIModelConfig = await infoResponse.json();
  if ("model_info" in info && info?.model_info?.architecture) {
    return parseModelInfoCamie(url, info);
  } else if ("modelname" in info) {
    return parseModelInfoWD(url, info);
  } else if (isHarukaMetadata(info)) {
    return parseModelInfoHaruka(url, info);
  } else if (isPixAIConfig(info)) {
    return parseModelInfoPixAI(url, info);
  } else {
    throw new Error("Unrecognized model info format.");
  }
}

export async function fetchModelFiles(
  meta: TagModelMeta,
): Promise<TagModelMeta> {
  if (!meta.url) {
    throw new Error("Model entry does not have a URL!");
  }
  if (!navigator.storage || !navigator.storage.getDirectory) {
    throw new Error("Origin Private File System is not available!");
  }
  const opfsRoot = await navigator.storage.getDirectory();
  meta = await fetchModelInfo(meta.url);
  const cacheKey = await getCacheKey(meta.name);
  if (!meta.url) {
    throw new Error("Inconsistent state: URL missing in fetched model");
  }
  let modelFile = "model.onnx";
  switch (meta.type) {
    case "wd":
      modelFile = await fetchModelFilesWD(meta);
      break;
    case "camie":
      modelFile = await fetchModelFilesCamie(meta);
      break;
    case "haruka":
      modelFile = await fetchModelFilesHaruka(meta);
      break;
    case "pixai":
      modelFile = await fetchModelFilesPixAI(meta);
      break;
  }
  // Fetch the actual ONNX model weights
  const naming = MODEL_FILE_NAMING[meta.type];
  const cachedModelName = `tagModels-${cacheKey}-model.${naming.extension}`;
  const modelUrl = relativeUrl(meta.url, naming.resolveModelFile(modelFile));
  const modelResponse = await fetch(modelUrl);
  try {
    const fileHandle = await opfsRoot.getFileHandle(cachedModelName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(await modelResponse.blob());
    await writable.close();
  } catch (writeError) {
    console.warn(`Failed to save model to ${cachedModelName}: ${writeError}`);
  }
  meta.modelPath = cachedModelName;
  return meta;
}

export async function deleteSavedFiles(meta: TagModelMeta) {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    throw new Error("Origin Private File System is not available!");
  }
  const opfsRoot = await navigator.storage.getDirectory();
  if (meta.modelPath) {
    try {
      await opfsRoot.removeEntry(meta.modelPath);
    } catch (error) {
      console.warn(`Error deleting ${meta.modelPath}: ${error}`);
    }
  }
  switch (meta.type) {
    case "wd":
      deleteSavedWDFiles(meta);
      break;
    case "camie":
      deleteSavedCamieFiles(meta);
      break;
    case "haruka":
      deleteSavedHarukaFiles(meta);
      break;
    case "pixai":
      deleteSavedPixAIFiles(meta);
      break;
  }
}

export async function setupZippedTagModel(zip: Blob): Promise<TagModelMeta> {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    throw new Error("Origin Private File System is not available!");
  }
  const { BlobReader, ZipReader } = await import("../zipjs");
  const blobReader = new BlobReader(zip);
  const zipReader = new ZipReader(blobReader);
  const entries = await zipReader.getEntries();
  const fileMap: Map<string, Entry> = new Map();
  for (const entry of entries) {
    fileMap.set(entry.filename, entry);
  }
  const harukaModel = await loadHarukaModelFromZip(entries, fileMap);
  if (harukaModel !== null) {
    return harukaModel;
  }
  const camieModel = await loadCamieModelFromZip(entries, fileMap);
  if (camieModel !== null) {
    return camieModel;
  }
  const wdModel = await loadWDModelFromZip(fileMap);
  if (wdModel !== null) {
    return wdModel;
  }
  const pixaiModel = await loadPixAIModelFromZip(entries, fileMap);
  if (pixaiModel !== null) {
    return pixaiModel;
  }
  throw new Error(
    "Could not find model info in ZIP file (No WD info.json, no Camie or Haruka metadata.json, no PixAI config.json)",
  );
}
