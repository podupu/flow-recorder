/**
 * Soft-keyboard (IME) state, parsed from `adb shell dumpsys input_method`.
 *
 * The keyboard lives in its own window, and `uiautomator dump` only serialises the focused
 * window - so keyboard keys never appear in the hierarchy. Without knowing where the IME is,
 * the mirror resolves a point over the keyboard to whatever app view sits *behind* it and
 * records a selector that would replay against the wrong element. Knowing the region lets the
 * panel treat it as uninspectable instead of silently lying.
 */

export interface ImeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ImeState {
  showing: boolean;
  /** Touchable region in device pixels, or null when hidden/unknown. */
  region: ImeRect | null;
}

/** Matches `touchableRegion=SkRegion(...)` and captures only what is inside SkRegion(...). */
const REGION_RE = /touchableRegion=SkRegion\(((?:\([^)]*\)|[^()])*)\)/g;
const RECT_RE = /\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/g;

export function parseImeState(dumpsysOutput: string): ImeState {
  const text = dumpsysOutput || '';
  const showing = /mInputShown=true/.test(text) || /mIsInputViewShown=true/.test(text);
  if (!showing) {
    // A touchableRegion can linger after the IME is dismissed, so it is only trusted
    // while the input view is actually shown.
    return { showing: false, region: null };
  }

  // An SkRegion may hold several rects; the keyboard body is the largest of them.
  let best: ImeRect | null = null;
  let bestArea = 0;
  REGION_RE.lastIndex = 0;
  let region: RegExpExecArray | null;
  while ((region = REGION_RE.exec(text))) {
    RECT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RECT_RE.exec(region[1]))) {
      const rect = { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] };
      const area = (rect.right - rect.left) * (rect.bottom - rect.top);
      if (area > bestArea) {
        best = rect;
        bestArea = area;
      }
    }
  }

  return { showing: true, region: bestArea > 0 ? best : null };
}

/** True when the point (device pixels) falls inside the keyboard's touchable region. */
export function isInsideIme(state: ImeState, x: number, y: number): boolean {
  const r = state.region;
  if (!state.showing || !r) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
