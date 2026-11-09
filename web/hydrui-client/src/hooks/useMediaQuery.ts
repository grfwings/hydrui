import { useSyncExternalStore } from "react";

// Narrow viewports get the single-column phone layout. Keep in sync with the
// `max-width: 640px` media queries in CSS.
export const COMPACT_LAYOUT_QUERY = "(max-width: 640px)";

// Primary input is a finger. Use for sizing and hiding keyboard hints, not for
// choosing behaviour per event: check `PointerEvent.pointerType` for that.
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) {
    return null;
  }
  return window.matchMedia(query);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = getMediaQueryList(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => getMediaQueryList(query)?.matches ?? false,
    () => false,
  );
}

export function useIsCompactLayout(): boolean {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}

export function useIsCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
