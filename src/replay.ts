/**
 * Replaying flow steps through the mirror's own device driver, rather than the Maestro CLI.
 *
 * Why this exists: `maestro test` cannot run against the app's current state. Its driver takes
 * over the device at startup and the app is backgrounded before the first step runs - verified
 * by opening Settings, running a flow containing only `assertVisible: "Settings"`, and finding
 * Maestro's own failure screenshot showing the home screen. There is no flag to avoid it; the
 * docs point at Maestro Studio, which sidesteps the CLI and drives the device directly.
 *
 * So replay drives the device directly too. It is deliberately *not* a Maestro run: there is no
 * JavaScript engine, so anything needing one is skipped and reported rather than approximated.
 */

export type ReplayKind =
  | 'tap'
  | 'longPress'
  | 'doubleTap'
  | 'inputText'
  | 'eraseText'
  | 'pressKey'
  | 'back'
  | 'hideKeyboard'
  | 'scroll'
  | 'swipe'
  | 'assertVisible'
  | 'assertNotVisible'
  | 'unsupported';

export interface ReplayStep {
  kind: ReplayKind;
  selector?: { text?: string; id?: string };
  value?: string;
  count?: number;
  direction?: string;
  /** Present when kind is 'unsupported'. */
  reason?: string;
}

/** Commands that only Maestro's own engine can carry out. */
const NEEDS_MAESTRO: Record<string, string> = {
  runFlow: 'runFlow needs the Maestro engine to load and execute another flow',
  runScript: 'runScript needs the Maestro JavaScript engine',
  evalScript: 'evalScript needs the Maestro JavaScript engine',
  assertTrue: 'assertTrue evaluates a Maestro expression',
  repeat: 'repeat is a Maestro control structure',
  retry: 'retry is a Maestro control structure',
  extendedWaitUntil: 'extendedWaitUntil is handled by the Maestro engine',
  copyTextFrom: 'copyTextFrom stores into Maestro output',
  addMedia: 'addMedia is handled by the Maestro engine'
};

function commandOf(step: any): string | undefined {
  if (typeof step === 'string') return step;
  if (step && typeof step === 'object' && !Array.isArray(step)) return Object.keys(step)[0];
  return undefined;
}

function selectorOf(value: any): { text?: string; id?: string } | undefined {
  if (typeof value === 'string') return { text: value };
  if (value && typeof value === 'object') {
    const out: { text?: string; id?: string } = {};
    if (typeof value.text === 'string') out.text = value.text;
    if (typeof value.id === 'string') out.id = value.id;
    if (out.text || out.id) return out;
  }
  return undefined;
}

function hasVariable(step: any): boolean {
  return JSON.stringify(step ?? null).includes('${');
}

export function classifyStep(step: any): ReplayStep {
  const command = commandOf(step);
  if (!command) return { kind: 'unsupported', reason: 'Not a recognisable step' };

  // A variable is substituted by Maestro at run time; replay has no value for it.
  if (hasVariable(step)) {
    return { kind: 'unsupported', reason: `${command} contains a \${variable} Maestro resolves at run time` };
  }

  const needsEngine = NEEDS_MAESTRO[command];
  if (needsEngine) return { kind: 'unsupported', reason: needsEngine };

  const value = typeof step === 'string' ? undefined : step[command];

  switch (command) {
    case 'tapOn':
      return { kind: 'tap', selector: selectorOf(value) };
    case 'longPressOn':
      return { kind: 'longPress', selector: selectorOf(value) };
    case 'doubleTapOn':
      return { kind: 'doubleTap', selector: selectorOf(value) };
    case 'assertVisible':
      return { kind: 'assertVisible', selector: selectorOf(value) };
    case 'assertNotVisible':
      return { kind: 'assertNotVisible', selector: selectorOf(value) };
    case 'inputText':
      return { kind: 'inputText', value: typeof value === 'string' ? value : '' };
    case 'eraseText':
      return { kind: 'eraseText', count: typeof value === 'number' ? value : 50 };
    case 'pressKey':
      return { kind: 'pressKey', value: typeof value === 'string' ? value : '' };
    case 'back':
      return { kind: 'back' };
    case 'hideKeyboard':
      return { kind: 'hideKeyboard' };
    case 'scroll':
      return { kind: 'scroll' };
    case 'swipe':
      return {
        kind: 'swipe',
        direction: value && typeof value === 'object' ? String(value.direction || 'UP') : 'UP'
      };
    default:
      return { kind: 'unsupported', reason: `${command} is not supported by replay` };
  }
}

export interface ReplayOutcome {
  replayed: number;
  skipped: number;
  /** Zero-based index of the step that stopped the replay, if any. */
  failedAt?: number;
  failure?: string;
}

export function summariseReplay(outcome: ReplayOutcome): string {
  const { replayed, skipped, failedAt, failure } = outcome;

  if (failedAt !== undefined) {
    // 1-based to match the step numbering shown in the Testing view.
    return `Replay stopped at step ${failedAt + 1}: ${failure || 'step failed'}. ${replayed} replayed.`;
  }
  if (!replayed && !skipped) return 'Nothing to replay from here.';

  const base = `Replayed ${replayed} step${replayed === 1 ? '' : 's'} on the live app`;
  return skipped ? `${base}; ${skipped} skipped (need the Maestro engine).` : `${base}.`;
}
