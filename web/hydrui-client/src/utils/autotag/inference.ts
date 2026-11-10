import { type InferenceSession } from "onnxruntime-web";

import { type TagModelMeta } from "@/store/modelMetaStore";

import {
  type CamieTaggerSession,
  loadModelCamie,
  preprocessImageCamie,
  processResultsCamie,
} from "./camie";
import { type Results } from "./common";
import {
  type HarukaTaggerSession,
  loadModelHaruka,
  preprocessImageHaruka,
  processResultsHaruka,
} from "./haruka";
import {
  type PixAITaggerSession,
  loadModelPixAI,
  preprocessImagePixAI,
  processResultsPixAI,
} from "./pixai";
import {
  type WDTaggerSession,
  loadModelWD,
  preprocessImageWD,
  processResultsWD,
} from "./wd";

export type Session =
  | WDTaggerSession
  | CamieTaggerSession
  | HarukaTaggerSession
  | PixAITaggerSession;

async function preprocessImage(session: Session, image: ImageBitmap) {
  switch (session.modelType) {
    case "wd":
      return preprocessImageWD(session, image);
    case "camie":
      return preprocessImageCamie(session, image);
    case "haruka":
      return preprocessImageHaruka(session, image);
    case "pixai":
      return preprocessImagePixAI(session, image);
  }
}

function processResults(
  session: Session,
  confidences: Float32Array,
  threshold: number,
): Results {
  switch (session.modelType) {
    case "wd":
      return processResultsWD(session, confidences, threshold);
    case "camie":
      return processResultsCamie(session, confidences, threshold);
    case "haruka":
      return processResultsHaruka(session, confidences, threshold);
    case "pixai":
      return processResultsPixAI(session, confidences, threshold);
  }
}

export async function processImage(
  session: Session,
  threshold: number,
  image: ImageBitmap,
): Promise<Results> {
  const inputTensor = await preprocessImage(session, image);
  if (!session.modelSession.inputNames[0]) {
    throw new Error("Model contains no inputs!");
  }
  const feeds: InferenceSession.FeedsType = {
    [session.modelSession.inputNames[0]]: inputTensor,
  };
  const results = await session.modelSession.run(feeds);
  let confidences: Float32Array | undefined;
  // Look for output by name
  for (const output of session.modelSession.outputMetadata) {
    switch (output.name) {
      case "refined_predictions": // Camie v2
      case "predictions_sigmoid": // SmilingWolf
      case "logits": // Haruka
      case "prediction": // PixAI
      case "probs": {
        // PixAI float16 exports name their already-sigmoided output "probs".
        const result = results[output.name];
        if (result?.data && result.data instanceof Float32Array) {
          confidences = result.data;
          break;
        }
      }
    }
  }
  if (!confidences) {
    // Failing that, look for output by type
    // Choose the last float32 output.
    for (const output of session.modelSession.outputMetadata) {
      if (!output.isTensor) continue;
      if (output.type != "float32") {
        continue;
      }
      const result = results[output.name];
      if (result?.data && result.data instanceof Float32Array) {
        confidences = result.data;
      }
    }
  }
  if (!confidences) {
    throw new Error(`Unable to find Float32Array for tensor output!`);
  }
  return {
    ...processResults(session, confidences, threshold),
    backend: session.backend,
  };
}

export async function loadModel(
  meta: TagModelMeta,
  preferWebGPU = true,
): Promise<Session> {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    throw new Error("Origin Private File System is not available!");
  }
  switch (meta.type) {
    case "wd":
      return loadModelWD(meta, preferWebGPU);
    case "camie":
      return loadModelCamie(meta, preferWebGPU);
    case "haruka":
      return loadModelHaruka(meta, preferWebGPU);
    case "pixai":
      return loadModelPixAI(meta, preferWebGPU);
  }
}

export async function releaseResources(session: Session): Promise<void> {
  session.modelSession.release();
}
