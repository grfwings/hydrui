import { useCallback, useEffect, useRef } from "react";
import type { PointerEventHandler } from "react";

import {
  SwipeDecision,
  isHorizontalSwipe,
  isSwipePointerType,
  resolveSwipeRelease,
  swipeProgress,
} from "./swipeGesture";

/** Matches the fly-off transition below. */
const COMMIT_ANIMATION_MS = 200;

/**
 * Height of the native media control band at the bottom of a <video>. Swipes
 * that start there belong to the player (scrubbing), not to the filter.
 */
const MEDIA_CONTROL_BAND_PX = 64;

interface Gesture {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startedAt: number;
  mediaWidth: number;
  horizontal: boolean;
}

interface UseSwipeToDecideOptions {
  /** False while the viewer is zoomed, a dialog is open, or a commit is running. */
  enabled: boolean;
  reduceMotion: boolean;
  onDecide: (decision: SwipeDecision) => void;
}

export interface SwipeToDecideHandlers {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
}

function isInteractiveTarget(
  target: EventTarget | null,
  clientY: number,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true'], [data-swipe-ignore]",
    )
  ) {
    return true;
  }
  const media = target.closest("video, audio");
  if (media) {
    const rect = media.getBoundingClientRect();
    return clientY >= rect.bottom - MEDIA_CONTROL_BAND_PX;
  }
  return false;
}

/**
 * Attaches swipe-to-decide to a media surface. The surface stays put; the card
 * inside it follows the finger and flies off on commit. All motion is done with
 * `transform`/`opacity` so it stays on the compositor.
 */
export function useSwipeToDecide({
  enabled,
  reduceMotion,
  onDecide,
}: UseSwipeToDecideOptions) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const deleteLabelRef = useRef<HTMLDivElement>(null);
  const keepLabelRef = useRef<HTMLDivElement>(null);

  const gestureRef = useRef<Gesture | null>(null);
  const activePointersRef = useRef<Set<number>>(new Set());
  const committingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);

  const optionsRef = useRef({ enabled, reduceMotion, onDecide });
  optionsRef.current = { enabled, reduceMotion, onDecide };

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const setLabelProgress = useCallback((progress: number) => {
    if (deleteLabelRef.current) {
      deleteLabelRef.current.style.opacity = String(Math.max(0, -progress));
    }
    if (keepLabelRef.current) {
      keepLabelRef.current.style.opacity = String(Math.max(0, progress));
    }
  }, []);

  const resetVisuals = useCallback(
    (animate: boolean) => {
      const card = cardRef.current;
      if (card) {
        card.style.transition = animate ? "" : "none";
        card.style.transform = "";
        card.style.willChange = "";
      }
      setLabelProgress(0);
    },
    [setLabelProgress],
  );

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    resetVisuals(true);
  }, [resetVisuals]);

  const commit = useCallback(
    (decision: SwipeDecision) => {
      committingRef.current = true;
      const sign = decision === "delete" ? -1 : 1;
      const distance = Math.max(
        cardRef.current?.clientWidth ?? 0,
        surfaceRef.current?.clientWidth ?? 0,
        320,
      );
      const card = cardRef.current;
      if (card) {
        card.style.transition = optionsRef.current.reduceMotion
          ? "none"
          : `transform ${COMMIT_ANIMATION_MS}ms ease-in`;
        card.style.transform = `translate3d(${sign * (distance + 80)}px, 0, 0) rotate(${sign * 14}deg)`;
      }
      setLabelProgress(sign);

      const finish = () => {
        commitTimerRef.current = null;
        committingRef.current = false;
        resetVisuals(false);
        optionsRef.current.onDecide(decision);
      };

      if (optionsRef.current.reduceMotion) {
        finish();
        return;
      }
      clearCommitTimer();
      commitTimerRef.current = window.setTimeout(finish, COMMIT_ANIMATION_MS);
    },
    [clearCommitTimer, resetVisuals, setLabelProgress],
  );

  const handlePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (!optionsRef.current.enabled || committingRef.current) {
        return;
      }
      if (!isSwipePointerType(event.pointerType)) {
        return;
      }

      activePointersRef.current.add(event.pointerId);
      if (activePointersRef.current.size > 1) {
        // A second finger means pinch/zoom: hand the gesture back to the viewer.
        cancelGesture();
        return;
      }
      if (isInteractiveTarget(event.target, event.clientY)) {
        activePointersRef.current.delete(event.pointerId);
        return;
      }

      gestureRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        mediaWidth:
          cardRef.current?.clientWidth ?? surfaceRef.current?.clientWidth ?? 0,
        horizontal: false,
      };

      // Keep receiving moves if the finger leaves the surface.
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (cardRef.current) {
        cardRef.current.style.willChange = "transform";
      }
    },
    [cancelGesture],
  );

  const handlePointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      if (!optionsRef.current.enabled) {
        cancelGesture();
        return;
      }
      if (activePointersRef.current.size > 1) {
        cancelGesture();
        return;
      }

      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;

      if (!gesture.horizontal) {
        if (!isHorizontalSwipe(dx, dy)) {
          // Below the dead zone or vertical-dominant: leave the media alone.
          return;
        }
        gesture.horizontal = true;
      }

      const progress = swipeProgress(dx, gesture.mediaWidth);
      const card = cardRef.current;
      if (card) {
        card.style.transition = "none";
        card.style.transform = `translate3d(${dx}px, 0, 0) rotate(${progress * 6}deg)`;
      }
      setLabelProgress(progress);
    },
    [cancelGesture, setLabelProgress],
  );

  const handlePointerUp = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      activePointersRef.current.delete(event.pointerId);
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }
      gestureRef.current = null;

      if (!gesture.horizontal) {
        resetVisuals(true);
        return;
      }

      const decision = optionsRef.current.enabled
        ? resolveSwipeRelease({
            pointerType: gesture.pointerType,
            // A second pointer cancels the gesture, so exactly one finger
            // produced this release.
            pointerCount: 1,
            dx: event.clientX - gesture.startX,
            dy: event.clientY - gesture.startY,
            elapsedMs: Date.now() - gesture.startedAt,
            mediaWidth: gesture.mediaWidth,
          })
        : null;

      if (decision === null) {
        resetVisuals(true);
        return;
      }
      commit(decision);
    },
    [commit, resetVisuals],
  );

  const handlePointerCancel = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      activePointersRef.current.delete(event.pointerId);
      if (gestureRef.current?.pointerId === event.pointerId) {
        gestureRef.current = null;
        resetVisuals(true);
      }
    },
    [resetVisuals],
  );

  // Drop any in-flight gesture when the surface becomes disabled (zoom, dialog).
  useEffect(() => {
    if (!enabled && gestureRef.current) {
      gestureRef.current = null;
      resetVisuals(true);
    }
  }, [enabled, resetVisuals]);

  useEffect(
    () => () => {
      clearCommitTimer();
      activePointersRef.current.clear();
      gestureRef.current = null;
    },
    [clearCommitTimer],
  );

  const handlers: SwipeToDecideHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  };

  return {
    surfaceRef,
    cardRef,
    deleteLabelRef,
    keepLabelRef,
    handlers,
  };
}
