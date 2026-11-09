import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React, { useCallback, useState } from "react";

import ColorEditor from "@/components/widgets/ColorEditor/ColorEditor";
import PushButton from "@/components/widgets/PushButton/PushButton";
import { useShortcut } from "@/hooks/useShortcut";
import {
  DEFAULT_NAMESPACED_COLOR,
  usePreferencesStore,
} from "@/store/preferencesStore";

import "./index.css";

interface EditColorProps {
  namespace: string | boolean;
  onClose: () => void;
}

const EditColorModal: React.FC<EditColorProps> = ({ namespace, onClose }) => {
  const {
    tagColors: {
      defaultNamespacedColor,
      defaultUnnamespacedColor,
      namespaceColors,
    },
    actions: {
      setDefaultNamespacedColor,
      setDefaultUnnamespacedColor,
      setNamespaceColor,
    },
  } = usePreferencesStore();
  const colorName =
    namespace === true
      ? "default with namespace"
      : namespace === false
        ? "default without namespace"
        : namespace;
  const [color, setColor] = useState(
    namespace === true
      ? defaultNamespacedColor
      : namespace === false
        ? defaultUnnamespacedColor
        : (namespaceColors[namespace] ?? DEFAULT_NAMESPACED_COLOR),
  );
  const saveColor = useCallback(() => {
    if (namespace === true) {
      setDefaultNamespacedColor(color);
    } else if (namespace === false) {
      setDefaultUnnamespacedColor(color);
    } else {
      setNamespaceColor(namespace, color);
    }
    onClose();
  }, [
    namespace,
    onClose,
    setDefaultNamespacedColor,
    color,
    setDefaultUnnamespacedColor,
    setNamespaceColor,
  ]);
  useShortcut({
    Escape: onClose,
  });
  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div className="edit-color-modal-container">
        <div className="edit-color-modal-wrapper modal-shell modal-sheet">
          <div className="edit-color-modal-backdrop" onClick={onClose} />
          <div className="edit-color-modal-content modal-panel">
            {/* Header */}
            <div className="edit-color-modal-header modal-panel-head">
              <h3 className="edit-color-modal-title">
                Edit Color ({colorName})
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
            <div className="edit-color-modal-body modal-panel-scroll">
              <ColorEditor color={color} setColor={setColor}></ColorEditor>
            </div>
            {/* Footer */}
            <div className="edit-color-modal-footer modal-panel-foot">
              <PushButton onClick={onClose} variant="secondary">
                Cancel
              </PushButton>
              <PushButton onClick={saveColor} variant="primary">
                Save
              </PushButton>
            </div>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default EditColorModal;
