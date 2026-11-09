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

const viewerState = vi.hoisted(() => ({
  calls: 0,
  fileId: null as number | null,
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
    loadedFiles: { file_id: number; hash: string }[];
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
  () => ({ default: () => null }),
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

function selection() {
  return usePageStore.getState().selectedFilesByPage["test"] ?? [];
}

describe("PageView touch interactions", () => {
  beforeEach(() => {
    viewerState.calls = 0;
    viewerState.fileId = null;
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
});
