/**
 * Checks a flow's selectors against what is actually on the device right now, and reports
 * which no longer match.
 *
 * This exists because writing the first test is not the expensive part — Maestro Studio does
 * that for free. The expensive part is that tests break when the UI changes, and someone
 * spends an afternoon working out which selector went stale. This finds them in a second.
 *
 * Deliberately conservative: a selector containing a `${VARIABLE}` is resolved at run time and
 * cannot be judged statically, so it is reported as skipped rather than broken. Reporting a
 * false break is worse than reporting nothing.
 */

/** Commands whose value targets an element. Everything else takes no selector. */
const TARGETING_COMMANDS = [
  'tapOn',
  'longPressOn',
  'doubleTapOn',
  'assertVisible',
  'assertNotVisible',
  'copyTextFrom',
  'scrollUntilVisible'
];

export interface FlowSelector {
  text?: string;
  id?: string;
}

export interface FoundSelector {
  /** Index of the step in the flow, so a report can point at it. */
  index: number;
  command: string;
  selector: FlowSelector;
}

export interface ScreenElement {
  elementId: number;
  text?: string;
  resourceId?: string;
  selectable?: boolean;
}

export interface BrokenSelector extends FoundSelector {
  suggestion?: ScreenElement;
}

export interface Diagnosis {
  matched: FoundSelector[];
  broken: BrokenSelector[];
  /** Selectors that could not be judged, e.g. those containing a variable. */
  skipped: FoundSelector[];
}

function hasVariable(selector: FlowSelector): boolean {
  return Object.values(selector).some((v) => typeof v === 'string' && v.includes('${'));
}

export function extractSelectors(steps: unknown): FoundSelector[] {
  if (!Array.isArray(steps)) return [];

  const found: FoundSelector[] = [];
  steps.forEach((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return;

    for (const command of TARGETING_COMMANDS) {
      const value = (step as any)[command];
      if (value === undefined || value === null) continue;

      // Shorthand: `tapOn: "Sign In"` means match on text.
      if (typeof value === 'string') {
        found.push({ index, command, selector: { text: value } });
        continue;
      }
      if (typeof value !== 'object') continue;

      const selector: FlowSelector = {};
      if (typeof value.text === 'string') selector.text = value.text;
      if (typeof value.id === 'string') selector.id = value.id;
      // A point selector targets a coordinate, so it cannot go stale by name.
      if (!selector.text && !selector.id) continue;

      found.push({ index, command, selector });
    }
  });
  return found;
}

/**
 * @returns the matching element, `undefined` when nothing matches, or `null` when the
 * selector cannot be judged (it contains a run-time variable).
 */
export function matchSelector(
  selector: FlowSelector,
  screen: ScreenElement[]
): ScreenElement | undefined | null {
  if (hasVariable(selector)) return null;
  if (!Array.isArray(screen)) return undefined;

  return screen.find((element) => {
    if (selector.text !== undefined && element.text !== selector.text) return false;
    if (selector.id !== undefined && element.resourceId !== selector.id) return false;
    return selector.text !== undefined || selector.id !== undefined;
  });
}

/** Normalised similarity in [0,1], via Levenshtein distance over the longer string. */
function similarity(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 1;
  if (!s.length || !t.length) return 0;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= t.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

/** Threshold chosen so a rename or case change matches, but an unrelated label does not. */
const SUGGESTION_THRESHOLD = 0.6;

/** The distinguishing part of a resource id: `com.app:id/submit` -> `submit`. */
function localPart(id: string): string {
  const slash = id.lastIndexOf('/');
  const colon = id.lastIndexOf(':');
  return id.slice(Math.max(slash, colon) + 1) || id;
}

/**
 * Resource ids share long package prefixes, so comparing them whole is misleading -
 * `com.app:id/gone` and `com.app:id/email` score 0.69 as raw strings despite being unrelated.
 * Only the local part carries meaning, and a pure suffix rename (`password` ->
 * `password_field`) is the common case worth catching.
 */
function idSimilarity(a: string, b: string): number {
  const la = localPart(a).toLowerCase();
  const lb = localPart(b).toLowerCase();
  if (la === lb) return 1;
  if (la.startsWith(lb) || lb.startsWith(la)) return 0.9;
  return similarity(la, lb);
}

export function suggestReplacement(
  selector: FlowSelector,
  screen: ScreenElement[]
): ScreenElement | undefined {
  if (!Array.isArray(screen) || hasVariable(selector)) return undefined;

  const wanted = selector.text ?? selector.id;
  if (!wanted) return undefined;
  const byText = selector.text !== undefined;

  let best: ScreenElement | undefined;
  let bestScore = SUGGESTION_THRESHOLD;

  for (const element of screen) {
    // Compare like with like: a stale text selector should suggest a text, not an id.
    const candidate = byText ? element.text : element.resourceId;
    if (!candidate) continue;
    const score = byText ? similarity(wanted, candidate) : idSimilarity(wanted, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = element;
    }
  }
  return best;
}

export function diagnoseFlow(steps: unknown, screen: ScreenElement[]): Diagnosis {
  const result: Diagnosis = { matched: [], broken: [], skipped: [] };

  for (const found of extractSelectors(steps)) {
    const match = matchSelector(found.selector, screen);
    if (match === null) {
      result.skipped.push(found);
    } else if (match) {
      result.matched.push(found);
    } else {
      result.broken.push({ ...found, suggestion: suggestReplacement(found.selector, screen) });
    }
  }
  return result;
}
