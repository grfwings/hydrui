import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React, { useCallback, useRef, useState } from "react";

import PushButton from "@/components/widgets/PushButton/PushButton";
import { useShortcut } from "@/hooks/useShortcut";
import { useModelMetaStore } from "@/store/modelMetaStore";
import { useToastActions } from "@/store/toastStore";
import { ROOST_DEFAULT_URL } from "@/utils/autotag/roost";

import "./index.css";

export type AddTagModelMode = "url" | "roost";

interface AddTagModelModalProps {
  mode?: AddTagModelMode;
  onClose: () => void;
}

const AddTagModelModal: React.FC<AddTagModelModalProps> = ({
  mode = "url",
  onClose,
}) => {
  useShortcut({
    Escape: onClose,
  });
  const {
    actions: { installTagModelFromUrl, installRoostTagModel },
  } = useModelMetaStore();
  const { addToast, removeToast } = useToastActions();
  const [isLoading, setIsLoading] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);

  const install = useCallback(async () => {
    if (!urlInputRef.current) {
      return;
    }
    const url = urlInputRef.current.value;
    const toast = addToast(
      mode === "roost"
        ? "Connecting to Roost server..."
        : "Installing tag model...",
      "info",
      { duration: false },
    );
    setIsLoading(true);
    try {
      if (mode === "roost") {
        const name = nameInputRef.current?.value;
        const apiKey = apiKeyInputRef.current?.value;
        const meta = await installRoostTagModel({
          url,
          ...(name ? { name } : {}),
          ...(apiKey ? { apiKey } : {}),
        });
        addToast(`Roost model "${meta.name}" added.`, "success");
      } else {
        await installTagModelFromUrl(url);
        addToast("Tag model successfully installed.", "success");
      }
      onClose();
    } catch (e) {
      addToast(`Error installing tag model: ${e}`, "error");
    } finally {
      setIsLoading(false);
      removeToast(toast);
    }
  }, [
    addToast,
    installRoostTagModel,
    installTagModelFromUrl,
    mode,
    onClose,
    removeToast,
  ]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
                {mode === "roost"
                  ? "Add Roost Tag Model API"
                  : "Install Model from URL"}
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
              {mode === "roost" ? (
                <div className="add-tag-model-modal-fields">
                  <label className="add-tag-model-modal-field">
                    <span>Roost Server URL</span>
                    <input
                      ref={urlInputRef}
                      type="text"
                      defaultValue={ROOST_DEFAULT_URL}
                      placeholder={ROOST_DEFAULT_URL}
                      className="add-tag-model-modal-url-input"
                      disabled={isLoading}
                      onKeyDown={handleInputKeyDown}
                      inputMode="url"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="go"
                    />
                  </label>
                  <label className="add-tag-model-modal-field">
                    <span>Name (optional)</span>
                    <input
                      ref={nameInputRef}
                      type="text"
                      placeholder="Defaults to server model ID"
                      className="add-tag-model-modal-url-input"
                      disabled={isLoading}
                      onKeyDown={handleInputKeyDown}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label className="add-tag-model-modal-field">
                    <span>API Token (optional)</span>
                    <input
                      ref={apiKeyInputRef}
                      type="password"
                      placeholder="Bearer token"
                      className="add-tag-model-modal-url-input"
                      disabled={isLoading}
                      onKeyDown={handleInputKeyDown}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
              ) : (
                <div className="add-tag-model-modal-url-input-container">
                  <input
                    ref={urlInputRef}
                    type="text"
                    placeholder="Enter URL to info.json or metadata.json file..."
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
              )}
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
