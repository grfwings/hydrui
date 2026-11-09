import { XMarkIcon } from "@heroicons/react/24/solid";
import { FocusTrap } from "focus-trap-react";
import React, {
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import "./index.css";

interface BottomSheetProps {
  title: string;
  onClose: () => void;
  /** Element to focus again once the sheet has closed (e.g. its trigger). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

// Distance the handle has to be dragged before releasing dismisses the sheet.
const DISMISS_DRAG_DISTANCE = 96;

/**
 * A phone-style bottom sheet. Mount it to open it and unmount it to close it;
 * the enter animation runs on mount.
 */
const BottomSheet: React.FC<BottomSheetProps> = ({
  title,
  onClose,
  returnFocusRef,
  children,
}) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Drag-to-dismiss state (handle only, deliberately simple).
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Return focus to whatever opened the sheet (normally the Tags button).
  useEffect(() => {
    const trigger = returnFocusRef?.current;
    return () => {
      trigger?.focus();
    };
  }, [returnFocusRef]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    dragStartY.current = event.touches[0]?.clientY ?? null;
    setDragOffset(0);
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const delta =
      (event.touches[0]?.clientY ?? dragStartY.current) - dragStartY.current;
    setDragOffset(Math.max(0, delta));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragOffset !== null && dragOffset > DISMISS_DRAG_DISTANCE) {
      onClose();
    }
    dragStartY.current = null;
    setDragOffset(null);
  }, [dragOffset, onClose]);

  const dragging = dragOffset !== null;

  return (
    <FocusTrap
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: false,
        initialFocus: () => closeButtonRef.current ?? panelRef.current ?? false,
      }}
    >
      <div className="bottom-sheet-root">
        <div
          className="bottom-sheet-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          className={`bottom-sheet-panel ${dragging ? "bottom-sheet-panel-dragging" : ""}`}
          style={
            dragOffset !== null
              ? { transform: `translateY(${dragOffset}px)` }
              : undefined
          }
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div
            className="bottom-sheet-grab"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            aria-hidden="true"
          >
            <div className="bottom-sheet-grab-handle" />
          </div>
          <div className="bottom-sheet-header">
            <h2 id={titleId} className="bottom-sheet-title">
              {title}
            </h2>
            <button
              ref={closeButtonRef}
              className="bottom-sheet-close"
              onClick={onClose}
              aria-label={`Close ${title}`}
              title="Close"
            >
              <XMarkIcon className="bottom-sheet-close-icon" />
            </button>
          </div>
          <div className="bottom-sheet-body">{children}</div>
        </div>
      </div>
    </FocusTrap>
  );
};

export default BottomSheet;
