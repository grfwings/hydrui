// Pure gesture math for swipe-to-decide. Kept free of DOM/React so the
// thresholds can be unit tested without synthesising pointer events.

export type SwipeDecision = "delete" | "keep" | "skip";

export type SwipeAxis = "horizontal" | "vertical";

/** Fraction of the media width/height that a drag must cross to commit. */
export const SWIPE_COMMIT_FRACTION = 0.25;

/** A drag must exceed this multiple of cross-axis travel to own the gesture. */
export const SWIPE_AXIS_DOMINANCE = 1.5;

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
    horizontal > SWIPE_AXIS_DOMINANCE * Math.abs(dy)
  );
}

/** True once a drag is clearly vertical enough to own the gesture. */
export function isVerticalSwipe(dx: number, dy: number): boolean {
  const vertical = Math.abs(dy);
  return (
    vertical >= SWIPE_DEAD_ZONE_PX &&
    vertical > SWIPE_AXIS_DOMINANCE * Math.abs(dx)
  );
}

/**
 * Pick the axis a drag belongs to, or null while it is still inside the dead
 * zone or too diagonal to call. Once the caller locks an axis it must stay
 * locked, so one drag can never trigger both a horizontal and vertical action.
 */
export function resolveSwipeAxis(dx: number, dy: number): SwipeAxis | null {
  if (isHorizontalSwipe(dx, dy)) {
    return "horizontal";
  }
  if (isVerticalSwipe(dx, dy)) {
    return "vertical";
  }
  return null;
}

/**
 * Signed fraction of the commit threshold, clamped to [-1, 1].
 * Negative is a delete (left) or skip (up) drag; positive is a keep (right)
 * or an ignored downward drag.
 */
export function swipeProgress(delta: number, mediaSize: number): number {
  if (!(mediaSize > 0)) {
    return 0;
  }
  const commitDistance = mediaSize * SWIPE_COMMIT_FRACTION;
  return Math.max(-1, Math.min(1, delta / commitDistance));
}

export interface SwipeRelease {
  pointerType: string;
  /** Number of pointers that participated in the gesture. */
  pointerCount: number;
  dx: number;
  dy: number;
  elapsedMs: number;
  mediaWidth: number;
  mediaHeight: number;
  /**
   * Axis the drag locked onto while it developed. When omitted the release
   * vector decides. Callers that tracked a live gesture should pass it so a
   * final wiggle cannot switch a horizontal drag into a vertical decision.
   */
  axis?: SwipeAxis | null;
}

function crossesCommitThreshold(
  distance: number,
  mediaSize: number,
  elapsedMs: number,
): boolean {
  const crossedThreshold =
    mediaSize > 0 && distance >= mediaSize * SWIPE_COMMIT_FRACTION;
  const velocity = elapsedMs > 0 ? distance / elapsedMs : 0;
  const flicked =
    distance >= SWIPE_FLICK_MIN_DISTANCE_PX &&
    velocity >= SWIPE_FLICK_MIN_VELOCITY;
  return crossedThreshold || flicked;
}

/**
 * Decide the outcome of releasing a swipe. Returns null when the gesture did
 * not commit, in which case the media should spring back.
 */
export function resolveSwipeRelease(
  release: SwipeRelease,
): SwipeDecision | null {
  const {
    pointerType,
    pointerCount,
    dx,
    dy,
    elapsedMs,
    mediaWidth,
    mediaHeight,
  } = release;
  if (!isSwipePointerType(pointerType) || pointerCount !== 1) {
    return null;
  }

  const axis = release.axis ?? resolveSwipeAxis(dx, dy);
  if (axis === "horizontal") {
    const distance = Math.abs(dx);
    if (!crossesCommitThreshold(distance, mediaWidth, elapsedMs)) {
      return null;
    }
    return dx < 0 ? "delete" : "keep";
  }
  if (axis === "vertical") {
    const distance = Math.abs(dy);
    if (!crossesCommitThreshold(distance, mediaHeight, elapsedMs)) {
      return null;
    }
    // Up skips; down would be an undo, which this gesture deliberately never
    // performs. Back stays a button (and the Down Arrow key).
    return dy < 0 ? "skip" : null;
  }
  return null;
}
