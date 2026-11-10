import { type TagModelMeta } from "@/store/modelMetaStore";
import { type AutotagBackend, type Results } from "@/utils/autotag/common";
import {
  type Session,
  loadModel,
  processImage,
} from "@/utils/autotag/inference";

type LoadModelRequest = {
  type: "loadModel";
  meta: TagModelMeta;
  preferWebGPU: boolean;
};

type ProcessImageRequest = {
  type: "processImage";
  threshold: number;
  image: ImageBitmap;
  serial: number;
};

export type WorkerRequest = LoadModelRequest | ProcessImageRequest;

type LoadModelResponse =
  | {
      type: "loadModel";
      error: string;
    }
  | {
      type: "loadModel";
      success: true;
      backend: AutotagBackend;
    };

type ProcessImageResponse =
  | {
      type: "processImage";
      error: string;
      serial: number;
    }
  | {
      type: "processImage";
      results: Results;
      serial: number;
      backend: AutotagBackend;
    };

export type WorkerResponse = LoadModelResponse | ProcessImageResponse;

function postMessage(response: WorkerResponse) {
  self.postMessage(response);
}

// State within the worker
let session: Session | null = null;
let loadedMeta: TagModelMeta | null = null;

// Message handler
self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;
  switch (data.type) {
    case "loadModel":
      try {
        session = await loadModel(data.meta, data.preferWebGPU);
        loadedMeta = data.meta;
        postMessage({
          type: "loadModel",
          success: true,
          backend: session.backend,
        });
      } catch (error) {
        postMessage({
          type: "loadModel",
          error: String(error),
        });
      }
      break;

    case "processImage":
      try {
        const currentSession = session;
        if (!currentSession) {
          throw new Error("No model loaded!");
        }
        let results: Results;
        let backend: AutotagBackend;
        try {
          results = await processImage(
            currentSession,
            data.threshold,
            data.image,
          );
          backend = results.backend ?? currentSession.backend;
        } catch (error) {
          // WebGPU can fail at inference time even when the session was
          // created successfully. Reload the same model on the CPU once and
          // retry this image.
          if (currentSession.backend !== "webgpu" || !loadedMeta) {
            throw error;
          }
          // Release the WebGPU session before loading the CPU one so both
          // full models are never resident at the same time.
          currentSession.modelSession.release();
          session = null;
          const fallbackSession = await loadModel(loadedMeta, false);
          session = fallbackSession;
          results = await processImage(
            fallbackSession,
            data.threshold,
            data.image,
          );
          backend = results.backend ?? fallbackSession.backend;
        }
        postMessage({
          type: "processImage",
          results,
          serial: data.serial,
          backend,
        });
      } catch (error) {
        postMessage({
          type: "processImage",
          error: String(error),
          serial: data.serial,
        });
      }
      break;
  }
});
