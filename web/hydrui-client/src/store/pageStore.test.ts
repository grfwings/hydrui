import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SortFilesBy } from "@/constants/sort";

import { client } from "./apiStore";
import { SEARCH_PAGE_KEY, usePageStore } from "./pageStore";
import { useSearchStore } from "./searchStore";

function metadataResponse(fileIds: number[]) {
  return {
    version: 1,
    hydrus_version: 1,
    metadata: fileIds.map((fileId) => ({
      file_id: fileId,
      hash: `hash-${fileId}`,
    })),
  };
}

function resetPageStore() {
  usePageStore.setState({
    fileIds: [],
    fileIdToIndex: new Map(),
    loadedFiles: [],
    loadedFileCount: 0,
    totalFileCount: 0,
    isLoadingFiles: false,
    isLoadingPaused: false,
    isLoadingAwake: false,
    lastRequestId: 0,
    currentAbortController: null,
    metadataLoadController: null,
    error: null,
    activePageKey: null,
    pageType: "search",
    virtualPages: {},
    virtualPageKeys: [],
  });
}

describe("pageStore refreshPage", () => {
  beforeEach(() => {
    resetPageStore();
    useSearchStore.setState({
      searchTags: ["inbox"],
      searchSort: SortFilesBy.IMPORT_TIME,
      searchAscending: false,
      searchResults: [],
      searchStatus: "initial",
      searchError: null,
      autoSearch: false,
      cancelSearch: null,
      serial: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reruns the current search once when refreshing the search page", async () => {
    const searchFiles = vi.spyOn(client, "searchFiles").mockResolvedValue({
      version: 1,
      hydrus_version: 1,
      file_ids: [10, 20],
    });
    useSearchStore.setState({
      searchTags: ["character:test"],
      searchResults: [1],
      searchStatus: "loaded",
      autoSearch: false,
    });
    const updatePageContents = vi
      .spyOn(usePageStore.getState().actions, "updatePageContents")
      .mockResolvedValue(undefined);
    const performSearch = vi.spyOn(
      useSearchStore.getState().actions,
      "performSearch",
    );
    usePageStore.setState({
      activePageKey: SEARCH_PAGE_KEY,
      pageType: "search",
    });

    await usePageStore
      .getState()
      .actions.refreshPage(SEARCH_PAGE_KEY, "search");

    expect(performSearch).toHaveBeenCalledTimes(1);
    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(searchFiles).toHaveBeenCalledWith(
      {
        tags: ["character:test"],
        file_sort_type: SortFilesBy.IMPORT_TIME,
        file_sort_asc: false,
      },
      expect.anything(),
    );
    expect(updatePageContents).toHaveBeenCalledTimes(1);
    expect(updatePageContents).toHaveBeenCalledWith(SEARCH_PAGE_KEY, "search");
  });

  it("keeps the server's search results when refreshing a query page", async () => {
    const searchFiles = vi.spyOn(client, "searchFiles").mockResolvedValue({
      version: 1,
      hydrus_version: 1,
      file_ids: [101, 102],
    });
    const getFileMetadata = vi
      .spyOn(client, "getFileMetadata")
      .mockResolvedValue(metadataResponse([101, 102]));
    useSearchStore.setState({
      searchTags: ["character:test"],
      searchResults: [1],
      searchStatus: "loaded",
      autoSearch: false,
    });
    usePageStore.setState({
      activePageKey: SEARCH_PAGE_KEY,
      pageType: "search",
    });

    await usePageStore
      .getState()
      .actions.refreshPage(SEARCH_PAGE_KEY, "search");

    await vi.waitFor(() => {
      expect(usePageStore.getState().fileIds).toEqual([101, 102]);
    });
    expect(searchFiles).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["character:test"] }),
      expect.anything(),
    );
    expect(getFileMetadata).toHaveBeenCalledWith([101, 102], expect.anything());
  });

  it("uses the existing Hydrus refresh and poll flow", async () => {
    const refreshPage = vi
      .spyOn(client, "refreshPage")
      .mockResolvedValue(undefined);
    const getPageInfo = vi.spyOn(client, "getPageInfo").mockResolvedValue({
      version: 1,
      hydrus_version: 1,
      page_info: {
        name: "Inbox",
        page_key: "page-1",
        page_state: 0,
        page_type: 0,
        is_media_page: true,
        media: { num_files: 2, hash_ids: [1, 2] },
      },
    });
    const updatePageContents = vi
      .spyOn(usePageStore.getState().actions, "updatePageContents")
      .mockResolvedValue(undefined);
    usePageStore.setState({
      activePageKey: "page-1",
      pageType: "hydrus",
    });

    await usePageStore.getState().actions.refreshPage("page-1", "hydrus");

    expect(refreshPage).toHaveBeenCalledWith("page-1");
    expect(getPageInfo).toHaveBeenCalledWith("page-1");
    expect(updatePageContents).toHaveBeenCalledWith("page-1", "hydrus");
  });

  it("refreshes virtual page metadata from its existing file IDs without searching", async () => {
    const searchFiles = vi.spyOn(client, "searchFiles");
    const getFileMetadata = vi
      .spyOn(client, "getFileMetadata")
      .mockResolvedValue(metadataResponse([7, 8]));
    usePageStore.setState({
      activePageKey: "virtual-1",
      pageType: "virtual",
      virtualPages: {
        "virtual-1": { name: "Manual", fileIds: [7, 8] },
      },
    });

    await usePageStore.getState().actions.refreshPage("virtual-1", "virtual");

    expect(searchFiles).not.toHaveBeenCalled();
    expect(getFileMetadata).toHaveBeenCalledWith([7, 8], expect.anything());
    expect(usePageStore.getState().fileIds).toEqual([7, 8]);
    expect(usePageStore.getState().virtualPages["virtual-1"]?.fileIds).toEqual([
      7, 8,
    ]);
  });
});
