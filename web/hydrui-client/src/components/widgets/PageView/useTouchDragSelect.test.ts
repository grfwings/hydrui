import { describe, expect, it } from "vitest";

import {
  TOUCH_DRAG_EDGE_MAX_SPEED,
  getEdgeScrollSpeed,
  getRangeSelection,
} from "./useTouchDragSelect";

describe("getRangeSelection", () => {
  it("selects a single cell when the drag has not left the anchor", () => {
    expect(getRangeSelection(4, 4, 12)).toEqual([4]);
  });

  it("selects every cell between two cells in the same row", () => {
    expect(getRangeSelection(1, 3, 12)).toEqual([1, 2, 3]);
  });

  it("fills the intermediate rows between two cells in the same column", () => {
    expect(getRangeSelection(1, 9, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("selects the whole 4x3 grid from corner to corner", () => {
    expect(getRangeSelection(0, 11, 12)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("removes only the last cell when a drag from index 0 moves back to 10", () => {
    const fullRange = getRangeSelection(0, 11, 12);
    const shrunkRange = getRangeSelection(0, 10, 12);

    expect(fullRange.filter((index) => !shrunkRange.includes(index))).toEqual([
      11,
    ]);
  });

  it("spans the last row when the anchor and the current cell are reversed", () => {
    expect(getRangeSelection(11, 10, 12)).toEqual([10, 11]);
  });

  it("returns the same range when the drag is reversed", () => {
    expect(getRangeSelection(10, 0, 12)).toEqual(getRangeSelection(0, 10, 12));
  });

  it("clamps cells outside the page", () => {
    expect(getRangeSelection(0, 99, 10)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(getRangeSelection(-5, 2, 10)).toEqual([0, 1, 2]);
  });

  it("handles a single-column grid as a contiguous range", () => {
    expect(getRangeSelection(1, 4, 6)).toEqual([1, 2, 3, 4]);
  });

  it("selects the whole page", () => {
    expect(getRangeSelection(0, 11, 12)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("keeps every index in page order without duplicates", () => {
    const selection = getRangeSelection(8, 1, 9);
    expect(selection).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(selection).size).toBe(selection.length);
    expect([...selection].sort((a, b) => a - b)).toEqual(selection);
  });

  it("returns nothing for an empty page", () => {
    expect(getRangeSelection(0, 0, 0)).toEqual([]);
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
