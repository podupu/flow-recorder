/**
 * Anonymous usage counts, off by default.
 *
 * The purpose is narrow: without a denominator — how many people install this, how many
 * actually record a step, how many run a flow — any judgement about what to build next, or
 * whether anyone would pay for it, is guesswork.
 *
 * Three rules keep that from becoming surveillance:
 *
 *  1. Opt-in twice. Our own setting defaults to false, AND VS Code's global telemetry switch
 *     must also be on. Either one off means nothing is sent.
 *  2. An allowlist of events, not a blocklist. An event not named here cannot be sent.
 *  3. An allowlist of property keys AND their permitted values. Selectors, file paths, device
 *     ids and typed text are never sent — not filtered out on a best-effort basis, but
 *     impossible to send, because only known keys with known-shaped values survive.
 */

export const TELEMETRY_EVENTS = ['mirrorOpened', 'stepRecorded', 'flowRun'] as const;
export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

export function isEventAllowed(name: string): name is TelemetryEvent {
  return (TELEMETRY_EVENTS as readonly string[]).includes(name);
}

/**
 * Permitted property keys, each with the exact set of values it may carry. Anything else is
 * dropped, including an unexpected value for a known key.
 */
const ALLOWED_PROPERTIES: Record<string, readonly string[]> = {
  platform: ['Android', 'iOS', 'Web'],
  stepType: [
    'tapOn',
    'longPressOn',
    'doubleTapOn',
    'swipe',
    'inputText',
    'takeScreenshot',
    'assertVisible',
    'assertNotVisible',
    'evalScript',
    'runScript',
    'back',
    'pressKey',
    'other'
  ],
  outcome: ['passed', 'failed', 'cancelled']
};

export function sanitiseProperties(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const permitted = ALLOWED_PROPERTIES[key];
    if (!permitted) continue;
    if (typeof value !== 'string') continue;
    if (!permitted.includes(value)) continue;
    out[key] = value;
  }
  return out;
}

export interface TelemetryState {
  settingEnabled?: boolean;
  vscodeEnabled?: boolean;
}

export function shouldSend(state: TelemetryState | undefined): boolean {
  if (!state) return false;
  return state.settingEnabled === true && state.vscodeEnabled === true;
}
