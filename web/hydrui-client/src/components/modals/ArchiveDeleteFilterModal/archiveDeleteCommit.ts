import { ArchiveDeletePlan } from "./archiveDeleteFilter";

export const ARCHIVE_DELETE_CHUNK_SIZE = 100;

export interface ArchiveDeleteSavedFiles {
  readonly deletedFileIds: readonly number[];
  readonly archivedFileIds: readonly number[];
}

export const EMPTY_ARCHIVE_DELETE_SAVED_FILES: ArchiveDeleteSavedFiles = {
  deletedFileIds: [],
  archivedFileIds: [],
};

export type ArchiveDeleteCommitOperation = "delete" | "archive";

export interface ArchiveDeleteCommitApi {
  deleteFiles: (fileIds: readonly number[]) => Promise<void>;
  archiveFiles: (fileIds: readonly number[]) => Promise<void>;
}

export interface ArchiveDeleteCommitSuccess {
  readonly ok: true;
  readonly saved: ArchiveDeleteSavedFiles;
}

export interface ArchiveDeleteCommitFailure {
  readonly ok: false;
  readonly operation: ArchiveDeleteCommitOperation;
  readonly error: unknown;
  readonly saved: ArchiveDeleteSavedFiles;
}

export type ArchiveDeleteCommitResult =
  | ArchiveDeleteCommitSuccess
  | ArchiveDeleteCommitFailure;

export interface ArchiveDeleteCommitOptions {
  chunkSize?: number;
  onProgress?: (saved: ArchiveDeleteSavedFiles) => void;
}

function chunkFileIds(
  fileIds: readonly number[],
  chunkSize: number,
): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    chunks.push(fileIds.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function applyArchiveDeletePlan(
  plan: ArchiveDeletePlan,
  alreadySaved: ArchiveDeleteSavedFiles,
  api: ArchiveDeleteCommitApi,
  options: ArchiveDeleteCommitOptions = {},
): Promise<ArchiveDeleteCommitResult> {
  const chunkSize = options.chunkSize ?? ARCHIVE_DELETE_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid archive/delete chunk size: ${chunkSize}`);
  }

  const savedDeleteFileIds = new Set(alreadySaved.deletedFileIds);
  const savedArchiveFileIds = new Set(alreadySaved.archivedFileIds);

  const snapshot = (): ArchiveDeleteSavedFiles => ({
    deletedFileIds: plan.deleteFileIds.filter((fileId) =>
      savedDeleteFileIds.has(fileId),
    ),
    archivedFileIds: plan.archiveFileIds.filter((fileId) =>
      savedArchiveFileIds.has(fileId),
    ),
  });

  const reportProgress = () => {
    options.onProgress?.(snapshot());
  };

  const pendingDeleteFileIds = plan.deleteFileIds.filter(
    (fileId) => !savedDeleteFileIds.has(fileId),
  );
  try {
    for (const fileIds of chunkFileIds(pendingDeleteFileIds, chunkSize)) {
      await api.deleteFiles(fileIds);
      for (const fileId of fileIds) {
        savedDeleteFileIds.add(fileId);
      }
      reportProgress();
    }
  } catch (error) {
    return {
      ok: false,
      operation: "delete",
      error,
      saved: snapshot(),
    };
  }

  const pendingArchiveFileIds = plan.archiveFileIds.filter(
    (fileId) => !savedArchiveFileIds.has(fileId),
  );
  try {
    for (const fileIds of chunkFileIds(pendingArchiveFileIds, chunkSize)) {
      await api.archiveFiles(fileIds);
      for (const fileId of fileIds) {
        savedArchiveFileIds.add(fileId);
      }
      reportProgress();
    }
  } catch (error) {
    return {
      ok: false,
      operation: "archive",
      error,
      saved: snapshot(),
    };
  }

  return {
    ok: true,
    saved: snapshot(),
  };
}
