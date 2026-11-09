import { FocusTrap } from "focus-trap-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FileMetadata } from "@/api/types";
import ConfirmModal from "@/components/modals/ConfirmModal/ConfirmModal";
import FileViewer from "@/components/widgets/FileViewer/FileViewer";
import PushButton from "@/components/widgets/PushButton/PushButton";
import { useShortcut } from "@/hooks/useShortcut";
import { client } from "@/store/apiStore";
import { usePageActions } from "@/store/pageStore";
import { useToastStore } from "@/store/toastStore";

import ArchiveDeleteCommitDialog from "./ArchiveDeleteCommitDialog";
import {
  ArchiveDeleteCommitOperation,
  ArchiveDeleteSavedFiles,
  EMPTY_ARCHIVE_DELETE_SAVED_FILES,
  applyArchiveDeletePlan,
} from "./archiveDeleteCommit";
import {
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
import "./index.css";

const DELETE_REASON = "Deleted in Archive/Delete filter.";
const IMAGE_MIME_PREFIX = "image/";

type DialogMode = "none" | "commit" | "forget";

interface ApplyError {
  operation: ArchiveDeleteCommitOperation;
  message: string;
}

interface ArchiveDeleteFilterModalProps {
  files: FileMetadata[];
  onClose: () => void;
}

const ArchiveDeleteFilterModal: React.FC<ArchiveDeleteFilterModalProps> = ({
  files,
  onClose,
}) => {
  const [filter, setFilter] = useState<ArchiveDeleteFilterState>(() =>
    createArchiveDeleteFilterState(files.map((file) => file.file_id)),
  );
  const [dialog, setDialog] = useState<DialogMode>("none");
  const [isApplying, setIsApplying] = useState(false);
  const [savedFiles, setSavedFiles] = useState<ArchiveDeleteSavedFiles>(
    EMPTY_ARCHIVE_DELETE_SAVED_FILES,
  );
  const [applyError, setApplyError] = useState<ApplyError | null>(null);

  const isApplyingRef = useRef(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const { refreshFileMetadata } = usePageActions();
  const { addToast } = useToastStore((state) => state.actions);

  const filesById = useMemo(
    () => new Map(files.map((file) => [file.file_id, file])),
    [files],
  );
  const plan = useMemo(() => buildCommitPlan(filter), [filter]);

  const currentFileId = getCurrentFileId(filter);
  const currentFile =
    currentFileId === undefined ? undefined : filesById.get(currentFileId);
  const counts = getCounts(filter);
  const summary = getCommitSummary(filter);
  const nextFileId = filter.fileIds[filter.index + 1];

  const totalDeleted = plan.deleteFileIds.length;
  const totalArchived = plan.archiveFileIds.length;
  const savedDeleted = savedFiles.deletedFileIds.length;
  const savedArchived = savedFiles.archivedFileIds.length;
  const hasSavedChanges = savedDeleted > 0 || savedArchived > 0;
  const errorMessage =
    applyError === null
      ? null
      : `${applyError.operation === "delete" ? "Deleting" : "Archiving"} failed: ${applyError.message}`;
  const actionsDisabled = dialog !== "none" || isApplying;

  useEffect(() => {
    if (!filter.finished) {
      return;
    }
    if (plan.deleteFileIds.length > 0 || plan.archiveFileIds.length > 0) {
      setDialog("commit");
    } else {
      onClose();
    }
  }, [filter.finished, onClose, plan]);

  useEffect(() => {
    if (nextFileId === undefined) {
      return;
    }
    const nextFile = filesById.get(nextFileId);
    if (!nextFile?.mime?.startsWith(IMAGE_MIME_PREFIX)) {
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = client.getFileUrl(nextFileId);
  }, [filesById, nextFileId]);

  const handleBackToFiltering = useCallback(() => {
    if (hasSavedChanges) {
      return;
    }
    setApplyError(null);
    setDialog("none");
    setFilter(returnToFiltering);
  }, [hasSavedChanges]);

  const handleForget = useCallback(() => {
    setDialog("forget");
  }, []);

  const handleCancelForget = useCallback(() => {
    setDialog("commit");
  }, []);

  const handleCommit = useCallback(async () => {
    if (isApplyingRef.current) {
      return;
    }
    isApplyingRef.current = true;
    setIsApplying(true);
    setApplyError(null);

    const planToApply = buildCommitPlan(filter);
    try {
      const result = await applyArchiveDeletePlan(
        planToApply,
        savedFiles,
        {
          deleteFiles: async (fileIds) => {
            await client.deleteFiles({
              file_ids: [...fileIds],
              reason: DELETE_REASON,
            });
          },
          archiveFiles: async (fileIds) => {
            await client.archiveFiles({ file_ids: [...fileIds] });
          },
        },
        { onProgress: setSavedFiles },
      );

      const savedFileIds = [
        ...result.saved.deletedFileIds,
        ...result.saved.archivedFileIds,
      ];
      if (savedFileIds.length > 0) {
        await refreshFileMetadata(savedFileIds);
      }

      if (result.ok) {
        const results: string[] = [];
        const deletedCount = result.saved.deletedFileIds.length;
        const archivedCount = result.saved.archivedFileIds.length;
        if (deletedCount > 0) {
          results.push(
            `deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"}`,
          );
        }
        if (archivedCount > 0) {
          results.push(
            `archived ${archivedCount} file${archivedCount === 1 ? "" : "s"}`,
          );
        }
        addToast(`Archive/Delete filter ${results.join(" and ")}.`, "success");
        onClose();
        return;
      }

      setApplyError({
        operation: result.operation,
        message:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      addToast(
        `Error ${
          result.operation === "delete" ? "deleting" : "archiving"
        } files: ${result.error}`,
        "error",
      );
    } catch (e) {
      addToast(`Error applying Archive/Delete filter: ${e}`, "error");
    } finally {
      isApplyingRef.current = false;
      setIsApplying(false);
    }
  }, [addToast, filter, onClose, refreshFileMetadata, savedFiles]);

  useShortcut(
    useMemo(() => {
      if (isApplying) {
        return {};
      }
      if (dialog === "commit") {
        return {
          Escape: hasSavedChanges ? handleForget : handleBackToFiltering,
        };
      }
      if (dialog === "forget") {
        return {};
      }
      return {
        ArrowRight: () => setFilter(keepFile),
        ArrowLeft: () => setFilter(deleteFile),
        ArrowUp: () => setFilter(skipFile),
        ArrowDown: () => setFilter(goBack),
        Escape: () => setFilter(finishFiltering),
      };
    }, [
      dialog,
      handleBackToFiltering,
      handleForget,
      hasSavedChanges,
      isApplying,
    ]),
  );

  return (
    <FocusTrap
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: false,
        fallbackFocus: () => filterRef.current ?? document.body,
      }}
    >
      <div
        ref={filterRef}
        className="archive-delete-filter-container"
        role="dialog"
        aria-modal="true"
        aria-label="Archive/Delete filter"
        tabIndex={-1}
      >
        <div className="archive-delete-filter-header">
          <div className="archive-delete-filter-progress">
            {filter.index + 1} / {filter.fileIds.length}
          </div>
          <div className="archive-delete-filter-counts">
            <span className="archive-delete-filter-kept">
              Kept: {counts.kept}
            </span>
            <span className="archive-delete-filter-deleted">
              Deleted: {counts.deleted}
            </span>
            <span className="archive-delete-filter-skipped">
              Skipped: {counts.skipped}
            </span>
          </div>
        </div>

        <div className="archive-delete-filter-viewer">
          {currentFileId !== undefined && currentFile ? (
            <FileViewer
              key={currentFileId}
              fileId={currentFileId}
              fileData={currentFile}
            />
          ) : (
            <div className="archive-delete-filter-empty">
              No file to display.
            </div>
          )}
        </div>

        <div className="archive-delete-filter-actions">
          <PushButton
            variant="danger"
            onClick={() => setFilter(deleteFile)}
            disabled={actionsDisabled}
            className="archive-delete-filter-action"
          >
            Delete
            <span
              className="archive-delete-filter-shortcut"
              title="Left Arrow: delete"
            >
              ←
            </span>
          </PushButton>
          <PushButton
            variant="primary"
            onClick={() => setFilter(keepFile)}
            disabled={actionsDisabled}
            className="archive-delete-filter-action"
          >
            Keep
            <span
              className="archive-delete-filter-shortcut"
              title="Right Arrow: keep and archive"
            >
              →
            </span>
          </PushButton>
          <PushButton
            variant="secondary"
            onClick={() => setFilter(skipFile)}
            disabled={actionsDisabled}
            className="archive-delete-filter-action"
          >
            Skip
            <span
              className="archive-delete-filter-shortcut"
              title="Up Arrow: skip"
            >
              ↑
            </span>
          </PushButton>
          <PushButton
            variant="secondary"
            onClick={() => setFilter(goBack)}
            disabled={actionsDisabled || filter.index === 0}
            className="archive-delete-filter-action"
          >
            Back
            <span
              className="archive-delete-filter-shortcut"
              title="Down Arrow: undo the previous decision and go back"
            >
              ↓
            </span>
          </PushButton>
          <PushButton
            variant="secondary"
            onClick={() => setFilter(finishFiltering)}
            disabled={actionsDisabled}
            className="archive-delete-filter-action"
          >
            Finish
            <span className="archive-delete-filter-shortcut">Escape</span>
          </PushButton>
        </div>

        {dialog === "commit" && summary !== null && (
          <ArchiveDeleteCommitDialog
            summary={summary}
            totalDeleted={totalDeleted}
            totalArchived={totalArchived}
            savedDeleted={savedDeleted}
            savedArchived={savedArchived}
            isApplying={isApplying}
            errorMessage={errorMessage}
            canGoBack={!hasSavedChanges}
            onCommit={handleCommit}
            onForget={handleForget}
            onBackToFiltering={handleBackToFiltering}
          />
        )}

        {dialog === "forget" && (
          <ConfirmModal
            title={hasSavedChanges ? "Leave filtering" : "Forget filtering"}
            message={
              hasSavedChanges
                ? "Some changes have already been saved and cannot be undone. Only unsaved decisions will be discarded. Quit filtering now?"
                : "Quit filtering now and forget your work?"
            }
            confirmLabel="Yes"
            cancelLabel="No"
            onConfirm={onClose}
            onCancel={handleCancelForget}
          />
        )}
      </div>
    </FocusTrap>
  );
};

export default ArchiveDeleteFilterModal;
