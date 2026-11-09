export type ArchiveDeleteDecision = "keep" | "delete" | "skip";

export interface ArchiveDeleteFilterState {
  readonly fileIds: readonly number[];
  readonly index: number;
  readonly decisions: ReadonlyMap<number, ArchiveDeleteDecision>;
  readonly finished: boolean;
}

export interface ArchiveDeleteCounts {
  readonly kept: number;
  readonly deleted: number;
  readonly skipped: number;
}

export interface ArchiveDeletePlan {
  readonly deleteFileIds: readonly number[];
  readonly archiveFileIds: readonly number[];
}

export function createArchiveDeleteFilterState(
  fileIds: readonly number[],
): ArchiveDeleteFilterState {
  return {
    fileIds: [...fileIds],
    index: 0,
    decisions: new Map(),
    finished: fileIds.length === 0,
  };
}

export function getCurrentFileId(
  state: ArchiveDeleteFilterState,
): number | undefined {
  return state.fileIds[state.index];
}

function recordDecision(
  state: ArchiveDeleteFilterState,
  decision: ArchiveDeleteDecision,
): ArchiveDeleteFilterState {
  if (state.finished) {
    return state;
  }

  const fileId = getCurrentFileId(state);
  if (fileId === undefined) {
    return state;
  }

  const decisions = new Map(state.decisions);
  decisions.set(fileId, decision);

  const isLastFile = state.index === state.fileIds.length - 1;
  return {
    ...state,
    index: isLastFile ? state.index : state.index + 1,
    decisions,
    finished: isLastFile,
  };
}

export function keepFile(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  return recordDecision(state, "keep");
}

export function deleteFile(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  return recordDecision(state, "delete");
}

export function skipFile(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  return recordDecision(state, "skip");
}

export function goBack(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  if (state.finished || state.index === 0) {
    return state;
  }

  const previousIndex = state.index - 1;
  const previousFileId = state.fileIds[previousIndex];
  if (previousFileId === undefined) {
    return state;
  }

  const decisions = new Map(state.decisions);
  decisions.delete(previousFileId);
  return {
    ...state,
    index: previousIndex,
    decisions,
  };
}

export function finishFiltering(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  if (state.finished) {
    return state;
  }
  return {
    ...state,
    finished: true,
  };
}

export function returnToFiltering(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteFilterState {
  if (!state.finished) {
    return state;
  }

  const currentFileId = getCurrentFileId(state);
  const decisions = new Map(state.decisions);
  if (currentFileId !== undefined) {
    decisions.delete(currentFileId);
  }
  return {
    ...state,
    decisions,
    finished: false,
  };
}

export function getCounts(
  state: ArchiveDeleteFilterState,
): ArchiveDeleteCounts {
  let kept = 0;
  let deleted = 0;
  let skipped = 0;
  for (const decision of state.decisions.values()) {
    switch (decision) {
      case "keep":
        kept += 1;
        break;
      case "delete":
        deleted += 1;
        break;
      case "skip":
        skipped += 1;
        break;
    }
  }
  return { kept, deleted, skipped };
}

export function buildCommitPlan(
  state: ArchiveDeleteFilterState,
): ArchiveDeletePlan {
  const deleteFileIds: number[] = [];
  const archiveFileIds: number[] = [];
  for (const fileId of state.fileIds) {
    switch (state.decisions.get(fileId)) {
      case "delete":
        deleteFileIds.push(fileId);
        break;
      case "keep":
        archiveFileIds.push(fileId);
        break;
    }
  }
  return { deleteFileIds, archiveFileIds };
}

export function hasCommitDecisions(state: ArchiveDeleteFilterState): boolean {
  const plan = buildCommitPlan(state);
  return plan.deleteFileIds.length > 0 || plan.archiveFileIds.length > 0;
}

export function getCommitSummary(
  state: ArchiveDeleteFilterState,
): string | null {
  const { kept, deleted } = getCounts(state);
  const parts: string[] = [];
  if (kept > 0) {
    parts.push(`Keep ${kept}`);
  }
  if (deleted > 0) {
    parts.push(`delete ${deleted}`);
  }
  if (parts.length === 0) {
    return null;
  }
  const summary = parts.join(" and ");
  return summary.charAt(0).toUpperCase() + summary.slice(1) + "?";
}
