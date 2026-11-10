import { type AutotagWorker } from "./worker";

export const TAG_MODEL_IDLE_RELEASE_MS = 5 * 60 * 1000;

interface Entry {
  worker: AutotagWorker;
  preferWebGPU: boolean;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Entry>();
const pendingCreations = new Map<string, Promise<AutotagWorker>>();

export async function acquireTagModelSession(
  name: string,
  preferWebGPU: boolean,
  create: () => Promise<AutotagWorker>,
): Promise<AutotagWorker> {
  const existing = sessions.get(name);
  if (existing) {
    if (existing.preferWebGPU === preferWebGPU || existing.refs > 0) {
      if (existing.timer !== null) {
        clearTimeout(existing.timer);
        existing.timer = null;
      }
      existing.refs++;
      return existing.worker;
    }
    // The cached session is idle and was created with a different backend
    // preference. Dispose it so it can be recreated below.
    disposeTagModelSession(name);
  }

  let creation = pendingCreations.get(name);
  if (!creation) {
    creation = (async () => {
      const worker = await create();
      sessions.set(name, {
        worker,
        preferWebGPU,
        refs: 0,
        timer: null,
      });
      return worker;
    })();
    pendingCreations.set(name, creation);
    void creation
      .finally(() => {
        if (pendingCreations.get(name) === creation) {
          pendingCreations.delete(name);
        }
      })
      .catch(() => {
        // The caller awaiting `creation` handles the failure.
      });
  }

  const worker = await creation;
  const entry = sessions.get(name);
  if (entry) {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.refs++;
  }
  return worker;
}

export function releaseTagModelSession(
  name: string,
  preferWebGPU: boolean,
): void {
  const entry = sessions.get(name);
  if (!entry) {
    return;
  }
  if (entry.refs > 0) {
    entry.refs--;
  }
  if (entry.refs > 0) {
    return;
  }
  if (entry.preferWebGPU !== preferWebGPU) {
    disposeTagModelSession(name);
    return;
  }
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    entry.timer = null;
    disposeTagModelSession(name);
  }, TAG_MODEL_IDLE_RELEASE_MS);
}

export function disposeTagModelSession(name: string): void {
  const entry = sessions.get(name);
  if (!entry) {
    return;
  }
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.worker.release();
  sessions.delete(name);
}

export function disposeAllTagModelSessions(): void {
  for (const name of [...sessions.keys()]) {
    disposeTagModelSession(name);
  }
}
