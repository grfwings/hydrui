import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { useContextMenuStore } from "@/store/contextMenuStore";
import { usePageStore } from "@/store/pageStore";

/**
 * Distance, in CSS pixels, the pointer must travel after a long press before
 * painting starts. A stationary long press keeps the existing tap behaviour.
 */
export const TOUCH_DRAG_START_THRESHOLD = 10;

/** Distance from the grid viewport edge where auto-scroll starts. */
export const TOUCH_DRAG_EDGE_THRESHOLD = 48;

/** Maximum auto-scroll speed, in CSS pixels per animation frame. */
export const TOUCH_DRAG_EDGE_MAX_SPEED = 24;

export interface TouchDragSelectOptions {
  pageKey: string;
  /** Scroll container that holds the thumbnails. */
  gridRef: RefObject<HTMLDivElement | null>;
  /**
   * Optional guard for application modals. Return false to ignore pointer
   * movement, for example while a dialog is open. The context menu is checked
   * by the hook itself.
   */
  canPaint?: () => boolean;
  moveThreshold?: number;
  edgeThreshold?: number;
  edgeMaxSpeed?: number;
}

export interface TouchDragSelectApi {
  /**
   * Arm painting for the pointer that just triggered a long press. Call this
   * from the long-press callback while the pointer is still down. Painting
   * only begins once the pointer travels past the move threshold.
   */
  begin: (event: ReactPointerEvent) => void;
}

interface ActiveGesture {
  pointerId: number;
  startX: number;
  startY: number;
}

function isTouchOrPen(pointerType: string | undefined): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

function getFileIdAtPoint(clientX: number, clientY: number): number | null {
  const element = document.elementFromPoint?.(clientX, clientY);
  const fileItem = element?.closest("[data-file-id]");
  if (!(fileItem instanceof Element)) {
    return null;
  }

  const fileId = Number(fileItem.getAttribute("data-file-id"));
  return Number.isFinite(fileId) ? fileId : null;
}

/**
 * Signed auto-scroll speed, in CSS pixels per animation frame, for a pointer
 * inside a viewport spanning `top`..`bottom`.
 *
 * Negative scrolls up, positive scrolls down, and zero means no auto-scroll.
 * The speed ramps up as the pointer approaches, or leaves through, an edge.
 */
export function getEdgeScrollSpeed(
  pointerY: number,
  top: number,
  bottom: number,
  edgeThreshold = TOUCH_DRAG_EDGE_THRESHOLD,
  edgeMaxSpeed = TOUCH_DRAG_EDGE_MAX_SPEED,
): number {
  if (edgeThreshold <= 0) {
    return 0;
  }

  if (pointerY < top + edgeThreshold) {
    const intensity = Math.min(
      1,
      Math.max(0, (top + edgeThreshold - pointerY) / edgeThreshold),
    );
    return -edgeMaxSpeed * intensity;
  }

  if (pointerY > bottom - edgeThreshold) {
    const intensity = Math.min(
      1,
      Math.max(0, (pointerY - (bottom - edgeThreshold)) / edgeThreshold),
    );
    return edgeMaxSpeed * intensity;
  }

  return 0;
}

/**
 * Adds every thumbnail passed over after a long press to the current
 * selection. Painting starts once the pointer moves past `moveThreshold`,
 * blocks the gesture's native touch scrolling, and auto-scrolls the grid while
 * the finger rests near an edge. Releasing ends painting but keeps selection
 * mode; taps and mouse drag selection are unaffected.
 */
export default function useTouchDragSelect({
  pageKey,
  gridRef,
  canPaint,
  moveThreshold = TOUCH_DRAG_START_THRESHOLD,
  edgeThreshold = TOUCH_DRAG_EDGE_THRESHOLD,
  edgeMaxSpeed = TOUCH_DRAG_EDGE_MAX_SPEED,
}: TouchDragSelectOptions): TouchDragSelectApi {
  const [gesture, setGesture] = useState<ActiveGesture | null>(null);

  const canPaintRef = useRef<(() => boolean) | undefined>(canPaint);
  canPaintRef.current = canPaint;

  const canPaintNow = useCallback(
    () =>
      !useContextMenuStore.getState().isOpen &&
      (canPaintRef.current?.() ?? true),
    [],
  );

  const begin = useCallback(
    (event: ReactPointerEvent) => {
      if (!isTouchOrPen(event.pointerType) || !canPaintNow()) {
        return;
      }

      setGesture({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      });
    },
    [canPaintNow],
  );

  useEffect(() => {
    if (!gesture) {
      return;
    }

    let painting = false;
    let lastX = gesture.startX;
    let lastY = gesture.startY;
    let lastPaintedFileId: number | null = null;
    let frameId: number | null = null;
    let blockingTouchMove = false;

    const paintAt = (clientX: number, clientY: number) => {
      if (!canPaintNow()) {
        return;
      }

      const fileId = getFileIdAtPoint(clientX, clientY);
      if (fileId === null) {
        return;
      }

      const state = usePageStore.getState();
      const currentSelection = state.selectedFilesByPage[pageKey] ?? [];
      if (!currentSelection.includes(fileId)) {
        state.actions.setSelectedFiles(pageKey, [...currentSelection, fileId], {
          offerRestore: false,
        });
      }

      if (fileId !== lastPaintedFileId) {
        lastPaintedFileId = fileId;
        state.actions.setActiveFileId(pageKey, fileId);
      }
    };

    // The browser decides whether a touch gesture may scroll before it
    // dispatches `touchmove`, and a listener registered after that point sees
    // a non-cancelable event. Register the blocker as soon as the long press
    // arms, but only call preventDefault once painting has actually started so
    // a long press that ends without movement keeps native behaviour.
    const preventTouchScroll = (event: TouchEvent) => {
      if (painting && event.cancelable) {
        event.preventDefault();
      }
    };

    const attachTouchMoveBlocker = () => {
      if (blockingTouchMove) {
        return;
      }
      blockingTouchMove = true;
      window.addEventListener("touchmove", preventTouchScroll, {
        passive: false,
      });
    };

    const detachTouchMoveBlocker = () => {
      if (!blockingTouchMove) {
        return;
      }
      blockingTouchMove = false;
      window.removeEventListener("touchmove", preventTouchScroll);
    };

    const autoScrollTick = () => {
      frameId = null;

      const grid = gridRef.current;
      if (!painting || !grid || !canPaintNow()) {
        return;
      }

      const rect = grid.getBoundingClientRect();
      const speed = getEdgeScrollSpeed(
        lastY,
        rect.top,
        rect.bottom,
        edgeThreshold,
        edgeMaxSpeed,
      );
      if (speed === 0) {
        return;
      }

      const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight);
      const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, grid.scrollTop + speed),
      );

      // At an edge there is nowhere left to scroll; wait for the next move.
      if (nextScrollTop === grid.scrollTop) {
        return;
      }

      grid.scrollTop = nextScrollTop;
      // Files that scrolled under the stationary finger join the selection.
      paintAt(lastX, lastY);
      frameId = requestAnimationFrame(autoScrollTick);
    };

    const maybeAutoScroll = () => {
      if (frameId !== null) {
        return;
      }

      const grid = gridRef.current;
      if (!grid) {
        return;
      }

      const rect = grid.getBoundingClientRect();
      if (
        getEdgeScrollSpeed(
          lastY,
          rect.top,
          rect.bottom,
          edgeThreshold,
          edgeMaxSpeed,
        ) === 0
      ) {
        return;
      }

      frameId = requestAnimationFrame(autoScrollTick);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId || !canPaintNow()) {
        return;
      }

      lastX = event.clientX;
      lastY = event.clientY;

      if (!painting) {
        const dx = lastX - gesture.startX;
        const dy = lastY - gesture.startY;
        if (Math.hypot(dx, dy) <= moveThreshold) {
          return;
        }
        painting = true;
      }

      paintAt(lastX, lastY);
      maybeAutoScroll();
    };

    const stop = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("lostpointercapture", handlePointerCancel);
      detachTouchMoveBlocker();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const finish = () => {
      painting = false;
      stop();
      setGesture((current) => (current === gesture ? null : current));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) {
        return;
      }
      finish();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) {
        return;
      }
      finish();
    };

    attachTouchMoveBlocker();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("lostpointercapture", handlePointerCancel);

    return stop;
  }, [
    canPaintNow,
    edgeMaxSpeed,
    edgeThreshold,
    gesture,
    gridRef,
    moveThreshold,
    pageKey,
  ]);

  return { begin };
}
