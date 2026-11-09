import {
  isHorizontalSwipe,
  isSwipePointerType,
  resolveSwipeRelease,
  swipeProgress,
} from "./swipeGesture";

const MEDIA_WIDTH = 400; // commit threshold: 100px

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

describe("horizontal dominance", () => {
  it("accepts a mostly horizontal drag", () => {
    expect(isHorizontalSwipe(-120, 10)).toBe(true);
    expect(isHorizontalSwipe(120, -30)).toBe(true);
  });

  it("rejects vertical-dominant and sub-dead-zone drags", () => {
    expect(isHorizontalSwipe(-120, -120)).toBe(false);
    expect(isHorizontalSwipe(-120, 90)).toBe(false);
    expect(isHorizontalSwipe(-5, 0)).toBe(false);
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

  it("is zero without a measurable media width", () => {
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

  it("commits exactly at the threshold", () => {
    expect(release({ dx: -100, dy: 0 })).toBe("delete");
    expect(release({ dx: 100, dy: 0 })).toBe("keep");
  });

  it("does nothing for a small drag", () => {
    expect(release({ dx: -40, dy: 0, elapsedMs: 800 })).toBeNull();
  });

  it("does nothing for a vertical-dominant drag", () => {
    expect(release({ dx: -120, dy: -120 })).toBeNull();
  });

  it("does nothing for a mouse drag", () => {
    expect(release({ pointerType: "mouse", dx: -200, dy: 0 })).toBeNull();
  });

  it("does nothing once a second finger has joined", () => {
    expect(release({ pointerCount: 2, dx: -200, dy: 0 })).toBeNull();
  });

  it("commits a fast horizontal flick without crossing the threshold", () => {
    expect(release({ dx: -48, dy: 4, elapsedMs: 60 })).toBe("delete");
    expect(release({ dx: 48, dy: 4, elapsedMs: 60 })).toBe("keep");
  });

  it("rejects a slow short drag even past the flick distance", () => {
    expect(release({ dx: -48, dy: 4, elapsedMs: 600 })).toBeNull();
  });

  it("rejects a flick that is not clearly horizontal", () => {
    expect(release({ dx: -48, dy: -44, elapsedMs: 60 })).toBeNull();
  });

  it("accepts pen flicks", () => {
    expect(
      release({ pointerType: "pen", dx: -60, dy: 2, elapsedMs: 100 }),
    ).toBe("delete");
  });
});
