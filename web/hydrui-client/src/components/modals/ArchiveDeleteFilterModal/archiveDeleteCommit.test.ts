import { describe, expect, it, vi } from "vitest";

import {
  ArchiveDeleteCommitApi,
  ArchiveDeleteSavedFiles,
  applyArchiveDeletePlan,
} from "./archiveDeleteCommit";

function makeApi(): {
  api: ArchiveDeleteCommitApi;
  deleteCalls: number[][];
  archiveCalls: number[][];
  deleteFiles: ReturnType<typeof vi.fn>;
  archiveFiles: ReturnType<typeof vi.fn>;
} {
  const deleteCalls: number[][] = [];
  const archiveCalls: number[][] = [];
  const deleteFiles = vi.fn(async (fileIds: readonly number[]) => {
    deleteCalls.push([...fileIds]);
  });
  const archiveFiles = vi.fn(async (fileIds: readonly number[]) => {
    archiveCalls.push([...fileIds]);
  });
  return {
    api: { deleteFiles, archiveFiles },
    deleteCalls,
    archiveCalls,
    deleteFiles,
    archiveFiles,
  };
}

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value++) {
    values.push(value);
  }
  return values;
}

const emptySaved: ArchiveDeleteSavedFiles = {
  deletedFileIds: [],
  archivedFileIds: [],
};

describe("applyArchiveDeletePlan", () => {
  it("chunks deletes before archives", async () => {
    const { api, deleteCalls, archiveCalls } = makeApi();
    const onProgress = vi.fn();

    const result = await applyArchiveDeletePlan(
      {
        deleteFileIds: range(1, 250),
        archiveFileIds: range(251, 400),
      },
      emptySaved,
      api,
      { onProgress },
    );

    expect(result.ok).toBe(true);
    expect(deleteCalls.map((call) => call.length)).toEqual([100, 100, 50]);
    expect(archiveCalls.map((call) => call.length)).toEqual([100, 50]);
    expect(result.saved.deletedFileIds).toEqual(range(1, 250));
    expect(result.saved.archivedFileIds).toEqual(range(251, 400));
    expect(onProgress).toHaveBeenCalledTimes(5);
  });

  it("keeps the first delete chunk when the second delete chunk fails", async () => {
    const { api, deleteCalls, archiveCalls, deleteFiles } = makeApi();
    deleteFiles.mockImplementation(async (fileIds: readonly number[]) => {
      deleteCalls.push([...fileIds]);
      if (deleteCalls.length === 2) {
        throw new Error("delete failed");
      }
    });

    const result = await applyArchiveDeletePlan(
      {
        deleteFileIds: range(1, 250),
        archiveFileIds: [300, 301],
      },
      emptySaved,
      api,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.operation).toBe("delete");
    expect(result.saved.deletedFileIds).toEqual(range(1, 100));
    expect(result.saved.archivedFileIds).toEqual([]);
    expect(deleteCalls.map((call) => call.length)).toEqual([100, 100]);
    expect(archiveCalls).toEqual([]);
  });

  it("retries only the remaining files after a delete failure", async () => {
    const { api, deleteCalls, deleteFiles, archiveFiles } = makeApi();
    deleteFiles.mockImplementation(async (fileIds: readonly number[]) => {
      deleteCalls.push([...fileIds]);
      if (deleteCalls.length === 2) {
        throw new Error("delete failed");
      }
    });

    const firstResult = await applyArchiveDeletePlan(
      {
        deleteFileIds: range(1, 250),
        archiveFileIds: [300, 301],
      },
      emptySaved,
      api,
    );
    expect(firstResult.ok).toBe(false);

    deleteFiles.mockClear();
    archiveFiles.mockClear();
    deleteFiles.mockResolvedValue(undefined);
    const retryResult = await applyArchiveDeletePlan(
      {
        deleteFileIds: range(1, 250),
        archiveFileIds: [300, 301],
      },
      firstResult.saved,
      api,
    );

    const retryDeleteCalls = deleteFiles.mock.calls.map(
      ([fileIds]) => fileIds as number[],
    );
    const retryArchiveCalls = archiveFiles.mock.calls.map(
      ([fileIds]) => fileIds as number[],
    );
    expect(retryResult.ok).toBe(true);
    expect(retryDeleteCalls.map((call) => call.length)).toEqual([100, 50]);
    expect(retryDeleteCalls.flat()).toEqual(range(101, 250));
    expect(retryArchiveCalls).toEqual([[300, 301]]);
    expect(retryResult.saved.deletedFileIds).toEqual(range(1, 250));
  });

  it("keeps completed deletes when an archive chunk fails after them", async () => {
    const { api, deleteCalls, archiveCalls, archiveFiles } = makeApi();
    archiveFiles.mockImplementation(async (fileIds: readonly number[]) => {
      archiveCalls.push([...fileIds]);
      if (archiveCalls.length === 2) {
        throw new Error("archive failed");
      }
    });

    const result = await applyArchiveDeletePlan(
      {
        deleteFileIds: [1, 2, 3],
        archiveFileIds: range(10, 259),
      },
      emptySaved,
      api,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.operation).toBe("archive");
    expect(result.saved.deletedFileIds).toEqual([1, 2, 3]);
    expect(result.saved.archivedFileIds).toEqual(range(10, 109));
    expect(deleteCalls).toEqual([[1, 2, 3]]);
    expect(archiveCalls.map((call) => call.length)).toEqual([100, 100]);
  });

  it("retries only the remaining archives after an archive failure", async () => {
    const { api, archiveCalls, archiveFiles } = makeApi();
    archiveFiles.mockImplementation(async (fileIds: readonly number[]) => {
      archiveCalls.push([...fileIds]);
      if (archiveCalls.length === 2) {
        throw new Error("archive failed");
      }
    });

    const firstResult = await applyArchiveDeletePlan(
      {
        deleteFileIds: [1, 2, 3],
        archiveFileIds: range(10, 259),
      },
      emptySaved,
      api,
    );
    expect(firstResult.ok).toBe(false);

    archiveFiles.mockClear();
    archiveFiles.mockResolvedValue(undefined);
    const retryResult = await applyArchiveDeletePlan(
      {
        deleteFileIds: [1, 2, 3],
        archiveFileIds: range(10, 259),
      },
      firstResult.saved,
      api,
    );

    const retryArchiveCalls = archiveFiles.mock.calls.map(
      ([fileIds]) => fileIds as number[],
    );
    expect(retryResult.ok).toBe(true);
    expect(retryArchiveCalls.map((call) => call.length)).toEqual([100, 50]);
    expect(retryArchiveCalls.flat()).toEqual(range(110, 259));
  });
});
