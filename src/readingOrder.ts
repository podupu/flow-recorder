/**
 * Orders elements the way a person reading the screen would: row by row top to bottom, left to
 * right within a row. Used to number the "show all elements" overlay, matching Maestro
 * Studio's inspector.
 *
 * Not a plain sort by top: two elements are rarely pixel-aligned even when they clearly belong
 * to the same row (a label and the button beside it), so rows are found by vertical overlap,
 * not equality.
 *
 * This module runs in the extension host and is unit tested here; media/mirror.js carries an
 * identical copy for the webview sandbox, which cannot `require` extension-host code - the
 * same duplication already used for hit-testing between mirrorPanel.ts and mirror.js.
 */

export interface Positioned {
  top: number;
  height: number;
  left: number;
}

/** Two elements are in the same row when their vertical spans overlap by at least this much. */
const ROW_OVERLAP_THRESHOLD = 0.5;

function verticalOverlap(a: Positioned, b: Positioned): number {
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  const overlap = Math.min(aBottom, bBottom) - Math.max(a.top, b.top);
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.height, b.height);
}

export function sortByReadingOrder<T extends Positioned>(elements: T[]): T[] {
  const byTop = elements.slice().sort((a, b) => a.top - b.top);

  const rows: T[][] = [];
  for (const element of byTop) {
    // Join the most recent row if this element overlaps ANY member of it - a row's own
    // vertical span can drift from its first element (e.g. one tall icon beside short text),
    // so comparing only to the row's first member would miss a genuine match.
    const row = rows[rows.length - 1];
    const joins = row && row.some((existing) => verticalOverlap(existing, element) >= ROW_OVERLAP_THRESHOLD);
    if (joins) {
      row.push(element);
    } else {
      rows.push([element]);
    }
  }

  const out: T[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
    out.push(...row);
  }
  return out;
}
