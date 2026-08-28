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

// --- Platform-specific nav bars -------------------------------------------------

export type NavPlatform = 'Android' | 'iOS' | 'Web';

export interface NavButton {
  action: string;
  label: string;
  title: string;
  /** Inline SVG, sized to match the other nav icons. */
  icon: string;
}

/** How an action is delivered: a keycode, a gesture the driver performs, or neither. */
export interface PlatformNavSpec {
  keycode: number | null;
  gesture: 'edgeSwipeBack' | 'doubleHome' | null;
  button: string | null;
  step: any | null;
}

const svg = (body: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICON = {
  // Android's filled triangle.
  androidBack: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.5 4.5 6.8 12l8.7 7.5z"/></svg>`,
  androidHome: svg('<circle cx="12" cy="12" r="7"/>'),
  androidRecents: svg('<rect x="6.25" y="6.25" width="11.5" height="11.5" rx="1.5"/>'),
  // iOS: a chevron, because back is a left-edge swipe rather than a button.
  iosBack: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  // A house, not the iPhone home-indicator bar: at 16px the bar renders as a bare dash and
  // reads as nothing in particular, whereas a house is unambiguous at any size.
  iosHome: svg('<path d="M3.8 11 12 4l8.2 7"/><path d="M6.3 9.9V19.5h11.4V9.9"/>'),
  // Overlapping cards for the app switcher.
  iosSwitcher: svg('<rect x="4" y="7" width="11" height="13" rx="2"/><path d="M9 4h9a2 2 0 0 1 2 2v11"/>'),
  iosLock: svg('<path d="M12 3.5v6"/><path d="M17.5 6.8a7 7 0 1 1-11 0"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5V9h-4.5"/>')
};

const ANDROID_BUTTONS: NavButton[] = [
  { action: 'back', label: 'Back', title: 'Back - records a back step', icon: ICON.androidBack },
  { action: 'home', label: 'Home', title: 'Home - records pressKey: home', icon: ICON.androidHome },
  { action: 'recents', label: 'Recents', title: 'Recents - drives the device, not recorded', icon: ICON.androidRecents },
  { action: 'reload', label: 'Reload', title: 'Reload screen and elements - not recorded', icon: ICON.reload }
];

// No Back button: iOS has no system back control - it is a left-edge swipe, which you can
// perform directly on the mirror. Putting a button there implied hardware that does not exist.
const IOS_BUTTONS: NavButton[] = [
  { action: 'home', label: 'Home', title: 'Home - records pressKey: home', icon: ICON.iosHome },
  { action: 'appSwitcher', label: 'App Switcher', title: 'App Switcher - drives the device, not recorded', icon: ICON.iosSwitcher },
  { action: 'lock', label: 'Lock', title: 'Lock - records pressKey: lock', icon: ICON.iosLock },
  { action: 'reload', label: 'Reload', title: 'Reload screen and elements - not recorded', icon: ICON.reload }
];

export function navButtonsFor(platform: string): NavButton[] {
  return platform === 'iOS' ? IOS_BUTTONS : ANDROID_BUTTONS;
}

/**
 * The same action is delivered differently per platform: Android sends a keycode for Back,
 * iOS has no such key and performs a left-edge swipe instead. Recording is unchanged - both
 * still append `back`, because Maestro maps that onto each platform's own behaviour.
 */
const PLATFORM_SPECS: Record<string, Record<string, PlatformNavSpec>> = {
  Android: {
    back: { keycode: 4, gesture: null, button: null, step: 'back' },
    home: { keycode: 3, gesture: null, button: null, step: { pressKey: 'home' } },
    recents: { keycode: 187, gesture: null, button: null, step: null },
    reload: { keycode: null, gesture: null, button: null, step: null }
  },
  iOS: {
    back: { keycode: null, gesture: 'edgeSwipeBack', button: null, step: 'back' },
    home: { keycode: null, gesture: null, button: 'HOME', step: { pressKey: 'home' } },
    appSwitcher: { keycode: null, gesture: 'doubleHome', button: null, step: null },
    lock: { keycode: null, gesture: null, button: 'LOCK', step: { pressKey: 'lock' } },
    reload: { keycode: null, gesture: null, button: null, step: null }
  }
};

export function navActionSpecFor(action: string, platform: string): PlatformNavSpec {
  const table = PLATFORM_SPECS[platform === 'iOS' ? 'iOS' : 'Android'];
  const spec = table[action];
  if (!spec) throw new Error(`Unknown navigation action for ${platform}: ${action}`);
  return { ...spec, step: spec.step && JSON.parse(JSON.stringify(spec.step)) };
}
