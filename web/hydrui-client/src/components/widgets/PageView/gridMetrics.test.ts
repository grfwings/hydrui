import { describe, expect, it } from "vitest";

import {
  COMPACT_GRID_GAP,
  COMPACT_GRID_MIN_COLUMNS,
  COMPACT_GRID_PADDING,
  DESKTOP_GRID_GAP,
  DESKTOP_GRID_PADDING,
  computeGridMetrics,
} from "./gridMetrics";

describe("computeGridMetrics", () => {
  it("keeps the historical desktop geometry", () => {
    // 1280px viewport, 100px thumbnails, 16px gap/padding.
    const metrics = computeGridMetrics(1280, 40, 100, false);

    expect(metrics.padding).toBe(DESKTOP_GRID_PADDING);
    expect(metrics.gap).toBe(DESKTOP_GRID_GAP);
    expect(metrics.columns).toBe(
      Math.floor((1280 - DESKTOP_GRID_PADDING * 2) / (100 + DESKTOP_GRID_GAP)),
    );
    expect(metrics.cellSize).toBe(100);
    expect(metrics.rows).toBe(Math.ceil(40 / metrics.columns));
  });

  it("uses at least three columns and fills the width on compact screens", () => {
    const width = 390;
    const metrics = computeGridMetrics(width, 40, 100, true);
    const contentWidth = width - COMPACT_GRID_PADDING * 2;

    expect(metrics.padding).toBe(COMPACT_GRID_PADDING);
    expect(metrics.gap).toBe(COMPACT_GRID_GAP);
    expect(metrics.columns).toBeGreaterThanOrEqual(COMPACT_GRID_MIN_COLUMNS);
    expect(metrics.cellSize).toBeCloseTo(
      (contentWidth - (metrics.columns - 1) * COMPACT_GRID_GAP) /
        metrics.columns,
      5,
    );

    // Cells and gaps exactly fill the content width.
    expect(
      metrics.columns * metrics.cellSize + (metrics.columns - 1) * metrics.gap,
    ).toBeCloseTo(contentWidth, 5);
  });

  it("still fits three columns at 320px", () => {
    const metrics = computeGridMetrics(320, 2, 100, true);

    expect(metrics.columns).toBe(3);
    expect(metrics.cellSize).toBeGreaterThan(0);
    expect(
      metrics.columns * metrics.cellSize + (metrics.columns - 1) * metrics.gap,
    ).toBeCloseTo(320 - COMPACT_GRID_PADDING * 2, 5);
  });

  it("never returns a non-positive cell size for an unmeasured viewport", () => {
    const compact = computeGridMetrics(0, 0, 100, true);
    const desktop = computeGridMetrics(0, 0, 100, false);

    expect(compact.cellSize).toBeGreaterThan(0);
    expect(desktop.cellSize).toBeGreaterThan(0);
    expect(desktop.columns).toBe(1);
  });
});
