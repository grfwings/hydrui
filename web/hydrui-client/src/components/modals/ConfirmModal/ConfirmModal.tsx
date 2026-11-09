import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React from "react";

import PushButton from "@/components/widgets/PushButton/PushButton";
import { useShortcut } from "@/hooks/useShortcut";

import "./index.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: React.ReactNode;
  cancelLabel: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) => {
  useShortcut({
    Escape: onCancel,
  });

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div className="confirm-modal-container">
        <div className="confirm-modal-wrapper modal-shell modal-sheet">
          <div className="confirm-modal-backdrop" onClick={onCancel} />

          <div className="confirm-modal-content modal-panel">
            {/* Header */}
            <div className="confirm-modal-header modal-panel-head">
              <h3 className="confirm-modal-title">{title}</h3>
              <button
                onClick={onCancel}
                className="modal-close modal-close-compact"
                aria-label="Close"
              >
                <XMarkIcon className="confirm-modal-close-icon" />
              </button>
            </div>

            {/* Content */}
            <div className="confirm-modal-body modal-panel-scroll">
              <p className="confirm-modal-message">{message}</p>
            </div>

            {/* Footer */}
            <div className="confirm-modal-footer modal-panel-foot">
              <PushButton onClick={onCancel} variant="secondary">
                {cancelLabel}
              </PushButton>
              <PushButton onClick={onConfirm} variant="primary">
                {confirmLabel}
              </PushButton>
            </div>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default ConfirmModal;
