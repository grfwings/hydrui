import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React, { useCallback, useRef, useState } from "react";

import PushButton from "@/components/widgets/PushButton/PushButton";
import { useShortcut } from "@/hooks/useShortcut";
import { useModelMetaStore } from "@/store/modelMetaStore";
import { useToastActions } from "@/store/toastStore";

import "./index.css";

interface AddTagModelModalProps {
  onClose: () => void;
}

const AddTagModelModal: React.FC<AddTagModelModalProps> = ({ onClose }) => {
  useShortcut({
    Escape: onClose,
  });
  const {
    actions: { installTagModelFromUrl },
  } = useModelMetaStore();
  const { addToast, removeToast } = useToastActions();
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const install = useCallback(async () => {
    if (!inputRef.current) {
      return;
    }
    const url = inputRef.current.value;
    const toast = addToast("Installing tag model...", "info", {
      duration: false,
    });
    setIsLoading(true);
    try {
      await installTagModelFromUrl(url);
      addToast("Tag model successfully installed.", "success");
    } catch (e) {
      addToast(`Error installing tag model: ${e}`, "error");
    } finally {
      setIsLoading(false);
      removeToast(toast);
    }
    onClose();
  }, [addToast, installTagModelFromUrl, removeToast, onClose]);
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!inputRef.current) return;

      if (e.key === "Enter") {
        e.preventDefault();
        install();
      }
    },
    [install],
  );
  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div className="add-tag-model-modal-container">
        <div className="add-tag-model-modal-wrapper modal-shell modal-sheet">
          <div className="add-tag-model-modal-backdrop" onClick={onClose} />

          <div className="add-tag-model-modal-content modal-panel">
            {/* Header */}
            <div className="add-tag-model-modal-header modal-panel-head">
              <h3 className="add-tag-model-modal-title">
                Install Model from URL
              </h3>
              <button
                onClick={onClose}
                className="modal-close modal-close-compact"
                aria-label="Close"
              >
                <XMarkIcon />
              </button>
            </div>

            {/* Content */}
            <div className="add-tag-model-modal-body modal-panel-scroll">
              <div className="add-tag-model-modal-url-input-container">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Enter URL to model info.json, metadata.json, or config.json file..."
                  className="add-tag-model-modal-url-input"
                  disabled={isLoading}
                  onKeyDown={handleInputKeyDown}
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="go"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="add-tag-model-modal-footer modal-panel-foot">
              <PushButton
                onClick={onClose}
                variant="secondary"
                disabled={isLoading}
              >
                Cancel
              </PushButton>
              <PushButton
                onClick={install}
                variant="primary"
                disabled={isLoading}
              >
                Add
              </PushButton>
            </div>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default AddTagModelModal;
