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
    default: ({ files }: { files: { file_id: number }[] }) => {
      filterState.fileIds = files.map((file) => file.file_id);
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

// jsdom has no layout, so `document.elementFromPoint` does not exist. The
// drag gesture hit-tests through this narrow seam; each test maps pointer
// coordinates onto the rendered file items.
const elementFromPointMock = vi.fn<(x: number, y: number) => Element | null>();
Object.defineProperty(document, "elementFromPoint", {
  configurable: true,
  writable: true,
  value: elementFromPointMock,
});

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

// File 1 occupies x=100, file 2 x=200, and so on.
function hitTestFileAt(clientX: number): Element | null {
  const fileId = Math.round(clientX / 100);
  if (fileId < 1 || fileId > 6) {
    return null;
  }
  return getFileItem(fileId);
}

function selection() {
  return usePageStore.getState().selectedFilesByPage["test"] ?? [];
}

describe("PageView touch interactions", () => {
  beforeEach(() => {
    viewerState.calls = 0;
    viewerState.fileId = null;
    filterState.fileIds = [];
    elementFromPointMock.mockReset();
    elementFromPointMock.mockImplementation((x) => hitTestFileAt(x));
    usePageStore.setState({
      selectedFilesByPage: {},
      activeFileByPage: {},
    });
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

  it("paints thumbnails passed over after a long press without deselecting", () => {
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

    // Dragging back over an already selected file keeps it selected.
    dispatchPointer(first, "pointermove", {
      pointerType: "touch",
      clientX: 100,
      clientY: 10,
    });
    expect(selection()).toEqual([1, 2]);
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
    usePageStore.setState({
      selectedFilesByPage: {},
      activeFileByPage: {},
    });
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

  it("filters every file on the page from the whole-page entry", async () => {
    render(<PageView pageKey="test" />);
    const items = openFileMenu(2);
    expect(selection()).toEqual([2]);

    const entry = items.find(
      (item) => item.id === "archive-delete-filter-page",
    );
    expect(entry?.label).toBe("Archive/Delete Filter (Whole Page)");
    await act(async () => {
      entry?.onClick?.();
    });

    await waitFor(() =>
      expect(filterState.fileIds).toEqual([1, 2, 3, 4, 5, 6]),
    );
  });
});
