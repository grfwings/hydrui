import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { useContextMenuStore } from "@/store/contextMenuStore";
import { usePageStore } from "@/store/pageStore";

import type { GridMetrics } from "./gridMetrics";

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
  /**
   * Current grid geometry. It is read on every pointer move so resizing the
   * viewport while the app is open works.
   */
  getGridMetrics?: () => GridMetrics | null;
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
  begin: (event: ReactPointerEvent, anchorFileId: number) => void;
}

interface ActiveGesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** Page index of the thumbnail whose long press armed the gesture. */
  anchorIndex: number;
  /** Selected page indices when the gesture started, ascending. */
  baseIndices: number[];
}

function isTouchOrPen(pointerType: string | undefined): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/**
 * Every page index inside the rectangle spanning the anchor cell and the
 * current cell, in page order. Rows beyond the last file are clipped, so the
 * result never contains an index past `fileCount - 1`.
 */
export function getRectangleSelection(
  anchorIndex: number,
  currentIndex: number,
  columns: number,
  fileCount: number,
): number[] {
  if (fileCount <= 0) {
    return [];
  }

  const safeColumns = Math.max(1, Math.floor(columns) || 1);
  const lastIndex = fileCount - 1;
  const clampIndex = (index: number) =>
    Math.min(lastIndex, Math.max(0, Math.floor(index)));
  const anchor = clampIndex(anchorIndex);
  const current = clampIndex(currentIndex);

  const anchorRow = Math.floor(anchor / safeColumns);
  const anchorColumn = anchor % safeColumns;
  const currentRow = Math.floor(current / safeColumns);
  const currentColumn = current % safeColumns;

  const firstRow = Math.min(anchorRow, currentRow);
  const lastRow = Math.max(anchorRow, currentRow);
  const firstColumn = Math.min(anchorColumn, currentColumn);
  const lastColumn = Math.max(anchorColumn, currentColumn);

  const indices: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const index = row * safeColumns + column;
      if (index <= lastIndex) {
        indices.push(index);
      }
    }
  }
  return indices;
}

/** Merge two ascending index lists, dropping duplicates. */
function mergeSortedIndices(
  first: readonly number[],
  second: readonly number[],
): number[] {
  const merged: number[] = [];
  let i = 0;
  let j = 0;

  while (i < first.length || j < second.length) {
    const firstValue = i < first.length ? first[i] : undefined;
    const secondValue = j < second.length ? second[j] : undefined;

    if (
      secondValue === undefined ||
      (firstValue !== undefined && firstValue < secondValue)
    ) {
      merged.push(firstValue!);
      i += 1;
    } else if (firstValue === undefined || secondValue < firstValue) {
      merged.push(secondValue);
      j += 1;
    } else {
      merged.push(secondValue);
      i += 1;
      j += 1;
    }
  }
  return merged;
}

/**
 * Page index of the grid cell under a client point. Geometry drives the
 * lookup rather than `elementFromPoint`, so gaps, padding, and fast moves
 * cannot skip cells.
 */
function getCellIndexAtPoint(
  clientX: number,
  clientY: number,
  grid: HTMLDivElement,
  metrics: GridMetrics,
  fileCount: number,
): number | null {
  const pitch = metrics.cellSize + metrics.gap;
  if (
    fileCount <= 0 ||
    metrics.columns <= 0 ||
    metrics.rows <= 0 ||
    !(pitch > 0)
  ) {
    return null;
  }

  const rect = grid.getBoundingClientRect();
  const x = clientX - rect.left + grid.scrollLeft - metrics.padding;
  const y = clientY - rect.top + grid.scrollTop - metrics.padding;
  const column = Math.min(
    metrics.columns - 1,
    Math.max(0, Math.floor(x / pitch)),
  );
  const row = Math.min(metrics.rows - 1, Math.max(0, Math.floor(y / pitch)));
  return Math.min(row * metrics.columns + column, fileCount - 1);
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
 * Selects the filled rectangle spanning the long-pressed thumbnail and the
 * grid cell under the pointer. Painting starts once the pointer moves past
 * `moveThreshold`, blocks the gesture's native touch scrolling, and
 * auto-scrolls the grid while the finger rests near an edge. Releasing ends
 * painting but keeps selection mode; taps and mouse drag selection are
 * unaffected.
 */
export default function useTouchDragSelect({
  pageKey,
  gridRef,
  canPaint,
  getGridMetrics,
  moveThreshold = TOUCH_DRAG_START_THRESHOLD,
  edgeThreshold = TOUCH_DRAG_EDGE_THRESHOLD,
  edgeMaxSpeed = TOUCH_DRAG_EDGE_MAX_SPEED,
}: TouchDragSelectOptions): TouchDragSelectApi {
  const [gesture, setGesture] = useState<ActiveGesture | null>(null);

  const canPaintRef = useRef<(() => boolean) | undefined>(canPaint);
  canPaintRef.current = canPaint;

  const getGridMetricsRef = useRef<(() => GridMetrics | null) | undefined>(
    getGridMetrics,
  );
  getGridMetricsRef.current = getGridMetrics;

  const canPaintNow = useCallback(
    () =>
      !useContextMenuStore.getState().isOpen &&
      (canPaintRef.current?.() ?? true),
    [],
  );

  const begin = useCallback(
    (event: ReactPointerEvent, anchorFileId: number) => {
      if (!isTouchOrPen(event.pointerType) || !canPaintNow()) {
        return;
      }

      const state = usePageStore.getState();
      const anchorIndex = state.fileIdToIndex.get(anchorFileId);
      if (anchorIndex === undefined) {
        return;
      }

      const baseIndexSet = new Set<number>();
      for (const fileId of state.selectedFilesByPage[pageKey] ?? []) {
        const index = state.fileIdToIndex.get(fileId);
        if (index !== undefined) {
          baseIndexSet.add(index);
        }
      }
      baseIndexSet.add(anchorIndex);

      setGesture({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        anchorIndex,
        baseIndices: [...baseIndexSet].sort((a, b) => a - b),
      });
    },
    [canPaintNow, pageKey],
  );

  useEffect(() => {
    if (!gesture) {
      return;
    }

    let painting = false;
    let lastX = gesture.startX;
    let lastY = gesture.startY;
    let lastActiveIndex: number | null = null;
    let frameId: number | null = null;
    let blockingTouchMove = false;

    const paintAt = (clientX: number, clientY: number) => {
      if (!canPaintNow()) {
        return;
      }

      const grid = gridRef.current;
      const metrics = getGridMetricsRef.current?.() ?? null;
      if (!grid || !metrics) {
        return;
      }

      const state = usePageStore.getState();
      const fileCount = state.fileIds.length;
      const currentIndex = getCellIndexAtPoint(
        clientX,
        clientY,
        grid,
        metrics,
        fileCount,
      );
      if (currentIndex === null) {
        return;
      }

      const rectangle = getRectangleSelection(
        gesture.anchorIndex,
        currentIndex,
        metrics.columns,
        fileCount,
      );
      const selectedIndices = mergeSortedIndices(
        gesture.baseIndices,
        rectangle,
      );
      const nextSelection = selectedIndices
        .map((index) => state.fileIds[index])
        .filter((fileId): fileId is number => fileId !== undefined);
      state.actions.setSelectedFiles(pageKey, nextSelection, {
        offerRestore: false,
      });

      if (currentIndex !== lastActiveIndex) {
        lastActiveIndex = currentIndex;
        const fileId = state.fileIds[currentIndex];
        if (fileId !== undefined) {
          state.actions.setActiveFileId(pageKey, fileId);
        }
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
      // Rows that scrolled under the stationary finger join the rectangle.
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
