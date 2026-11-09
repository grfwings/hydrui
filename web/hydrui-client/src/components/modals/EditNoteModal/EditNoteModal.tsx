import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React, { useCallback, useRef, useState } from "react";

import ConfirmModal from "@/components/modals/ConfirmModal/ConfirmModal";
import PushButton from "@/components/widgets/PushButton/PushButton";
import { useIsCoarsePointer } from "@/hooks/useMediaQuery";
import { useShortcut } from "@/hooks/useShortcut";

import "./index.css";

interface EditNoteProps {
  name: string;
  text: string;
  isNew: boolean;
  onSave: (name: string, text: string) => void;
  onCancel: () => void;
}

const EditNoteModal: React.FC<EditNoteProps> = ({
  name,
  text,
  isNew,
  onSave,
  onCancel,
}) => {
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCoarsePointer = useIsCoarsePointer();

  const saveNote = useCallback(() => {
    if (!textareaRef.current) {
      return;
    }
    onSave(name, textareaRef.current.value);
  }, [name, onSave]);
  const handleClose = useCallback(() => {
    if (!textareaRef.current) {
      return;
    }
    if (isNew || textareaRef.current.value !== text) {
      setShowDiscardModal(true);
    } else {
      onCancel();
    }
  }, [isNew, onCancel, text]);
  useShortcut({
    Escape: handleClose,
  });
  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div className="edit-note-modal-container">
        <div className="edit-note-modal-wrapper modal-shell modal-sheet">
          <div className="edit-note-modal-backdrop" onClick={handleClose} />
          <div className="edit-note-modal-content modal-panel">
            {/* Header */}
            <div className="edit-note-modal-header modal-panel-head">
              <h3 className="edit-note-modal-title">Edit Note ({name})</h3>
              <button
                onClick={handleClose}
                className="modal-close modal-close-compact"
                aria-label="Close"
              >
                <XMarkIcon />
              </button>
            </div>
            {/* Content */}
            <div className="edit-note-modal-body modal-panel-scroll">
              <textarea
                defaultValue={text}
                ref={textareaRef}
                autoFocus={!isCoarsePointer}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {/* Footer */}
            <div className="edit-note-modal-footer modal-panel-foot">
              <PushButton onClick={handleClose} variant="secondary">
                Cancel
              </PushButton>
              <PushButton onClick={saveNote} variant="primary">
                Save
              </PushButton>
            </div>
          </div>
        </div>
        {/* Discard changes modal */}
        {showDiscardModal && (
          <ConfirmModal
            title="Discard Changes"
            message="You have unsaved changes. Are you sure you want to discard them?"
            confirmLabel="Discard"
            cancelLabel="Keep Editing"
            onConfirm={onCancel}
            onCancel={() => setShowDiscardModal(false)}
          />
        )}
      </div>
    </FocusTrap>
  );
};

export default EditNoteModal;
