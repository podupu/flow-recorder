import { execFile } from 'child_process';
import * as idb from './idb';
import {
  iosKeyboardRegion,
  isBlankHierarchy,
  parseIosElements,
  parseIosScreenSize
} from './iosElements';
import { InstalledApp, parseSimctlApps, isAutomationApp } from '../installedApps';
import {
  DeviceDriver,
  DeviceElement,
  DevicePlatform,
  DeviceRect,
  DeviceSize,
  UnsupportedOperationError
} from '../deviceDriver';

function simctl(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('xcrun', ['simctl', ...args], (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

/**
 * iOS Simulator via `xcrun simctl` (screenshots, app lifecycle) and `idb` (input, hierarchy).
 *
 * All coordinates are POINTS - the space both `idb ui tap` and the accessibility frames use.
 * The screenshot is 3x that in pixels, but the panel only ever works in fractions, so the
 * difference is contained here and in iosElements.
 *
 * describe-all is fetched once per refresh and reused for the keyboard region, because it is
 * the same query - iOS exposes keyboard keys as ordinary elements rather than in a separate
 * window the way Android does.
 */
export class IosDriver implements DeviceDriver {
  public readonly platform: DevicePlatform = 'iOS';
  private size: DeviceSize | undefined;
  private lastRaw: any[] = [];
  /** Rate-limits the wake nudge so a poll loop cannot fight a deliberately locked device. */
  private lastWakeAt = 0;

  constructor(public readonly deviceId: string) {}

  public async screenSize(): Promise<DeviceSize> {
    if (this.size) return this.size;

    const raw = await this.describeAwake();
    this.lastRaw = raw;
    const parsed = parseIosScreenSize(raw);
    if (!parsed) {
      throw new Error(
        'The simulator screen appears to be off or locked, so there is nothing to mirror. ' +
          'Unlock the simulator, then reopen the mirror.'
      );
    }
    this.size = parsed;
    return parsed;
  }

  public screenshot(): Promise<Buffer> {
    return idb.screenshot(this.deviceId);
  }

  /**
   * The hierarchy, waking the device first if it has nothing to report.
   *
   * A locked or sleeping simulator returns a single Application element sized 0x0 rather than
   * an error. Left alone that surfaces as an empty overlay - no element detection, and a dark
   * screen - with nothing explaining why. Pressing HOME wakes it, rate-limited so a 2.5s poll
   * cannot keep overriding a device the user locked on purpose.
   */
  private async describeAwake(): Promise<any[]> {
    let raw = await idb.describeAll(this.deviceId);
    if (!isBlankHierarchy(raw)) return raw;

    const now = Date.now();
    if (now - this.lastWakeAt < 15000) return raw;
    this.lastWakeAt = now;

    try {
      await idb.pressButton(this.deviceId, 'HOME');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      raw = await idb.describeAll(this.deviceId);
    } catch {
      // Caller reports the blank hierarchy with an actionable message.
    }
    return raw;
  }

  public async elements(): Promise<DeviceElement[]> {
    const raw = await this.describeAwake();
    this.lastRaw = raw;

    // Reported rather than returned empty: an empty overlay looks like broken element
    // detection, when the truth is simply that the screen is off.
    if (isBlankHierarchy(raw)) {
      throw new Error(
        'The simulator screen is off or locked, so there are no elements to detect. ' +
          'Unlock the simulator - the mirror recovers on its own once it is awake.'
      );
    }
    // Re-read the size each refresh so rotation is picked up.
    const size = parseIosScreenSize(raw);
    if (size) this.size = size;
    return parseIosElements(raw, this.size || { width: 1, height: 1 });
  }

  public async keyboardRegion(): Promise<DeviceRect | null> {
    if (!this.size) return null;
    // Uses the hierarchy already fetched by elements() - no second device round trip.
    return iosKeyboardRegion(this.lastRaw, this.size);
  }

  public tap(x: number, y: number): Promise<void> {
    return idb.tap(this.deviceId, x, y);
  }

  public longPress(x: number, y: number): Promise<void> {
    return idb.longPress(this.deviceId, x, y, 1);
  }

  public async doubleTap(x: number, y: number): Promise<void> {
    await idb.tap(this.deviceId, x, y);
    await idb.tap(this.deviceId, x, y);
  }

  public swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300): Promise<void> {
    return idb.swipe(this.deviceId, x1, y1, x2, y2, durationMs);
  }

  public async scroll(): Promise<void> {
    const size = await this.screenSize();
    const x = Math.round(size.width / 2);
    await idb.swipe(this.deviceId, x, Math.round(size.height * 0.7), x, Math.round(size.height * 0.3), 300);
  }

  public inputText(text: string): Promise<void> {
    return idb.inputText(this.deviceId, text);
  }

  public async eraseText(count: number): Promise<void> {
    // HID keycode 42 is Backspace; idb has no bulk-erase equivalent to adb's.
    for (let i = 0; i < count; i += 1) {
      await idb.pressKeycode(this.deviceId, 42);
    }
  }

  public async pressKey(key: string): Promise<void> {
    const name = key.toLowerCase();
    if (name === 'home') return idb.pressButton(this.deviceId, 'HOME');
    if (name === 'lock' || name === 'power') return idb.pressButton(this.deviceId, 'LOCK');
    if (name === 'enter') return idb.pressKeycode(this.deviceId, 40);
    if (name === 'backspace') return idb.pressKeycode(this.deviceId, 42);
    if (name === 'tab') return idb.pressKeycode(this.deviceId, 43);
    if (name === 'back') return this.back();
    throw new UnsupportedOperationError(`pressKey: ${key}`, this.platform);
  }

  public pressKeycode(keycode: number): Promise<void> {
    return idb.pressKeycode(this.deviceId, keycode);
  }

  /** iOS has no system back button; the platform gesture is a swipe from the left edge. */
  public async back(): Promise<void> {
    const size = await this.screenSize();
    const y = Math.round(size.height / 2);
    await idb.swipe(this.deviceId, 2, y, Math.round(size.width * 0.6), y, 250);
  }

  /** Dismissing the keyboard on iOS is a tap outside it, which the caller does explicitly. */
  public async hideKeyboard(): Promise<void> {
    const size = await this.screenSize();
    await idb.tap(this.deviceId, Math.round(size.width / 2), Math.round(size.height * 0.06));
  }

  public async listApps(): Promise<InstalledApp[]> {
    const out = await idb.listApps(this.deviceId);
    return parseSimctlApps(out).filter((a) => !isAutomationApp(a.bundleId));
  }

  public launchApp(appId: string): Promise<void> {
    return idb.launchApp(this.deviceId, appId);
  }

  public stopApp(appId: string): Promise<void> {
    return idb.terminateApp(this.deviceId, appId);
  }

  public async killApp(appId: string, clearState: boolean): Promise<void> {
    await idb.terminateApp(this.deviceId, appId);
    if (clearState) await this.clearState(appId);
  }

  /** simctl can reset privacy grants; it cannot clear an app's data container in place. */
  public async clearState(appId: string): Promise<void> {
    await simctl(['privacy', this.deviceId, 'reset', 'all', appId]);
  }

  public async setOrientation(orientation: string): Promise<void> {
    throw new UnsupportedOperationError(`setOrientation (${orientation})`, this.platform);
  }

  public setClipboard(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile('xcrun', ['simctl', 'pbcopy', this.deviceId], (err, _o, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
      child.stdin?.end(text);
    });
  }

  /** Cmd+V into the focused field: HID 'v' (25) with the left-GUI modifier. */
  public async pasteText(): Promise<void> {
    throw new UnsupportedOperationError('pasteText', this.platform);
  }

  public async setAirplaneMode(_enabled: boolean): Promise<void> {
    throw new UnsupportedOperationError('Airplane mode', this.platform);
  }

  public setDarkMode(enabled: boolean): Promise<void> {
    return simctl(['ui', this.deviceId, 'appearance', enabled ? 'dark' : 'light']);
  }

  /** iOS has no UiAutomation-style single-connection limit for describe-all to conflict over. */
  public async killConflictingAutomation(): Promise<string[]> {
    return [];
  }

  /** iOS errors never carry a recoverable-driver list; there is no such conflict class. */
  public recoverableDriversFor(_err: unknown): string[] {
    return [];
  }
}
