import { describe, expect, it } from "vitest";

import {
  TOUCH_DRAG_EDGE_MAX_SPEED,
  getEdgeScrollSpeed,
  getRectangleSelection,
} from "./useTouchDragSelect";

describe("getRectangleSelection", () => {
  it("selects a single cell when the drag has not left the anchor", () => {
    expect(getRectangleSelection(4, 4, 3, 12)).toEqual([4]);
  });

  it("selects the full horizontal range when both cells share a row", () => {
    expect(getRectangleSelection(1, 3, 4, 12)).toEqual([1, 2, 3]);
  });

  it("selects the full vertical range when both cells share a column", () => {
    expect(getRectangleSelection(1, 9, 4, 12)).toEqual([1, 5, 9]);
  });

  it("fills a 3x3 block", () => {
    expect(getRectangleSelection(0, 10, 4, 12)).toEqual([
      0, 1, 2, 4, 5, 6, 8, 9, 10,
    ]);
  });

  it("returns the same rectangle when the drag is reversed", () => {
    expect(getRectangleSelection(10, 0, 4, 12)).toEqual(
      getRectangleSelection(0, 10, 4, 12),
    );
  });

  it("clamps the current cell past the last file and clips partial rows", () => {
    expect(getRectangleSelection(0, 99, 4, 10)).toEqual([0, 1, 4, 5, 8, 9]);
  });

  it("handles a single-column grid", () => {
    expect(getRectangleSelection(1, 4, 1, 6)).toEqual([1, 2, 3, 4]);
  });

  it("selects the whole page", () => {
    expect(getRectangleSelection(0, 11, 4, 12)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("keeps every index in page order without duplicates", () => {
    const selection = getRectangleSelection(8, 1, 3, 9);
    expect(selection).toEqual([1, 2, 4, 5, 7, 8]);
    expect(new Set(selection).size).toBe(selection.length);
    expect([...selection].sort((a, b) => a - b)).toEqual(selection);
  });

  it("returns nothing for an empty page", () => {
    expect(getRectangleSelection(0, 0, 3, 0)).toEqual([]);
  });
});

describe("getEdgeScrollSpeed", () => {
  it("does not scroll away from the edges", () => {
    expect(getEdgeScrollSpeed(300, 0, 600)).toBe(0);
  });

  it("treats the threshold boundaries as no scroll", () => {
    expect(getEdgeScrollSpeed(48, 0, 600)).toBe(0);
    expect(getEdgeScrollSpeed(552, 0, 600)).toBe(0);
  });

  it("scrolls up near the top and down near the bottom", () => {
    expect(getEdgeScrollSpeed(10, 0, 600)).toBeLessThan(0);
    expect(getEdgeScrollSpeed(590, 0, 600)).toBeGreaterThan(0);
  });

  it("ramps up to the maximum speed at an edge", () => {
    expect(getEdgeScrollSpeed(-20, 0, 600)).toBe(-TOUCH_DRAG_EDGE_MAX_SPEED);
    expect(getEdgeScrollSpeed(620, 0, 600)).toBe(TOUCH_DRAG_EDGE_MAX_SPEED);
  });
});
