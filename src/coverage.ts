/**
 * Finds horizontal bands of the screen that contain no accessibility elements.
 *
 * From inside the mirror, "this region has no elements" and "element detection is broken" look
 * identical - nothing highlights either way - but they need opposite responses. The second is
 * ours to fix; the first is the app hiding its own views from accessibility, and no change to
 * this extension can recover them. Maestro reads the same accessibility tree at replay time, so
 * a step targeting text in one of these bands would fail even if the recorder guessed it.
 *
 * Naming the band turns a silent dead end into an actionable report.
 */

export interface Positioned {
  top: number;
  height: number;
  left: number;
  width: number;
}

export interface Gap {
  /** Fraction of screen height where the band starts. */
  top: number;
  /** Fraction of screen height the band spans. */
  height: number;
}

export interface GapOptions {
  /** Bands shorter than this are ordinary layout spacing, not missing elements. */
  minHeight?: number;
  /** Horizontal scanlines used to test coverage. */
  samples?: number;
}

const DEFAULT_MIN_HEIGHT = 0.12;
const DEFAULT_SAMPLES = 200;

/**
 * An element covering effectively the whole screen (the iOS `Application` root, Android's
 * top-level FrameLayout) technically covers every scanline, which would report perfect
 * coverage on a screen with nothing else on it at all.
 */
function isScreenSized(element: Positioned): boolean {
  return element.width * element.height > 0.9;
}

export function findAccessibilityGaps(elements: Positioned[], options: GapOptions = {}): Gap[] {
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const samples = options.samples ?? DEFAULT_SAMPLES;

  const real = (elements || []).filter((e) => e && !isScreenSized(e) && e.height > 0);

  // Walk scanlines down the screen, recording runs where nothing is present.
  const gaps: Gap[] = [];
  let runStart: number | undefined;
  for (let i = 0; i < samples; i++) {
    const y = (i + 0.5) / samples;
    const covered = real.some((e) => y >= e.top && y <= e.top + e.height);
    if (!covered) {
      if (runStart === undefined) runStart = i / samples;
      continue;
    }
    if (runStart !== undefined) {
      gaps.push({ top: runStart, height: i / samples - runStart });
      runStart = undefined;
    }
  }
  if (runStart !== undefined) gaps.push({ top: runStart, height: 1 - runStart });

  return gaps.filter((g) => g.height >= minHeight);
}

/** One short sentence for the panel, or undefined when there is nothing worth saying. */
export function describeGaps(gaps: Gap[]): string | undefined {
  if (!gaps || !gaps.length) return undefined;

  const pct = (value: number) => Math.round(value * 100) + '%';
  const where =
    gaps.length === 1
      ? `A ${pct(gaps[0].height)} band of this screen reports no accessibility elements`
      : `${gaps.length} areas of this screen report no accessibility elements ` +
        `(${gaps.map((g) => pct(g.height)).join(', ')})`;

  return (
    `${where}. Steps there can only be recorded as coordinates. This usually means the app hides ` +
    `those views from accessibility - Maestro reads the same tree at replay time, so fixing it ` +
    `in the app is what makes them targetable.`
  );
}
