// Pure gesture math for swipe-to-decide. Kept free of DOM/React so the
// thresholds can be unit tested without synthesising pointer events.

export type SwipeDecision = "delete" | "keep";

/** Fraction of the media width that a drag must cross to commit. */
export const SWIPE_COMMIT_FRACTION = 0.25;

/** Horizontal travel must exceed this multiple of vertical travel. */
export const SWIPE_HORIZONTAL_DOMINANCE = 1.5;

/** Movement below this is treated as touch jitter, not a swipe. */
export const SWIPE_DEAD_ZONE_PX = 12;

/** A flick must still cover this much distance... */
export const SWIPE_FLICK_MIN_DISTANCE_PX = 32;

/** ...and travel at least this fast in CSS px per millisecond. */
export const SWIPE_FLICK_MIN_VELOCITY = 0.5;

/** Only touch and pen pointers swipe; mouse dragging keeps its old meaning. */
export function isSwipePointerType(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** True once a drag is clearly horizontal enough to own the gesture. */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  const horizontal = Math.abs(dx);
  return (
    horizontal >= SWIPE_DEAD_ZONE_PX &&
    horizontal > SWIPE_HORIZONTAL_DOMINANCE * Math.abs(dy)
  );
}

/**
 * Signed fraction of the commit threshold, clamped to [-1, 1].
 * Negative is a delete (left) drag, positive is a keep (right) drag.
 */
export function swipeProgress(dx: number, mediaWidth: number): number {
  if (!(mediaWidth > 0)) {
    return 0;
  }
  const commitDistance = mediaWidth * SWIPE_COMMIT_FRACTION;
  return Math.max(-1, Math.min(1, dx / commitDistance));
}

export interface SwipeRelease {
  pointerType: string;
  /** Number of pointers that participated in the gesture. */
  pointerCount: number;
  dx: number;
  dy: number;
  elapsedMs: number;
  mediaWidth: number;
}

/**
 * Decide the outcome of releasing a swipe. Returns null when the gesture did
 * not commit, in which case the media should spring back.
 */
export function resolveSwipeRelease(
  release: SwipeRelease,
): SwipeDecision | null {
  const { pointerType, pointerCount, dx, dy, elapsedMs, mediaWidth } = release;
  if (!isSwipePointerType(pointerType) || pointerCount !== 1) {
    return null;
  }
  if (!isHorizontalSwipe(dx, dy)) {
    return null;
  }

  const distance = Math.abs(dx);
  const crossedThreshold =
    mediaWidth > 0 && distance >= mediaWidth * SWIPE_COMMIT_FRACTION;
  const velocity = elapsedMs > 0 ? distance / elapsedMs : 0;
  const flicked =
    distance >= SWIPE_FLICK_MIN_DISTANCE_PX &&
    velocity >= SWIPE_FLICK_MIN_VELOCITY;

  if (!crossedThreshold && !flicked) {
    return null;
  }
  return dx < 0 ? "delete" : "keep";
}
