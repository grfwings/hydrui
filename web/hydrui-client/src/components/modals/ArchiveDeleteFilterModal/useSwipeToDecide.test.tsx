import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SwipeDecision } from "./swipeGesture";
import { useSwipeToDecide } from "./useSwipeToDecide";

const MEDIA_WIDTH = 400;
const THRESHOLD = MEDIA_WIDTH * 0.25;

// jsdom has no PointerEvent, and fireEvent silently drops pointer fields when
// the constructor is missing.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.isPrimary = init.isPrimary ?? true;
  }
}

interface HarnessProps {
  enabled?: boolean;
  reduceMotion?: boolean;
  onDecide: (decision: SwipeDecision) => void;
}

const Harness: React.FC<HarnessProps> = ({
  enabled = true,
  reduceMotion = true,
  onDecide,
}) => {
  const { surfaceRef, cardRef, deleteLabelRef, keepLabelRef, handlers } =
    useSwipeToDecide({ enabled, reduceMotion, onDecide });
  return (
    <div ref={surfaceRef} data-testid="surface" {...handlers}>
      <div ref={cardRef} data-testid="card" />
      <div ref={deleteLabelRef} data-testid="delete-label" />
      <div ref={keepLabelRef} data-testid="keep-label" />
      <button type="button" data-testid="video-control">
        Play
      </button>
    </div>
  );
};

function setup(props: Partial<HarnessProps> = {}) {
  const onDecide = vi.fn();
  render(<Harness onDecide={onDecide} {...props} />);
  const surface = screen.getByTestId("surface");
  const card = screen.getByTestId("card");
  Object.defineProperty(card, "clientWidth", {
    configurable: true,
    value: MEDIA_WIDTH,
  });
  return { onDecide, surface };
}

interface SwipeOptions {
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  elapsedMs?: number;
  pointerId?: number;
  pointerType?: string;
  target?: Element;
}

function swipe(
  surface: HTMLElement,
  {
    fromX = 300,
    fromY = 300,
    toX = 100,
    toY = 300,
    elapsedMs = 600,
    pointerId = 1,
    pointerType = "touch",
    target = surface,
  }: SwipeOptions = {},
) {
  vi.setSystemTime(0);
  fireEvent.pointerDown(target, {
    pointerId,
    pointerType,
    clientX: fromX,
    clientY: fromY,
  });
  fireEvent.pointerMove(surface, {
    pointerId,
    pointerType,
    clientX: toX,
    clientY: toY,
  });
  vi.setSystemTime(elapsedMs);
  fireEvent.pointerUp(surface, {
    pointerId,
    pointerType,
    clientX: toX,
    clientY: toY,
  });
}

describe("useSwipeToDecide", () => {
  beforeAll(() => {
    (
      window as unknown as { PointerEvent: typeof TestPointerEvent }
    ).PointerEvent = TestPointerEvent;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
    delete (window as unknown as { PointerEvent?: typeof TestPointerEvent })
      .PointerEvent;
  });

  it("deletes on a left swipe past the threshold", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { toX: 300 - THRESHOLD - 20 });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("delete");
  });

  it("keeps on a right swipe past the threshold", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { fromX: 100, toX: 100 + THRESHOLD + 20 });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("keep");
  });

  it("springs back without a decision for a small drag", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { toX: 300 - 40 });

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId("card").style.transform).toBe("");
  });

  it("ignores vertical-dominant drags", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { toX: 100, toY: 100 });

    expect(onDecide).not.toHaveBeenCalled();
  });

  it("ignores mouse drags", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { pointerType: "mouse", toX: 20 });

    expect(onDecide).not.toHaveBeenCalled();
  });

  it("ignores gestures that a second finger turns into a pinch", () => {
    const { onDecide, surface } = setup();
    vi.setSystemTime(0);
    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerDown(surface, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 320,
      clientY: 320,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 50,
      clientY: 300,
    });
    vi.setSystemTime(600);
    fireEvent.pointerUp(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 50,
      clientY: 300,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 320,
      clientY: 320,
    });

    expect(onDecide).not.toHaveBeenCalled();
  });

  it("ignores drags that start on an interactive control", () => {
    const { onDecide, surface } = setup();
    swipe(surface, { target: screen.getByTestId("video-control"), toX: 20 });

    expect(onDecide).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { onDecide, surface } = setup({ enabled: false });
    swipe(surface, { toX: 20 });

    expect(onDecide).not.toHaveBeenCalled();
  });

  it("flies the card off before deciding when motion is allowed", () => {
    const { onDecide, surface } = setup({ reduceMotion: false });
    swipe(surface, { toX: 20 });

    expect(screen.getByTestId("card").style.transform).toContain("translate3d");
    expect(onDecide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(onDecide).toHaveBeenCalledWith("delete");
    expect(screen.getByTestId("card").style.transform).toBe("");
  });

  it("fades the direction label in while dragging", () => {
    const { surface } = setup();
    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 250,
      clientY: 300,
    });

    expect(
      Number(screen.getByTestId("delete-label").style.opacity),
    ).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("keep-label").style.opacity)).toBe(0);
  });
});
