export const DESKTOP_GRID_GAP = 16;
export const DESKTOP_GRID_PADDING = 16;
export const COMPACT_GRID_GAP = 4;
export const COMPACT_GRID_PADDING = 8;
export const COMPACT_GRID_MIN_COLUMNS = 3;

// Compact cells aim for 90% of the configured thumbnail size, then stretch to
// fill the row. This keeps roughly the same amount of content on screen while
// removing the wide gutters left by fixed-size cells.
const COMPACT_CELL_TARGET_RATIO = 0.9;

export interface GridMetrics {
  columns: number;
  rows: number;
  /** Effective width and height of one cell, in CSS pixels. */
  cellSize: number;
  gap: number;
  padding: number;
}

/**
 * Compute the grid geometry for the current viewport.
 *
 * Desktop uses the historical fixed `thumbnailSize` cells. Compact viewports
 * choose as many columns as fit (at least three) and stretch cells to fill the
 * available width.
 */
export function computeGridMetrics(
  viewportWidth: number,
  fileCount: number,
  thumbnailSize: number,
  compact: boolean,
): GridMetrics {
  const padding = compact ? COMPACT_GRID_PADDING : DESKTOP_GRID_PADDING;
  const gap = compact ? COMPACT_GRID_GAP : DESKTOP_GRID_GAP;
  const contentWidth = Math.max(0, viewportWidth - padding * 2);

  let columns: number;
  let cellSize: number;

  if (compact) {
    const target = thumbnailSize * COMPACT_CELL_TARGET_RATIO;
    columns = Math.max(
      COMPACT_GRID_MIN_COLUMNS,
      Math.floor((contentWidth + gap) / (target + gap)),
    );
    cellSize = Math.max(1, (contentWidth - (columns - 1) * gap) / columns);
  } else {
    columns = Math.max(1, Math.floor(contentWidth / (thumbnailSize + gap)));
    cellSize = thumbnailSize;
  }

  return {
    columns,
    rows: Math.ceil(fileCount / columns),
    cellSize,
    gap,
    padding,
  };
}
