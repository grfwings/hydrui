import { act, renderHook } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import useLongPress from "./useLongPress";

function pointerEvent(
  overrides: Partial<React.PointerEvent> = {},
): React.PointerEvent {
  return {
    pointerType: "touch",
    button: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
  } as unknown as React.PointerEvent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useLongPress", () => {
  it("fires once the delay elapses for a touch pointer", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress(onLongPress, { delay: 500 }),
    );

    act(() => {
      result.current.onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse pointers", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => {
      result.current.onPointerDown(pointerEvent({ pointerType: "mouse" }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("cancels when the pointer moves past the threshold", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress(onLongPress, { delay: 500, moveThreshold: 10 }),
    );

    act(() => {
      result.current.onPointerDown(pointerEvent({ clientX: 10, clientY: 10 }));
    });
    act(() => {
      result.current.onPointerMove(pointerEvent({ clientX: 21, clientY: 21 }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("keeps the press alive for small movements", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress(onLongPress, { delay: 500, moveThreshold: 10 }),
    );

    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerMove(pointerEvent({ clientX: 3, clientY: 4 }));
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it.each([["pointerup"], ["pointercancel"], ["pointerleave"]] as const)(
    "cancels on %s before the delay",
    (eventName) => {
      vi.useFakeTimers();
      const onLongPress = vi.fn();
      const { result } = renderHook(() => useLongPress(onLongPress));

      act(() => {
        result.current.onPointerDown(pointerEvent());
      });

      act(() => {
        if (eventName === "pointerup")
          result.current.onPointerUp(pointerEvent());
        if (eventName === "pointercancel")
          result.current.onPointerCancel(pointerEvent());
        if (eventName === "pointerleave")
          result.current.onPointerLeave(pointerEvent());
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    },
  );

  it("suppresses the click that follows a long press exactly once", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => {
      result.current.onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.consumeClickSuppression()).toBe(true);
    expect(result.current.consumeClickSuppression()).toBe(false);
  });

  it("clears a stale suppression on the next pointerdown", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => {
      result.current.onPointerDown(pointerEvent());
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.onPointerDown(pointerEvent());
    });

    expect(result.current.consumeClickSuppression()).toBe(false);
  });
});
