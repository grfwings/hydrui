import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type WorkerRequest,
  type WorkerResponse,
} from "@/workers/autotag.worker";

import {
  TAG_MODEL_IDLE_RELEASE_MS,
  acquireTagModelSession,
  disposeAllTagModelSessions,
  releaseTagModelSession,
} from "./modelSession";
import { type AutotagWorker, createAutotagWorker } from "./worker";

vi.mock("./inference", () => ({
  loadModel: vi.fn(),
  processImage: vi.fn(),
}));

function createFakeWorker(): AutotagWorker {
  return {
    backend: "wasm",
    loadModel: vi.fn(async () => "wasm" as const),
    processImage: vi.fn(async () => ({ tagResults: [] })),
    release: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("tag model sessions", () => {
  afterEach(() => {
    disposeAllTagModelSessions();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reuses a cached worker for two acquires", async () => {
    const worker = createFakeWorker();
    const create = vi.fn(async () => worker);

    const first = await acquireTagModelSession("model", false, create);
    const second = await acquireTagModelSession("model", false, create);

    expect(first).toBe(worker);
    expect(second).toBe(worker);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent creates into one promise", async () => {
    const worker = createFakeWorker();
    const pending = deferred<AutotagWorker>();
    const create = vi.fn(() => pending.promise);

    const first = acquireTagModelSession("model", false, create);
    const second = acquireTagModelSession("model", false, create);

    expect(create).toHaveBeenCalledTimes(1);

    pending.resolve(worker);
    const [firstWorker, secondWorker] = await Promise.all([first, second]);

    expect(firstWorker).toBe(worker);
    expect(secondWorker).toBe(worker);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("releases an idle worker after the idle timeout", async () => {
    vi.useFakeTimers();
    const worker = createFakeWorker();
    const create = vi.fn(async () => worker);

    await acquireTagModelSession("model", false, create);
    releaseTagModelSession("model", false);

    expect(worker.release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TAG_MODEL_IDLE_RELEASE_MS);
    expect(worker.release).toHaveBeenCalledTimes(1);
  });

  it("cancels pending disposal when the model is reacquired", async () => {
    vi.useFakeTimers();
    const worker = createFakeWorker();
    const create = vi.fn(async () => worker);

    await acquireTagModelSession("model", false, create);
    releaseTagModelSession("model", false);
    await acquireTagModelSession("model", false, create);

    vi.advanceTimersByTime(TAG_MODEL_IDLE_RELEASE_MS);
    expect(worker.release).not.toHaveBeenCalled();

    releaseTagModelSession("model", false);
    vi.advanceTimersByTime(TAG_MODEL_IDLE_RELEASE_MS);
    expect(worker.release).toHaveBeenCalledTimes(1);
  });

  it("recreates an idle session when the preference changes", async () => {
    const first = createFakeWorker();
    const second = createFakeWorker();
    const create = vi
      .fn<() => Promise<AutotagWorker>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await acquireTagModelSession("model", false, create);
    releaseTagModelSession("model", false);
    const acquired = await acquireTagModelSession("model", true, create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(acquired).toBe(second);
  });

  it("disposes immediately when released with a different preference", async () => {
    vi.useFakeTimers();
    const worker = createFakeWorker();
    const create = vi.fn(async () => worker);

    await acquireTagModelSession("model", false, create);
    releaseTagModelSession("model", true);

    expect(worker.release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TAG_MODEL_IDLE_RELEASE_MS);
    expect(worker.release).toHaveBeenCalledTimes(1);
  });

  it("disposes every session", async () => {
    const first = createFakeWorker();
    const second = createFakeWorker();

    await acquireTagModelSession("first", false, async () => first);
    await acquireTagModelSession("second", true, async () => second);

    disposeAllTagModelSessions();

    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).toHaveBeenCalledTimes(1);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly messages: WorkerRequest[] = [];
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener);
    }
  }

  postMessage(message: WorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {}

  emit(response: WorkerResponse): void {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent);
    }
  }
}

describe("autotag worker process queue", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not run two inferences concurrently", async () => {
    const worker = await createAutotagWorker();
    const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
    if (!instance) {
      throw new Error("Expected a fake worker to be created");
    }

    const image = {} as ImageBitmap;
    const first = worker.processImage(0.5, image);
    const second = worker.processImage(0.5, image);

    await vi.waitFor(() => expect(instance.messages).toHaveLength(1));
    expect(instance.messages[0]).toMatchObject({
      type: "processImage",
      serial: 0,
    });

    instance.emit({
      type: "processImage",
      results: { tagResults: [] },
      serial: 0,
      backend: "wasm",
    });
    await first;

    await vi.waitFor(() => expect(instance.messages).toHaveLength(2));
    expect(instance.messages[1]).toMatchObject({
      type: "processImage",
      serial: 1,
    });

    instance.emit({
      type: "processImage",
      results: { tagResults: [] },
      serial: 1,
      backend: "wasm",
    });
    await second;
  });

  it("keeps running after a rejected inference", async () => {
    const worker = await createAutotagWorker();
    const instance = FakeWorker.instances[FakeWorker.instances.length - 1];
    if (!instance) {
      throw new Error("Expected a fake worker to be created");
    }

    const image = {} as ImageBitmap;
    const first = worker.processImage(0.5, image);
    const second = worker.processImage(0.5, image);

    await vi.waitFor(() => expect(instance.messages).toHaveLength(1));
    instance.emit({
      type: "processImage",
      error: "inference failed",
      serial: 0,
    });
    await expect(first).rejects.toThrow("inference failed");

    await vi.waitFor(() => expect(instance.messages).toHaveLength(2));
    instance.emit({
      type: "processImage",
      results: { tagResults: [] },
      serial: 1,
      backend: "wasm",
    });
    await expect(second).resolves.toMatchObject({ tagResults: [] });
  });
});
