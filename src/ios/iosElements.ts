/**
 * Normalises `idb ui describe-all` output into the element shape the mirror webview already
 * consumes, so iOS and Android render through exactly the same code.
 *
 * Two things differ from Android and are absorbed entirely here:
 *
 *  - **Points vs pixels.** The screenshot is in device pixels (e.g. 1206x2622) while frames and
 *    `idb ui tap` are in points (402x874). Everything is normalised against the points size,
 *    which is also the tap coordinate space.
 *  - **Flat hierarchy.** describe-all returns a flat array with no parent links, so Android's
 *    "walk up to a labelled ancestor" has no counterpart; an unlabelled element yields a point
 *    selector instead.
 */

export interface IosSize {
  width: number;
  height: number;
}

export interface NormalisedElement {
  elementId: number;
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  selector: { text?: string; id?: string; point?: string };
  parentId: number;
  selectable: boolean;
}

interface RawFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function frameOf(raw: any): RawFrame | undefined {
  const f = raw && raw.frame;
  if (!f) return undefined;
  const x = Number(f.x);
  const y = Number(f.y);
  const width = Number(f.width);
  const height = Number(f.height);
  if (![x, y, width, height].every(Number.isFinite)) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** Intersects a frame with the screen, or returns undefined when nothing is visible. */
function clipToScreen(frame: RawFrame, screen: IosSize): RawFrame | undefined {
  const left = Math.max(0, frame.x);
  const top = Math.max(0, frame.y);
  const right = Math.min(screen.width, frame.x + frame.width);
  const bottom = Math.min(screen.height, frame.y + frame.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A label of only whitespace (the Application element reports " ") is no label. */
function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The tap coordinate space, taken from the Application element. Falls back to the largest
 * frame so a hierarchy without an Application root still yields something usable.
 */
export function parseIosScreenSize(raw: any[]): IosSize | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const app = raw.find((e) => e && e.type === 'Application');
  const appFrame = frameOf(app);
  if (appFrame) return { width: appFrame.width, height: appFrame.height };

  let best: IosSize | undefined;
  let bestArea = 0;
  for (const entry of raw) {
    const f = frameOf(entry);
    if (!f) continue;
    const area = f.width * f.height;
    if (area > bestArea) {
      bestArea = area;
      best = { width: f.x + f.width, height: f.y + f.height };
    }
  }
  return best;
}

export function iosSelector(
  element: { text?: string; resourceId?: string },
  x: number,
  y: number,
  screen: IosSize
): { text?: string; id?: string; point?: string } {
  if (element.text) return { text: element.text };
  if (element.resourceId) return { id: element.resourceId };
  return {
    point: `${Math.round((x / screen.width) * 100)}%,${Math.round((y / screen.height) * 100)}%`
  };
}

export function parseIosElements(raw: any, screen: IosSize): NormalisedElement[] {
  if (!Array.isArray(raw) || !screen || !screen.width || !screen.height) return [];

  const out: NormalisedElement[] = [];
  for (const entry of raw) {
    const raw_ = frameOf(entry);
    if (!raw_) continue;

    // iOS reports frames unclipped: a partially scrolled widget can report a bottom well
    // past the screen. Android's uiautomator pre-clips, so clipping here keeps both
    // platforms' overlays inside the mirror. Fully off-screen elements are dropped.
    const frame = clipToScreen(raw_, screen);
    if (!frame) continue;

    const text = cleanText(entry.AXLabel) || cleanText(entry.title);
    const resourceId = cleanText(entry.AXUniqueId);
    // Centre of the VISIBLE portion, so a point selector targets somewhere tappable.
    const centreX = frame.x + frame.width / 2;
    const centreY = frame.y + frame.height / 2;

    const area = frame.width * frame.height;
    const screenArea = screen.width * screen.height;
    // Same rule as Android's isSelectable: labelled, and not effectively the whole screen.
    const selectable = Boolean((text || resourceId) && area <= screenArea * 0.9);

    out.push({
      elementId: out.length,
      text,
      resourceId,
      contentDesc: cleanText(entry.help),
      className: cleanText(entry.type),
      left: frame.x / screen.width,
      top: frame.y / screen.height,
      width: frame.width / screen.width,
      height: frame.height / screen.height,
      selector: iosSelector({ text, resourceId }, centreX, centreY, screen),
      // Flat hierarchy: there is no parent to walk up to.
      parentId: -1,
      selectable
    });
  }
  return out;
}

/**
 * The soft keyboard, derived from the hierarchy rather than a separate query - iOS exposes
 * keyboard keys as ordinary accessible elements, unlike Android where the IME is a separate
 * window absent from the dump.
 */
export function iosKeyboardRegion(
  raw: any,
  screen: IosSize
): { left: number; top: number; width: number; height: number } | null {
  if (!Array.isArray(raw) || !screen) return null;

  const container = raw.find((e) => e && e.type === 'Keyboard');
  const containerFrame = frameOf(container);
  if (containerFrame) {
    return {
      left: containerFrame.x / screen.width,
      top: containerFrame.y / screen.height,
      width: containerFrame.width / screen.width,
      height: containerFrame.height / screen.height
    };
  }

  // No container - take the bounding box of the individual keys.
  const keys = raw
    .filter((e: any) => e && e.type === 'Key')
    .map(frameOf)
    .filter(Boolean) as RawFrame[];
  if (!keys.length) return null;

  const left = Math.min(...keys.map((f) => f.x));
  const top = Math.min(...keys.map((f) => f.y));
  const right = Math.max(...keys.map((f) => f.x + f.width));
  const bottom = Math.max(...keys.map((f) => f.y + f.height));

  return {
    left: left / screen.width,
    top: top / screen.height,
    width: (right - left) / screen.width,
    height: (bottom - top) / screen.height
  };
}
