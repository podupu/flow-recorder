/**
 * Naming for captured screenshots.
 *
 * Maestro resolves `takeScreenshot: assets/foo.png` relative to the flow file, so captures are
 * written to an `assets/` directory beside the flow rather than at the workspace root.
 *
 * Names come from user input and are pasted into a file path, so they are sanitised here:
 * without it, "../../x" would write outside the assets directory.
 */

export const ASSETS_DIR = 'assets';

export function sanitizeScreenshotName(name: string | undefined): string {
  const base = (name || '').trim().replace(/\.png$/i, '');
  const safe = base
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'screenshot';
}

/**
 * Picks a file name that does not collide with `existing`. The previous stub always wrote
 * `placeholder.png`, so every capture silently overwrote the one before it.
 */
export function uniqueScreenshotName(name: string, existing: string[]): string {
  const base = sanitizeScreenshotName(name);
  const taken = new Set(existing.map((f) => f.toLowerCase()));
  let candidate = `${base}.png`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}.png`;
    n += 1;
  }
  return candidate;
}
