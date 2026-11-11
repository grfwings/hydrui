import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextMenuStore } from "@/store/contextMenuStore";
import { usePageStore } from "@/store/pageStore";

import PageView from "./PageView";
import {
  TOUCH_DRAG_EDGE_MAX_SPEED,
  getEdgeScrollSpeed,
} from "./useTouchDragSelect";

const viewerState = vi.hoisted(() => ({
  calls: 0,
  fileId: null as number | null,
}));

const filterState = vi.hoisted(() => ({
  fileIds: [] as number[],
  excludedCount: 0,
}));

vi.mock("@/store/pageStore", async () => {
  const { create } = await import("zustand");
  const fileIds = [1, 2, 3, 4, 5, 6];
  const fileIdToIndex = new Map(
    fileIds.map((fileId, index) => [fileId, index]),
  );

  interface MockPageState {
    activePageKey: string;
    fileIds: number[];
    fileIdToIndex: Map<number, number>;
    selectedFilesByPage: Record<string, number[]>;
    activeFileByPage: Record<string, number | null>;
    loadedFiles: {
      file_id: number;
      hash: string;
      is_local: boolean;
      is_trashed: boolean;
    }[];
    metadataLoadController: null;
    isLoadingFiles: boolean;
    error: null;
    pageType: string;
    actions: Record<string, unknown>;
  }

  const usePageStore = create<MockPageState>((set) => ({
    activePageKey: "test",
    fileIds,
    fileIdToIndex,
    selectedFilesByPage: {},
    activeFileByPage: {},
    loadedFiles: fileIds.map((fileId) => ({
      file_id: fileId,
      hash: `hash-${fileId}`,
      is_local: true,
      is_trashed: false,
    })),
    metadataLoadController: null,
    isLoadingFiles: false,
    error: null,
    pageType: "hydrui",
    actions: {
      addVirtualPage: () => {},
      setPage: () => {},
      setSelectedFiles: (pageKey: string, ids: number[]) =>
        set((state) => ({
          selectedFilesByPage: {
            ...state.selectedFilesByPage,
            [pageKey]: ids,
          },
        })),
      addSelectedFiles: (pageKey: string, ids: number[]) =>
        set((state) => {
          const byPage = state.selectedFilesByPage;
          return {
            selectedFilesByPage: {
              ...byPage,
              [pageKey]: [...new Set([...(byPage[pageKey] || []), ...ids])],
            },
          };
        }),
      clearSelectedFiles: (pageKey: string) =>
        set((state) => {
          const byPage = { ...state.selectedFilesByPage };
          delete byPage[pageKey];
          return { selectedFilesByPage: byPage };
        }),
      updatePageContents: async () => {},
      refreshPage: async () => {},
      setActiveFileId: (pageKey: string, fileId: number | null) =>
        set((state) => ({
          activeFileByPage: {
            ...state.activeFileByPage,
            [pageKey]: fileId,
          },
        })),
      markActiveFileAsBetter: async () => {},
      addFilesToPage: async () => {},
      removeFilesFromPage: async () => {},
      archiveFiles: async () => {},
      unarchiveFiles: async () => {},
      deleteFiles: async () => {},
      undeleteFiles: async () => {},
    },
  }));

  return { usePageStore };
});

vi.mock("@/store/preferencesStore", () => ({
  usePreferencesStore: () => ({
    thumbnailSize: 100,
    useVirtualViewport: false,
    allowTokenPassing: false,
  }),
}));

vi.mock("@/store/searchStore", () => ({
  useSearchStore: () => ({
    searchStatus: "loaded",
    searchTags: [],
    searchError: null,
  }),
}));

vi.mock("@/store/toastStore", () => ({
  useToastStore: () => ({
    actions: {
      addToast: () => "toast",
      removeToast: () => {},
      updateToastProgress: () => {},
    },
  }),
}));

vi.mock("@/store/apiStore", () => ({
  useApiStore: {
    subscribe: () => () => {},
    getState: () => ({ isAuthenticated: false }),
  },
  client: {
    getFileUrl: (fileId: number) => `/file/${fileId}`,
    getThumbnailUrl: (fileId: number) => `/thumbnail/${fileId}`,
    getBridgeUrl: (fileId: number) => Promise.resolve(`/bridge/${fileId}`),
    searchFiles: async () => ({ file_ids: [] }),
    getFileRelationships: async () => ({ file_relationships: {} }),
    getFileIdsByHashes: async () => ({ metadata: [] }),
  },
}));

vi.mock("@/file/renderers", () => ({
  renderDispatch: () => ({}),
}));

// jsdom has no layout. Pin the grid width so geometry-driven selection sees a
// realistic three-column grid instead of the zero-width single column.
vi.mock("./gridMetrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gridMetrics")>();
  return {
    ...actual,
    computeGridMetrics: (
      ...args: Parameters<typeof actual.computeGridMetrics>
    ) => actual.computeGridMetrics(448, args[1], args[2], args[3]),
  };
});

vi.mock("@/components/modals/FileViewerModal/FileViewerModal", () => ({
  default: ({ fileId }: { fileId: number }) => {
    viewerState.calls += 1;
    viewerState.fileId = fileId;
    return null;
  },
}));

vi.mock(
  "@/components/modals/ArchiveDeleteFilterModal/ArchiveDeleteFilterModal",
  () => ({
    default: ({
      files,
      excludedCount,
    }: {
      files: { file_id: number }[];
      excludedCount?: number;
    }) => {
      filterState.fileIds = files.map((file) => file.file_id);
      filterState.excludedCount = excludedCount ?? 0;
      return null;
    },
  }),
);
vi.mock("@/components/modals/BatchAutoTagModal/BatchAutoTagModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/ConfirmModal/ConfirmModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/EditNotesModal/EditNotesModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/EditTagsModal/EditTagsModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/EditUrlsModal/EditUrlsModal", () => ({
  default: () => null,
}));
vi.mock(
  "@/components/modals/ExpressionFilterModal/ExpressionFilterModal",
  () => ({ default: () => null }),
);
vi.mock("@/components/modals/ExpressionSortModal/ExpressionSortModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/ImportUrlsModal/ImportUrlsModal", () => ({
  default: () => null,
}));
vi.mock("@/components/modals/TokenPassingModal/TokenPassingModal", () => ({
  default: () => null,
}));

// With the pinned 448px grid, cells are 100px with a 16px gap and 16px
// padding, so cell centers sit at 74 + 116 * column/row.
const DEFAULT_FILE_IDS = [1, 2, 3, 4, 5, 6];

function resetPageStore(fileIds: number[] = DEFAULT_FILE_IDS) {
  usePageStore.setState({
    fileIds,
    fileIdToIndex: new Map(fileIds.map((fileId, index) => [fileId, index])),
    loadedFiles: fileIds.map((fileId) => ({
      file_id: fileId,
      hash: `hash-${fileId}`,
      is_local: true,
      is_trashed: false,
    })),
    selectedFilesByPage: {},
    activeFileByPage: {},
  });
}

function dispatchPointer(
  target: Element,
  type: string,
  properties: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const values: Record<string, unknown> = {
    pointerType: "touch",
    button: 0,
    clientX: 0,
    clientY: 0,
    ...properties,
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  fireEvent(target, event);
}

function getFileItem(fileId: number) {
  return screen.getByRole("button", { name: `File ${fileId}` });
}

// Centre of a cell in the pinned three-column grid, in client coordinates.
function cellPoint(index: number) {
  return {
    clientX: 74 + 116 * (index % 3),
    clientY: 74 + 116 * Math.floor(index / 3),
  };
}

function fileIdsFor(...indices: number[]) {
  return indices.map((index) => index + 1);
}

function indexRange(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function selection() {
  return usePageStore.getState().selectedFilesByPage["test"] ?? [];
}

describe("PageView touch interactions", () => {
  beforeEach(() => {
    viewerState.calls = 0;
    viewerState.fileId = null;
    filterState.fileIds = [];
    resetPageStore();
    useContextMenuStore.getState().actions.closeMenu();
  });

  afterEach(() => {
    act(() => {
      useContextMenuStore.getState().actions.closeMenu();
    });
    vi.useRealTimers();
  });

  it("opens the viewer when a thumbnail is tapped with a touch pointer", async () => {
    render(<PageView pageKey="test" />);
    const item = getFileItem(1);

    dispatchPointer(item, "pointerdown", { pointerType: "touch" });
    dispatchPointer(item, "pointerup", { pointerType: "touch" });
    fireEvent.click(item, { detail: 1 });

    await waitFor(() => expect(viewerState.calls).toBe(1));
    expect(viewerState.fileId).toBe(1);
    // A touch tap opens; it does not select.
    expect(selection()).toEqual([]);
  });

  it("keeps mouse click selection and double-click opening unchanged", async () => {
    render(<PageView pageKey="test" />);
    const item = getFileItem(2);

    dispatchPointer(item, "pointerdown", { pointerType: "mouse", button: 0 });
    fireEvent.click(item, { detail: 1 });

    expect(selection()).toEqual([2]);
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(viewerState.calls).toBe(0);

    fireEvent.doubleClick(item, { detail: 2 });
    await waitFor(() => expect(viewerState.calls).toBe(1));
    expect(viewerState.fileId).toBe(2);
  });

  it("enters selection mode on long press and swallows the following click", async () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const item = getFileItem(1);

    dispatchPointer(item, "pointerdown", { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(selection()).toEqual([1]);
    expect(
      within(screen.getByRole("toolbar")).getByText("1 selected"),
    ).toBeInTheDocument();

    // Releasing and the synthetic click must not toggle the file off or open
    // the viewer.
    dispatchPointer(item, "pointerup", { pointerType: "touch" });
    fireEvent.click(item, { detail: 1 });

    expect(selection()).toEqual([1]);
    expect(viewerState.calls).toBe(0);
  });

  it("toggles selection when tapping thumbnails in selection mode", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);

    dispatchPointer(getFileItem(1), "pointerdown", { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const second = getFileItem(2);
    dispatchPointer(second, "pointerdown", { pointerType: "touch" });
    dispatchPointer(second, "pointerup", { pointerType: "touch" });
    fireEvent.click(second, { detail: 1 });

    expect(selection().sort()).toEqual([1, 2]);
    expect(
      within(screen.getByRole("toolbar")).getByText("2 selected"),
    ).toBeInTheDocument();

    dispatchPointer(second, "pointerdown", { pointerType: "touch" });
    dispatchPointer(second, "pointerup", { pointerType: "touch" });
    fireEvent.click(second, { detail: 1 });

    expect(selection()).toEqual([1]);
    expect(
      within(screen.getByRole("toolbar")).getByText("1 selected"),
    ).toBeInTheDocument();
  });

  it("suppresses the native contextmenu from a touch long press", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const item = getFileItem(1);

    dispatchPointer(item, "pointerdown", { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.contextMenu(item, { clientX: 20, clientY: 20 });

    expect(useContextMenuStore.getState().isOpen).toBe(false);
    expect(useContextMenuStore.getState().items).toEqual([]);
  });

  it("still opens the context menu on a mouse right-click", () => {
    render(<PageView pageKey="test" />);
    const item = getFileItem(3);

    dispatchPointer(item, "pointerdown", { pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(item, { clientX: 20, clientY: 30 });

    expect(useContextMenuStore.getState().isOpen).toBe(true);
    expect(useContextMenuStore.getState().items.length).toBeGreaterThan(0);
    expect(selection()).toEqual([3]);
  });

  it("opens the existing file menu from the selection bar Actions button", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);

    dispatchPointer(getFileItem(1), "pointerdown", { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for selected files" }),
    );

    expect(useContextMenuStore.getState().isOpen).toBe(true);
    expect(useContextMenuStore.getState().items.length).toBeGreaterThan(0);
    expect(selection()).toEqual([1]);
  });

  it("exits selection mode from the bar", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);

    dispatchPointer(getFileItem(1), "pointerdown", { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Exit selection mode" }),
    );

    expect(selection()).toEqual([]);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("paints the reading-order range spanned by the long press and the pointer", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const first = getFileItem(1);

    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual([1]);

    // Movement below the start threshold must not begin painting.
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 105,
      clientY: 10,
    });
    expect(selection()).toEqual([1]);

    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2]);
    expect(getFileItem(2)).toHaveClass("file-item-touch-selected");
    expect(
      within(screen.getByRole("toolbar")).getByText("2 selected"),
    ).toBeInTheDocument();
    expect(usePageStore.getState().activeFileByPage["test"]).toBe(2);

    // Dragging back to the anchor shrinks the range to the base selection.
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    expect(selection()).toEqual([1]);
    expect(usePageStore.getState().activeFileByPage["test"]).toBe(1);

    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 300,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2, 3]);
    expect(
      within(screen.getByRole("toolbar")).getByText("3 selected"),
    ).toBeInTheDocument();

    // Releasing ends the paint but keeps touch selection mode.
    dispatchPointer(first, "pointerup", {
      pointerType: "touch",
      clientX: 300,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2, 3]);
    expect(
      within(screen.getByRole("toolbar")).getByText("3 selected"),
    ).toBeInTheDocument();

    // Further movement after release does nothing.
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 400,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2, 3]);
  });

  it("selects the reading-order range across rows and shrinks it again", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);
    const anchor = getFileItem(1);

    dispatchPointer(anchor, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual([1]);

    // One cell to the right, same row.
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(1),
    });
    expect(selection()).toEqual([1, 2]);

    // Two rows down in the middle column. Every cell in reading order between
    // the anchor and the pointer is filled, including the middle row.
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(7),
    });
    expect(selection()).toEqual(fileIdsFor(...indexRange(0, 7)));
    expect(document.querySelectorAll(".file-item-touch-selected")).toHaveLength(
      8,
    );
    expect(
      within(screen.getByRole("toolbar")).getByText("8 selected"),
    ).toBeInTheDocument();
    expect(usePageStore.getState().activeFileByPage["test"]).toBe(8);

    // Dragging back to the anchor removes the range-only cells.
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    expect(selection()).toEqual([1]);
    expect(document.querySelectorAll(".file-item-touch-selected")).toHaveLength(
      1,
    );
    expect(
      within(screen.getByRole("toolbar")).getByText("1 selected"),
    ).toBeInTheDocument();

    dispatchPointer(anchor, "pointerup", {
      pointerType: "touch",
      ...cellPoint(0),
    });
  });

  it("starts another range drag from a long press while already in selection mode", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);

    // Enter selection mode on the first file and release.
    const first = getFileItem(1);
    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(first, "pointerup", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    expect(selection()).toEqual([1]);

    // A second long press on the unselected file 4 adds it and arms a drag.
    const second = getFileItem(4);
    dispatchPointer(second, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(3),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual([1, 4]);

    // Drag to the next row and column: the reading-order range 3..7 is added.
    dispatchPointer(second, "pointermove", {
      pointerType: "touch",
      ...cellPoint(7),
    });
    expect(selection()).toEqual([1, 4, 5, 6, 7, 8]);
  });

  it("keeps the rest of the last row selected when a select drag moves back one cell", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);
    const anchor = getFileItem(1);

    dispatchPointer(anchor, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual([1]);

    // Drag across the whole page: all twelve cells are selected.
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(11),
    });
    expect(selection()).toEqual(fileIdsFor(...indexRange(0, 11)));
    expect(document.querySelectorAll(".file-item-touch-selected")).toHaveLength(
      12,
    );

    // One cell back along the last row must drop only index 11, not the whole
    // right column the old rectangle selected.
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(10),
    });
    expect(selection()).toEqual(fileIdsFor(...indexRange(0, 10)));
    expect(document.querySelectorAll(".file-item-touch-selected")).toHaveLength(
      11,
    );
    expect(
      within(screen.getByRole("toolbar")).getByText("11 selected"),
    ).toBeInTheDocument();
    expect(usePageStore.getState().activeFileByPage["test"]).toBe(11);

    dispatchPointer(anchor, "pointerup", {
      pointerType: "touch",
      ...cellPoint(10),
    });
    expect(selection()).toEqual(fileIdsFor(...indexRange(0, 10)));
  });

  it("deselects the reading-order range from a long press on a selected cell", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);

    // Select the whole page with a drag and lift.
    const anchor = getFileItem(1);
    dispatchPointer(anchor, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(anchor, "pointermove", {
      pointerType: "touch",
      ...cellPoint(11),
    });
    dispatchPointer(anchor, "pointerup", {
      pointerType: "touch",
      ...cellPoint(11),
    });
    expect(selection()).toEqual(fileIdsFor(...indexRange(0, 11)));

    // Long press the selected index 5. The anchor is removed at press time.
    const selected = getFileItem(6);
    dispatchPointer(selected, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(5),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual(fileIdsFor(0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11));

    // Dragging to index 8 removes the reading-order range 5..8, and leaves
    // every other cell selected.
    dispatchPointer(selected, "pointermove", {
      pointerType: "touch",
      ...cellPoint(8),
    });
    expect(selection()).toEqual(fileIdsFor(0, 1, 2, 3, 4, 9, 10, 11));
    expect(document.querySelectorAll(".file-item-touch-selected")).toHaveLength(
      8,
    );
    expect(usePageStore.getState().activeFileByPage["test"]).toBe(9);

    // Shrinking the range restores the cells the drag had removed.
    dispatchPointer(selected, "pointermove", {
      pointerType: "touch",
      ...cellPoint(6),
    });
    expect(selection()).toEqual(fileIdsFor(0, 1, 2, 3, 4, 7, 8, 9, 10, 11));

    dispatchPointer(selected, "pointerup", {
      pointerType: "touch",
      ...cellPoint(6),
    });
  });

  it("adds the range from a long press on an unselected cell in selection mode", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);

    // Enter selection mode on file 1 and release.
    const first = getFileItem(1);
    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(first, "pointerup", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    expect(selection()).toEqual([1]);

    // Long press the unselected index 4: only the anchor is added first.
    const unselected = getFileItem(5);
    dispatchPointer(unselected, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(4),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(selection()).toEqual([1, 5]);

    // Dragging to index 6 adds the reading-order range 4..6.
    dispatchPointer(unselected, "pointermove", {
      pointerType: "touch",
      ...cellPoint(6),
    });
    expect(selection()).toEqual([1, 5, 6, 7]);

    dispatchPointer(unselected, "pointerup", {
      pointerType: "touch",
      ...cellPoint(6),
    });
  });

  it("deselects a stationary selected long press and selects a stationary unselected one", () => {
    vi.useFakeTimers();
    resetPageStore(Array.from({ length: 12 }, (_, index) => index + 1));
    render(<PageView pageKey="test" />);

    const first = getFileItem(1);
    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(first, "pointerup", {
      pointerType: "touch",
      ...cellPoint(0),
    });
    expect(selection()).toEqual([1]);

    // A stationary press on the unselected file 3 selects only it.
    const third = getFileItem(3);
    dispatchPointer(third, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(2),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(third, "pointerup", {
      pointerType: "touch",
      ...cellPoint(2),
    });
    expect(selection()).toEqual([1, 3]);

    // Pressing the now selected file 3 deselects only it.
    dispatchPointer(third, "pointerdown", {
      pointerType: "touch",
      ...cellPoint(2),
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(third, "pointerup", {
      pointerType: "touch",
      ...cellPoint(2),
    });
    expect(selection()).toEqual([1]);
  });

  it("stops painting when the pointer is cancelled", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const first = getFileItem(1);

    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2]);

    dispatchPointer(first, "pointercancel", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 300,
      clientY: 10,
    });

    expect(selection()).toEqual([1, 2]);
  });

  it("never starts painting for a mouse pointer", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const first = getFileItem(1);

    dispatchPointer(first, "pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(selection()).toEqual([]);

    dispatchPointer(first, "pointermove", {
      pointerType: "mouse",
      clientX: 300,
      clientY: 10,
    });
    expect(selection()).toEqual([]);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("blocks native touch scrolling only while painting", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const first = getFileItem(1);

    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const beforePaint = new Event("touchmove", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(beforePaint);
    expect(beforePaint.defaultPrevented).toBe(false);

    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });

    const whilePainting = new Event("touchmove", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(whilePainting);
    expect(whilePainting.defaultPrevented).toBe(true);

    dispatchPointer(first, "pointerup", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });

    const afterRelease = new Event("touchmove", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(afterRelease);
    expect(afterRelease.defaultPrevented).toBe(false);
  });

  it("does not paint while the context menu is open", () => {
    vi.useFakeTimers();
    render(<PageView pageKey="test" />);
    const first = getFileItem(1);

    dispatchPointer(first, "pointerdown", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      useContextMenuStore.getState().actions.openMenu({ x: 0, y: 0 }, []);
    });

    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 200,
      clientY: 10,
    });
    expect(selection()).toEqual([1]);
  });
});

describe("getEdgeScrollSpeed", () => {
  it("does not scroll away from the edges", () => {
    expect(getEdgeScrollSpeed(300, 0, 600)).toBe(0);
  });

  it("treats the threshold boundaries as no scroll", () => {
    expect(getEdgeScrollSpeed(48, 0, 600)).toBe(0);
    expect(getEdgeScrollSpeed(552, 0, 600)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(getEdgeScrollSpeed(10, 0, 600)).toBeLessThan(0);
    expect(getEdgeScrollSpeed(590, 0, 600)).toBeGreaterThan(0);
  });

  it("ramps up to the maximum speed at an edge", () => {
    expect(getEdgeScrollSpeed(-20, 0, 600)).toBe(-TOUCH_DRAG_EDGE_MAX_SPEED);
    expect(getEdgeScrollSpeed(620, 0, 600)).toBe(TOUCH_DRAG_EDGE_MAX_SPEED);
  });
});

describe("PageView Archive/Delete filter scope", () => {
  beforeEach(() => {
    filterState.fileIds = [];
    filterState.excludedCount = 0;
    resetPageStore();
    useContextMenuStore.getState().actions.closeMenu();
  });

  afterEach(() => {
    act(() => {
      useContextMenuStore.getState().actions.closeMenu();
    });
  });

  function openFileMenu(fileId: number) {
    const item = getFileItem(fileId);
    dispatchPointer(item, "pointerdown", { pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(item, { clientX: 20, clientY: 20 });
    return useContextMenuStore.getState().items;
  }

  it("filters only the selection from the selection-based entry", async () => {
    render(<PageView pageKey="test" />);
    const items = openFileMenu(2);
    expect(selection()).toEqual([2]);

    const entry = items.find((item) => item.id === "archive-delete-filter");
    await act(async () => {
      entry?.onClick?.();
    });

    await waitFor(() => expect(filterState.fileIds).toEqual([2]));
  });

  it("filters every file on the page when nothing is selected", async () => {
    render(<PageView pageKey="test" />);
    const grid = document.querySelector(".files-grid");
    if (!(grid instanceof Element)) throw new Error("grid not found");
    dispatchPointer(grid, "pointerdown", { pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(grid, { clientX: 20, clientY: 20 });

    const items = useContextMenuStore.getState().items;
    expect(items.some((item) => item.id === "archive-delete-filter-page")).toBe(
      false,
    );
    const entry = items.find((item) => item.id === "archive-delete-filter");
    await act(async () => {
      entry?.onClick?.();
    });

    await waitFor(() =>
      expect(filterState.fileIds).toEqual([1, 2, 3, 4, 5, 6]),
    );
  });

  it("limits a whole-page filter to files whose metadata is loaded", async () => {
    usePageStore.setState({
      loadedFiles: [
        {
          file_id: 1,
          hash: "hash-1",
          is_local: true,
          is_trashed: false,
        },
        {
          file_id: 2,
          hash: "hash-2",
          is_local: true,
          is_trashed: false,
        },
      ],
    });

    render(<PageView pageKey="test" />);
    const grid = document.querySelector(".files-grid");
    if (!(grid instanceof Element)) throw new Error("grid not found");
    dispatchPointer(grid, "pointerdown", { pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(grid, { clientX: 20, clientY: 20 });

    const entry = useContextMenuStore
      .getState()
      .items.find((item) => item.id === "archive-delete-filter");
    await act(async () => {
      entry?.onClick?.();
    });

    await waitFor(() => expect(filterState.fileIds).toEqual([1, 2]));
    expect(filterState.excludedCount).toBe(4);
  });
});
