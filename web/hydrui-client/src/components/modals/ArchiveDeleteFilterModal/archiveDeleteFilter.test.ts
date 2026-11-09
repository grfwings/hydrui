import {
  ArchiveDeleteDecision,
  ArchiveDeleteFilterState,
  buildCommitPlan,
  createArchiveDeleteFilterState,
  deleteFile,
  finishFiltering,
  getCommitSummary,
  getCounts,
  getCurrentFileId,
  goBack,
  keepFile,
  returnToFiltering,
  skipFile,
} from "./archiveDeleteFilter";

function makeState(
  fileIds: number[],
  decisions: Array<[number, ArchiveDeleteDecision]> = [],
  finished = false,
): ArchiveDeleteFilterState {
  return {
    fileIds,
    index: 0,
    decisions: new Map(decisions),
    finished,
  };
}

describe("archive delete filter decisions", () => {
  it("keeps the current file and advances", () => {
    const state = keepFile(createArchiveDeleteFilterState([10, 20]));

    expect(state.index).toBe(1);
    expect(state.finished).toBe(false);
    expect(state.decisions.get(10)).toBe("keep");
    expect(getCurrentFileId(state)).toBe(20);
  });

  it("deletes the current file and advances", () => {
    const state = deleteFile(createArchiveDeleteFilterState([10, 20]));

    expect(state.index).toBe(1);
    expect(state.finished).toBe(false);
    expect(state.decisions.get(10)).toBe("delete");
  });

  it("skips the current file and advances", () => {
    const state = skipFile(createArchiveDeleteFilterState([10, 20]));

    expect(state.index).toBe(1);
    expect(state.finished).toBe(false);
    expect(state.decisions.get(10)).toBe("skip");
  });

  it("goes back and removes the previous file's decision", () => {
    let state = createArchiveDeleteFilterState([10, 20, 30]);
    state = keepFile(state);
    state = deleteFile(state);

    const backedUp = goBack(state);

    expect(backedUp.index).toBe(1);
    expect(getCurrentFileId(backedUp)).toBe(20);
    expect(backedUp.decisions.get(20)).toBeUndefined();
    expect(backedUp.decisions.get(10)).toBe("keep");
    expect(getCounts(backedUp)).toEqual({ kept: 1, deleted: 0, skipped: 0 });
  });

  it("does nothing when going back on the first file", () => {
    const state = createArchiveDeleteFilterState([10, 20]);

    expect(goBack(state)).toBe(state);
  });

  it.each([
    ["keep", keepFile],
    ["delete", deleteFile],
    ["skip", skipFile],
  ] as const)("signals finished after %s on the last file", (_, action) => {
    const state = action(createArchiveDeleteFilterState([10, 20]));
    const finished = action(state);

    expect(finished.index).toBe(1);
    expect(finished.finished).toBe(true);
    expect(finished.decisions.get(20)).not.toBeUndefined();
  });

  it("removes the last file's decision when returning from the final commit dialog", () => {
    let state = createArchiveDeleteFilterState([10, 20]);
    state = keepFile(state);
    state = deleteFile(state);
    expect(state.finished).toBe(true);

    const returned = returnToFiltering(state);

    expect(returned.finished).toBe(false);
    expect(returned.index).toBe(1);
    expect(getCurrentFileId(returned)).toBe(20);
    expect(returned.decisions.get(20)).toBeUndefined();
    expect(returned.decisions.get(10)).toBe("keep");
  });

  it("keeps decisions when returning from an early commit dialog", () => {
    let state = createArchiveDeleteFilterState([10, 20, 30]);
    state = keepFile(state);
    state = deleteFile(state);
    state = finishFiltering(state);

    const returned = returnToFiltering(state);

    expect(returned.finished).toBe(false);
    expect(returned.index).toBe(2);
    expect(getCurrentFileId(returned)).toBe(30);
    expect(getCounts(returned)).toEqual({ kept: 1, deleted: 1, skipped: 0 });
  });
});

describe("archive delete filter commit summary", () => {
  it("reports both counts", () => {
    const decisions: Array<[number, ArchiveDeleteDecision]> = [
      [1, "keep"],
      [2, "keep"],
      [3, "delete"],
    ];

    expect(getCommitSummary(makeState([1, 2, 3], decisions))).toBe(
      "Keep 2 and delete 1?",
    );
  });

  it("omits the delete count when nothing is deleted", () => {
    const decisions: Array<[number, ArchiveDeleteDecision]> = [
      [1, "keep"],
      [2, "keep"],
    ];

    expect(getCommitSummary(makeState([1, 2], decisions))).toBe("Keep 2?");
  });

  it("omits the keep count when nothing is kept", () => {
    const decisions: Array<[number, ArchiveDeleteDecision]> = [
      [1, "delete"],
      [2, "skip"],
      [3, "delete"],
    ];

    expect(getCommitSummary(makeState([1, 2, 3], decisions))).toBe("Delete 2?");
  });

  it("returns null when there is nothing to commit", () => {
    expect(getCommitSummary(makeState([1, 2, 3]))).toBeNull();
    expect(
      getCommitSummary(
        makeState(
          [1, 2],
          [
            [1, "skip"],
            [2, "skip"],
          ],
        ),
      ),
    ).toBeNull();
  });
});

describe("archive delete filter commit plan", () => {
  it("lists deleted and kept files in page order", () => {
    const decisions: Array<[number, ArchiveDeleteDecision]> = [
      [40, "keep"],
      [20, "delete"],
      [10, "keep"],
    ];

    expect(buildCommitPlan(makeState([10, 20, 30, 40], decisions))).toEqual({
      deleteFileIds: [20],
      archiveFileIds: [10, 40],
    });
  });

  it("leaves skipped files out of the plan", () => {
    const decisions: Array<[number, ArchiveDeleteDecision]> = [
      [1, "skip"],
      [2, "delete"],
    ];

    expect(buildCommitPlan(makeState([1, 2, 3], decisions))).toEqual({
      deleteFileIds: [2],
      archiveFileIds: [],
    });
  });
});
