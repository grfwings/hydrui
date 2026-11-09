import { useCallback, useEffect, useRef } from "react";

export interface LongPressOptions {
  /** How long the pointer must stay down, in milliseconds. */
  delay?: number;
  /** Cancel the press once the pointer has moved further than this. */
  moveThreshold?: number;
  /** Pointer types that may trigger a long press. Mouse is never included. */
  pointerTypes?: readonly string[];
}

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
}

interface LongPressResult extends LongPressHandlers {
  /**
   * Returns true exactly once if a long press fired since the last
   * pointerdown. Use it in the click handler to swallow the synthetic click
   * that browsers emit after a long press.
   */
  consumeClickSuppression: () => boolean;
}

const DEFAULT_POINTER_TYPES = ["touch", "pen"] as const;

export default function useLongPress(
  callback: (event: React.PointerEvent) => void,
  options: LongPressOptions = {},
): LongPressResult {
  const {
    delay = 500,
    moveThreshold = 10,
    pointerTypes = DEFAULT_POINTER_TYPES,
  } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const pointerTypesRef = useRef(pointerTypes);
  pointerTypesRef.current = pointerTypes;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRef = useRef<React.PointerEvent | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    eventRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!pointerTypesRef.current.includes(event.pointerType)) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      // A fresh press always starts with a clean suppression state.
      firedRef.current = false;
      clearTimer();

      eventRef.current = event;
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pressedEvent = eventRef.current;
        eventRef.current = null;
        startRef.current = null;
        if (!pressedEvent) {
          return;
        }
        firedRef.current = true;
        callbackRef.current(pressedEvent);
      }, delay);
    },
    [clearTimer, delay],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) {
        return;
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > moveThreshold) {
        clearTimer();
      }
    },
    [clearTimer, moveThreshold],
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const consumeClickSuppression = useCallback(() => {
    if (!firedRef.current) {
      return false;
    }
    firedRef.current = false;
    return true;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    consumeClickSuppression,
  };
}
