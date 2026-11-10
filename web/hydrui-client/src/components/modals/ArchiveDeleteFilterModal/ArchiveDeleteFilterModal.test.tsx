import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileMetadata } from "@/api/types";
import { useShortcut } from "@/hooks/useShortcut";

import ArchiveDeleteFilterModal from "./ArchiveDeleteFilterModal";

const apiMocks = vi.hoisted(() => ({
  deleteFiles: vi.fn(),
  archiveFiles: vi.fn(),
  refreshFileMetadata: vi.fn(),
  getFileUrl: vi.fn(),
}));

vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/widgets/FileViewer/FileViewer", () => ({
  default: () => null,
}));

vi.mock("@/store/apiStore", () => ({
  client: {
    deleteFiles: apiMocks.deleteFiles,
    archiveFiles: apiMocks.archiveFiles,
    getFileUrl: apiMocks.getFileUrl,
  },
}));

vi.mock("@/store/pageStore", () => ({
  usePageActions: () => ({
    refreshFileMetadata: apiMocks.refreshFileMetadata,
  }),
}));

const GridShortcutProbe: React.FC<{
  onArrowLeft: () => void;
  onArrowRight: () => void;
  onArrowUp: () => void;
  onArrowDown: () => void;
}> = ({ onArrowLeft, onArrowRight, onArrowUp, onArrowDown }) => {
  useShortcut({
    ArrowLeft: onArrowLeft,
    ArrowRight: onArrowRight,
    ArrowUp: onArrowUp,
    ArrowDown: onArrowDown,
  });
  return null;
};

function makeFiles(count: number): FileMetadata[] {
  return Array.from({ length: count }, (_, index) => ({
    file_id: index + 1,
    hash: `hash-${index + 1}`,
  }));
}

function makeImageFiles(count: number): FileMetadata[] {
  return makeFiles(count).map((file) => ({ ...file, mime: "image/png" }));
}

interface PreloadedImage {
  crossOriginAtSrc: string | null;
  src: string;
}

function stubImage() {
  const images: PreloadedImage[] = [];
  class MockImage {
    crossOrigin: string | null = null;
    crossOriginAtSrc: string | null = null;
    #src = "";

    constructor() {
      images.push(this);
    }

    get src() {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      this.crossOriginAtSrc = this.crossOrigin;
    }
  }
  vi.stubGlobal("Image", MockImage);
  return images;
}

function press(key: string) {
  return fireEvent.keyDown(document.body, { key });
}

async function openCommitDialog() {
  return screen.findByRole("dialog", {
    name: "Commit Archive/Delete Filter",
  });
}

describe("ArchiveDeleteFilterModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.deleteFiles.mockResolvedValue(undefined);
    apiMocks.archiveFiles.mockResolvedValue(undefined);
    apiMocks.refreshFileMetadata.mockResolvedValue(undefined);
    apiMocks.getFileUrl.mockImplementation(
      (fileId: number) => `http://test/file/${fileId}`,
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preloads the next image with anonymous CORS set before src", () => {
    const images = stubImage();
    render(
      <ArchiveDeleteFilterModal files={makeImageFiles(2)} onClose={vi.fn()} />,
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.crossOriginAtSrc).toBe("anonymous");
    expect(images[0]!.src).toBe("http://test/file/2");
  });

  it("preloads the following image with anonymous CORS after advancing", () => {
    const images = stubImage();
    render(
      <ArchiveDeleteFilterModal files={makeImageFiles(3)} onClose={vi.fn()} />,
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.src).toBe("http://test/file/2");

    press("ArrowRight");

    expect(images).toHaveLength(2);
    expect(images[1]!.crossOriginAtSrc).toBe("anonymous");
    expect(images[1]!.src).toBe("http://test/file/3");
  });

  it("does not preload next files without an image mime type", () => {
    const images = stubImage();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={vi.fn()} />);

    expect(images).toHaveLength(0);
    expect(apiMocks.getFileUrl).not.toHaveBeenCalled();
  });

  it("notes files on the page that are not loaded yet", () => {
    render(
      <ArchiveDeleteFilterModal
        files={makeFiles(2)}
        excludedCount={5}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/5 more files are on this page but not loaded yet/),
    ).toBeInTheDocument();
  });

  it("shows no note when every file is loaded", () => {
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={vi.fn()} />);

    expect(screen.queryByText(/not loaded yet/)).toBeNull();
  });

  it("does not write files before the user commits", async () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    expect(
      screen.getByRole("dialog", { name: "Archive/Delete filter" }),
    ).toHaveAttribute("aria-modal", "true");

    press("ArrowRight");
    press("ArrowLeft");

    const commitDialog = await openCommitDialog();
    expect(commitDialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: /Keep/ })).toBeDisabled();
    expect(apiMocks.deleteFiles).not.toHaveBeenCalled();
    expect(apiMocks.archiveFiles).not.toHaveBeenCalled();
    expect(apiMocks.refreshFileMetadata).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("discards all decisions without writing when Forget is confirmed", async () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    press("ArrowRight");
    press("ArrowLeft");
    await openCommitDialog();

    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(
      await screen.findByText("Quit filtering now and forget your work?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(apiMocks.deleteFiles).not.toHaveBeenCalled();
    expect(apiMocks.archiveFiles).not.toHaveBeenCalled();
    expect(apiMocks.refreshFileMetadata).not.toHaveBeenCalled();
  });

  it("does not signal a refresh when every file is skipped", async () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    press("ArrowUp");
    press("ArrowUp");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(apiMocks.deleteFiles).not.toHaveBeenCalled();
    expect(apiMocks.archiveFiles).not.toHaveBeenCalled();
    expect(apiMocks.refreshFileMetadata).not.toHaveBeenCalled();
  });

  it("prevents handled arrows from leaking to page-level shortcuts", () => {
    const gridArrowLeft = vi.fn();
    const gridArrowRight = vi.fn();
    const gridArrowUp = vi.fn();
    const gridArrowDown = vi.fn();
    const onClose = vi.fn();
    render(
      <>
        <GridShortcutProbe
          onArrowLeft={gridArrowLeft}
          onArrowRight={gridArrowRight}
          onArrowUp={gridArrowUp}
          onArrowDown={gridArrowDown}
        />
        <ArchiveDeleteFilterModal files={makeFiles(5)} onClose={onClose} />
      </>,
    );

    expect(press("ArrowLeft")).toBe(false);
    expect(press("ArrowRight")).toBe(false);
    expect(press("ArrowUp")).toBe(false);
    expect(press("ArrowDown")).toBe(false);

    expect(gridArrowLeft).not.toHaveBeenCalled();
    expect(gridArrowRight).not.toHaveBeenCalled();
    expect(gridArrowUp).not.toHaveBeenCalled();
    expect(gridArrowDown).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("places Delete before Keep so the buttons match their arrow keys", () => {
    const { container } = render(
      <ArchiveDeleteFilterModal files={makeFiles(2)} onClose={vi.fn()} />,
    );

    const actions = container.querySelector(".archive-delete-filter-actions");
    const buttons = Array.from(actions?.querySelectorAll("button") ?? []);

    expect(buttons).toHaveLength(5);
    expect(buttons[0]).toHaveAccessibleName(/Delete/);
    expect(buttons[1]).toHaveAccessibleName(/Keep/);
    expect(
      buttons.map(
        (button) =>
          button.querySelector(".archive-delete-filter-shortcut")?.textContent,
      ),
    ).toEqual(["←", "→", "↑", "↓", "Escape"]);
  });

  it("skips the current file with ArrowUp", () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    expect(press("ArrowUp")).toBe(false);

    expect(screen.getByText(/Skipped: 1/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();
  });

  it("undoes the previous decision with ArrowDown", () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    press("ArrowRight");
    expect(screen.getByText(/Kept: 1/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();

    expect(press("ArrowDown")).toBe(false);

    expect(screen.getByText(/Kept: 0/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
  });

  it("no longer responds to the replaced keys", () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    press("F7");
    press("Delete");
    press("Backspace");

    expect(screen.getByText(/Kept: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Deleted: 0/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the final decision when returning to filtering", async () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(2)} onClose={onClose} />);

    press("ArrowRight");
    press("ArrowLeft");
    await openCommitDialog();
    fireEvent.click(screen.getByRole("button", { name: "Back to filtering" }));

    expect(screen.getByText(/Kept: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Deleted: 0/)).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();

    press("Escape");

    expect(await openCommitDialog()).toBeInTheDocument();
    expect(screen.getByText("Keep 1?")).toBeInTheDocument();
  });

  it("deletes before archiving and refreshes all saved files", async () => {
    const onClose = vi.fn();
    render(<ArchiveDeleteFilterModal files={makeFiles(4)} onClose={onClose} />);

    press("ArrowRight");
    press("ArrowLeft");
    press("ArrowRight");
    press("ArrowLeft");
    await openCommitDialog();
    expect(screen.getByText("Keep 2 and delete 2?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledWith(true);
    expect(apiMocks.deleteFiles).toHaveBeenCalledWith({
      file_ids: [2, 4],
      reason: "Deleted in Archive/Delete filter.",
    });
    expect(apiMocks.archiveFiles).toHaveBeenCalledWith({
      file_ids: [1, 3],
    });
    expect(apiMocks.deleteFiles.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.archiveFiles.mock.invocationCallOrder[0]!,
    );
    expect(apiMocks.refreshFileMetadata).toHaveBeenCalledWith([2, 4, 1, 3]);
  });

  async function openPartialDeleteFailure(onClose: () => void) {
    apiMocks.deleteFiles
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("chunk failed"));
    render(
      <ArchiveDeleteFilterModal files={makeFiles(101)} onClose={onClose} />,
    );

    for (let i = 0; i < 101; i++) {
      press("ArrowLeft");
    }

    await openCommitDialog();
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByText(/Deleting failed: chunk failed/);
  }

  it("keeps the dialog open without signalling a refresh after a partial failure", async () => {
    const onClose = vi.fn();
    await openPartialDeleteFailure(onClose);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Leave..." })).toBeEnabled();
    expect(apiMocks.refreshFileMetadata).toHaveBeenCalledTimes(1);
    expect(apiMocks.refreshFileMetadata).toHaveBeenCalledWith(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });

  it("signals one refresh when leaving after a partial success", async () => {
    const onClose = vi.fn();
    await openPartialDeleteFailure(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Leave..." }));
    expect(
      await screen.findByText(
        "Some changes have already been saved and cannot be undone. Only unsaved decisions will be discarded. Quit filtering now?",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
