import { FocusTrap } from "focus-trap-react";
import React, { useRef } from "react";

import PushButton from "@/components/widgets/PushButton/PushButton";

import "./index.css";

interface ArchiveDeleteCommitDialogProps {
  summary: string;
  totalDeleted: number;
  totalArchived: number;
  savedDeleted: number;
  savedArchived: number;
  isApplying: boolean;
  errorMessage: string | null;
  canGoBack: boolean;
  onCommit: () => void;
  onForget: () => void;
  onBackToFiltering: () => void;
}

const ArchiveDeleteCommitDialog: React.FC<ArchiveDeleteCommitDialogProps> = ({
  summary,
  totalDeleted,
  totalArchived,
  savedDeleted,
  savedArchived,
  isApplying,
  errorMessage,
  canGoBack,
  onCommit,
  onForget,
  onBackToFiltering,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasSavedChanges = savedDeleted > 0 || savedArchived > 0;
  const showProgress = isApplying || hasSavedChanges || errorMessage !== null;
  const remainingDeleted = totalDeleted - savedDeleted;
  const remainingArchived = totalArchived - savedArchived;

  return (
    <FocusTrap
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: false,
        initialFocus: "#archive-delete-commit-dialog-commit",
        fallbackFocus: () => dialogRef.current ?? document.body,
      }}
    >
      <div className="archive-delete-commit-dialog-container">
        <div className="archive-delete-commit-dialog-backdrop" />

        <div
          ref={dialogRef}
          className="archive-delete-commit-dialog-content"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-delete-commit-dialog-title"
          tabIndex={-1}
        >
          <div className="archive-delete-commit-dialog-header">
            <h3
              id="archive-delete-commit-dialog-title"
              className="archive-delete-commit-dialog-title"
            >
              Commit Archive/Delete Filter
            </h3>
          </div>

          <div className="archive-delete-commit-dialog-body">
            <p className="archive-delete-commit-dialog-message">{summary}</p>

            {showProgress && (
              <div className="archive-delete-commit-dialog-progress">
                <p>
                  Saved: {savedDeleted} deleted, {savedArchived} archived
                </p>
                <p>
                  Remaining: {remainingDeleted} to delete, {remainingArchived}{" "}
                  to archive
                </p>
              </div>
            )}

            {errorMessage !== null && (
              <p className="archive-delete-commit-dialog-error" role="alert">
                {errorMessage}. Retry will only save the remaining files.
              </p>
            )}
          </div>

          <div className="archive-delete-commit-dialog-footer">
            <PushButton
              onClick={onForget}
              variant="danger"
              disabled={isApplying}
            >
              {hasSavedChanges ? "Leave..." : "Forget"}
            </PushButton>
            {canGoBack && (
              <PushButton
                onClick={onBackToFiltering}
                variant="secondary"
                disabled={isApplying}
              >
                Back to filtering
              </PushButton>
            )}
            <PushButton
              id="archive-delete-commit-dialog-commit"
              onClick={onCommit}
              variant="primary"
              disabled={isApplying}
            >
              {isApplying
                ? "Committing..."
                : errorMessage !== null
                  ? "Retry remaining"
                  : "Commit"}
            </PushButton>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default ArchiveDeleteCommitDialog;
