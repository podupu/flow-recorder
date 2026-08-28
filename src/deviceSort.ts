/**
 * Ordering for the device picker.
 *
 * `simctl list --json` returns runtimes in arbitrary order - the observed order on one machine
 * was iOS 26.2, 26.4, 18.3, 26.1, 26.5, ... 17.5, 15.5 - so anything that assumes the list is
 * sorted (taking the first or last entry as "newest") silently picks a random runtime. Sorting
 * has to be explicit and numeric.
 */

export interface SortableSimulator {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
}

/**
 * Major and minor of a runtime, from either the display form (`iOS 26.5`) or the raw simctl
 * identifier (`com.apple.CoreSimulator.SimRuntime.iOS-26-5`). Unknown runtimes sort last.
 */
export function parseRuntimeVersion(runtime: string): [number, number] {
  if (!runtime) return [-1, -1];

  const normalised = runtime.replace(/^.*SimRuntime\./, '').replace(/-/g, '.');
  const match = normalised.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return [-1, -1];
  return [Number(match[1]), match[2] ? Number(match[2]) : 0];
}

/** Comparator placing the newest runtime first. Compares numerically: "9" > "18" as strings. */
export function compareRuntimes(a: string, b: string): number {
  const [aMajor, aMinor] = parseRuntimeVersion(a);
  const [bMajor, bMinor] = parseRuntimeVersion(b);
  if (aMajor !== bMajor) return bMajor - aMajor;
  return bMinor - aMinor;
}

/**
 * Booted devices first - a running simulator is almost always the intended target, even on an
 * older runtime - then newest runtime, then name.
 */
export function sortSimulators<T extends SortableSimulator>(simulators: T[]): T[] {
  return simulators.slice().sort((a, b) => {
    if (a.booted !== b.booted) return a.booted ? -1 : 1;
    const byRuntime = compareRuntimes(a.runtime, b.runtime);
    if (byRuntime !== 0) return byRuntime;
    // Numeric so iPhone 9 sorts before iPhone 15, not after it.
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}
