import {
  isHorizontalSwipe,
  isSwipePointerType,
  isVerticalSwipe,
  resolveSwipeAxis,
  resolveSwipeRelease,
  swipeProgress,
} from "./swipeGesture";

const MEDIA_WIDTH = 400; // commit threshold: 100px
const MEDIA_HEIGHT = 400; // commit threshold: 100px

function release(
  overrides: Partial<Parameters<typeof resolveSwipeRelease>[0]> = {},
) {
  return resolveSwipeRelease({
    pointerType: "touch",
    pointerCount: 1,
    dx: 0,
    dy: 0,
    elapsedMs: 500,
    mediaWidth: MEDIA_WIDTH,
    mediaHeight: MEDIA_HEIGHT,
    ...overrides,
  });
}

describe("swipe pointer eligibility", () => {
  it("accepts touch and pen but not mouse", () => {
    expect(isSwipePointerType("touch")).toBe(true);
    expect(isSwipePointerType("pen")).toBe(true);
    expect(isSwipePointerType("mouse")).toBe(false);
  });
});

describe("axis dominance", () => {
  it("accepts a mostly horizontal drag", () => {
    expect(isHorizontalSwipe(-120, 10)).toBe(true);
    expect(isHorizontalSwipe(120, -30)).toBe(true);
  });

  it("rejects vertical-dominant and sub-dead-zone horizontal drags", () => {
    expect(isHorizontalSwipe(-120, -120)).toBe(false);
    expect(isHorizontalSwipe(-120, 90)).toBe(false);
    expect(isHorizontalSwipe(-5, 0)).toBe(false);
  });

  it("accepts a mostly vertical drag", () => {
    expect(isVerticalSwipe(10, -120)).toBe(true);
    expect(isVerticalSwipe(-30, 120)).toBe(true);
  });

  it("rejects horizontal-dominant and sub-dead-zone vertical drags", () => {
    expect(isVerticalSwipe(-120, -120)).toBe(false);
    expect(isVerticalSwipe(-90, -120)).toBe(false);
    expect(isVerticalSwipe(0, -5)).toBe(false);
  });

  it("resolves one axis or none, never both", () => {
    expect(resolveSwipeAxis(-120, 10)).toBe("horizontal");
    expect(resolveSwipeAxis(10, -120)).toBe("vertical");
    expect(resolveSwipeAxis(-120, -120)).toBeNull();
    expect(resolveSwipeAxis(4, 4)).toBeNull();
  });
});

describe("swipe progress", () => {
  it("is signed and saturates at the commit distance", () => {
    expect(swipeProgress(0, MEDIA_WIDTH)).toBe(0);
    expect(swipeProgress(50, MEDIA_WIDTH)).toBe(0.5);
    expect(swipeProgress(100, MEDIA_WIDTH)).toBe(1);
    expect(swipeProgress(-50, MEDIA_WIDTH)).toBe(-0.5);
    expect(swipeProgress(-100, MEDIA_WIDTH)).toBe(-1);
    expect(swipeProgress(500, MEDIA_WIDTH)).toBe(1);
    expect(swipeProgress(-500, MEDIA_WIDTH)).toBe(-1);
  });

  it("is zero without a measurable media size", () => {
    expect(swipeProgress(50, 0)).toBe(0);
  });
});

describe("swipe release decisions", () => {
  it("deletes on a left swipe past the threshold", () => {
    expect(release({ dx: -120, dy: 8 })).toBe("delete");
  });

  it("keeps on a right swipe past the threshold", () => {
    expect(release({ dx: 120, dy: -8 })).toBe("keep");
  });

  it("commits exactly at the horizontal threshold", () => {
    expect(release({ dx: -100, dy: 0 })).toBe("delete");
    expect(release({ dx: 100, dy: 0 })).toBe("keep");
  });

  it("skips on an upward swipe past the threshold", () => {
    expect(release({ dx: 8, dy: -120 })).toBe("skip");
  });

  it("does nothing on a downward swipe, even far past the threshold", () => {
    expect(release({ dx: 0, dy: 120 })).toBeNull();
    expect(release({ dx: 0, dy: 400 })).toBeNull();
  });

  it("commits exactly at the vertical threshold", () => {
    expect(release({ dx: 0, dy: -100 })).toBe("skip");
  });

  it("does nothing for a small drag", () => {
    expect(release({ dx: -40, dy: 0, elapsedMs: 800 })).toBeNull();
    expect(release({ dx: 0, dy: -40, elapsedMs: 800 })).toBeNull();
  });

  it("does nothing for a diagonal drag that owns neither axis", () => {
    expect(release({ dx: -120, dy: -120 })).toBeNull();
  });

  it("does nothing for a mouse drag", () => {
    expect(release({ pointerType: "mouse", dx: -200, dy: 0 })).toBeNull();
    expect(release({ pointerType: "mouse", dx: 0, dy: -200 })).toBeNull();
  });

  it("does nothing once a second finger has joined", () => {
    expect(release({ pointerCount: 2, dx: -200, dy: 0 })).toBeNull();
    expect(release({ pointerCount: 2, dx: 0, dy: -200 })).toBeNull();
  });

  it("commits a fast horizontal flick without crossing the threshold", () => {
    expect(release({ dx: -48, dy: 4, elapsedMs: 60 })).toBe("delete");
    expect(release({ dx: 48, dy: 4, elapsedMs: 60 })).toBe("keep");
  });

  it("commits a fast upward flick without crossing the threshold", () => {
    expect(release({ dx: 4, dy: -48, elapsedMs: 60 })).toBe("skip");
  });

  it("rejects a slow short drag even past the flick distance", () => {
    expect(release({ dx: -48, dy: 4, elapsedMs: 600 })).toBeNull();
    expect(release({ dx: 4, dy: -48, elapsedMs: 600 })).toBeNull();
  });

  it("rejects a flick that is not clearly horizontal", () => {
    expect(release({ dx: -48, dy: -44, elapsedMs: 60 })).toBeNull();
  });

  it("rejects a flick that is not clearly vertical", () => {
    expect(release({ dx: -44, dy: -48, elapsedMs: 60 })).toBeNull();
  });

  it("skips a vertical-dominant mixed drag only while dominance holds", () => {
    // 120 > 1.5 * 40: vertical owns the gesture.
    expect(release({ dx: 40, dy: -120, elapsedMs: 500 })).toBe("skip");
    // 120 < 1.5 * 90: too diagonal, so nothing commits.
    expect(release({ dx: 90, dy: -120, elapsedMs: 500 })).toBeNull();
  });

  it("keeps the axis the drag locked onto as it developed", () => {
    // A locked horizontal drag that ends in a mostly vertical wiggle must not
    // turn into a skip, even though the release vector alone is vertical.
    expect(release({ dx: 10, dy: -120, axis: "horizontal" })).toBeNull();
    // And a locked vertical drag with a horizontal finish must not delete.
    expect(release({ dx: -120, dy: 10, axis: "vertical" })).toBeNull();
  });

  it("accepts pen flicks", () => {
    expect(
      release({ pointerType: "pen", dx: -60, dy: 2, elapsedMs: 100 }),
    ).toBe("delete");
  });
});
