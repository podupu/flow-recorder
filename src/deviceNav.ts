/**
 * The Android navigation bar rendered under the mirror.
 *
 * Recording is deliberately asymmetric: Back and Home map onto real Maestro commands, so
 * pressing them belongs in the flow. Recents has no Maestro equivalent - recording it as a
 * raw keycode would produce a flow that cannot be replayed - and Reload is a panel-only
 * refresh that never touches the device. Keeping that policy here (rather than spread across
 * the panel's message handlers) makes it testable and keeps the rule in one place.
 */

export const NAV_ACTIONS = ['back', 'home', 'recents', 'reload'] as const;

export type NavAction = (typeof NAV_ACTIONS)[number];

export interface NavActionSpec {
  /** Android keycode to inject, or null when the action does not touch the device. */
  keycode: number | null;
  /** Maestro step to append, or null when the action is not representable in a flow. */
  step: any | null;
}

const SPECS: Record<NavAction, NavActionSpec> = {
  back: { keycode: 4, step: 'back' },
  home: { keycode: 3, step: { pressKey: 'home' } },
  recents: { keycode: 187, step: null },
  reload: { keycode: null, step: null }
};

export function isNavAction(value: string): value is NavAction {
  return (NAV_ACTIONS as readonly string[]).includes(value);
}

export function navActionSpec(action: string): NavActionSpec {
  if (!isNavAction(action)) {
    throw new Error(`Unknown navigation action: ${action}`);
  }
  const spec = SPECS[action];
  // Hand back a copy so a caller mutating the step cannot corrupt the table.
  return { keycode: spec.keycode, step: spec.step && JSON.parse(JSON.stringify(spec.step)) };
}
