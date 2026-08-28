/**
 * The device operations the mirror panel needs, so one panel serves Android and iOS.
 *
 * Each driver absorbs its own coordinate system: Android works in device pixels, iOS in
 * points (its screenshots are 3x that). Everything crossing this interface is either a
 * 0-1 fraction or a coordinate in the driver's own `screenSize()` space, so the panel never
 * has to know which platform it is talking to.
 */

export type DevicePlatform = 'Android' | 'iOS';

export interface DeviceSize {
  width: number;
  height: number;
}

export interface DeviceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Already normalised to 0-1 fractions - the shape the webview consumes. */
export interface DeviceElement {
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

/**
 * Thrown for an operation the platform genuinely cannot do - airplane mode on a simulator,
 * for example. The panel reports these as "not supported on iOS" rather than a bare failure,
 * so a missing capability never looks like a bug.
 */
export class UnsupportedOperationError extends Error {
  constructor(operation: string, platform: DevicePlatform) {
    super(`${operation} is not supported on ${platform}.`);
    this.name = 'UnsupportedOperationError';
  }
}

export interface DeviceDriver {
  readonly platform: DevicePlatform;
  readonly deviceId: string;

  /** The coordinate space for every x/y below, and what element fractions are relative to. */
  screenSize(): Promise<DeviceSize>;
  screenshot(): Promise<Buffer>;
  elements(): Promise<DeviceElement[]>;
  /** Soft-keyboard region as 0-1 fractions, or null when hidden. */
  keyboardRegion(): Promise<DeviceRect | null>;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number): Promise<void>;
  doubleTap(x: number, y: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number): Promise<void>;
  scroll(): Promise<void>;

  inputText(text: string): Promise<void>;
  eraseText(count: number): Promise<void>;
  pressKey(key: string): Promise<void>;
  pressKeycode(keycode: number): Promise<void>;
  back(): Promise<void>;
  hideKeyboard(): Promise<void>;

  launchApp(appId: string): Promise<void>;
  stopApp(appId: string): Promise<void>;
  killApp(appId: string, clearState: boolean): Promise<void>;
  clearState(appId: string): Promise<void>;

  setOrientation(orientation: string): Promise<void>;
  setClipboard(text: string): Promise<void>;
  pasteText(): Promise<void>;
  setAirplaneMode(enabled: boolean): Promise<void>;
  setDarkMode(enabled: boolean): Promise<void>;
}
