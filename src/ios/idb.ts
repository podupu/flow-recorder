import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isBlankHierarchy } from './iosElements';

/**
 * iOS Simulator control.
 *
 * Screenshots go through `xcrun simctl` (always present with Xcode, and marginally faster);
 * input and the accessibility hierarchy require `idb`, which simctl cannot do at all.
 */

export interface IosSimulator {
  udid: string;
  name: string;
  runtime: string;
  booted: boolean;
}

/** idb installs to ~/.local/bin via pip, which is often absent from the GUI PATH. */
function idbCommand(): string {
  const local = path.join(os.homedir(), '.local', 'bin', 'idb');
  return fs.existsSync(local) ? local : 'idb';
}

function exec(command: string, args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${path.basename(command)} ${args.join(' ')} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function isIdbAvailable(): Promise<boolean> {
  try {
    await exec(idbCommand(), ['list-targets'], 10000);
    return true;
  } catch {
    return false;
  }
}

export const IDB_INSTALL_HINT =
  'idb is required for iOS element detection and input. Install it with: ' +
  'brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb';

/** Simulators known to Xcode. Physical devices are reported separately and unsupported. */
export async function listSimulators(): Promise<IosSimulator[]> {
  const out = await exec('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  const data = JSON.parse(out);
  const sims: IosSimulator[] = [];
  for (const [runtime, devices] of Object.entries<any[]>(data.devices || {})) {
    // "com.apple.CoreSimulator.SimRuntime.iOS-26-5" -> "iOS 26.5"
    const label = runtime.replace(/^.*SimRuntime\./, '').replace(/-/g, ' ').replace(/(\w+) (\d+) (\d+)/, '$1 $2.$3');
    for (const d of devices || []) {
      if (!d.isAvailable) continue;
      sims.push({ udid: d.udid, name: d.name, runtime: label, booted: d.state === 'Booted' });
    }
  }
  return sims;
}

/**
 * Wait for boot completion, even when the device already reports "Booted". `simctl boot`
 * only starts booting; accessibility may still return zero-sized frames at that point.
 * -b also handles a device started by Xcode since the picker snapshot without an
 * "already booted" error. Keep a finite timeout for a runtime that cannot finish starting.
 */
export async function bootSimulator(udid: string): Promise<void> {
  try {
    await exec('xcrun', ['simctl', 'bootstatus', udid, '-b'], 180000);
  } catch (err: any) {
    throw new Error(
      `Could not finish preparing the iOS simulator. Open Simulator to check its startup ` +
      `progress, then select the device again. ${err.message}`
    );
  }
}

/**
 * simctl writes to a file rather than stdout - `screenshot -` produces an empty file - so the
 * PNG round-trips through a temp file that is always cleaned up.
 */
export async function screenshot(udid: string): Promise<Buffer> {
  const file = path.join(os.tmpdir(), `flow-recorder-${udid}-${Date.now()}.png`);
  try {
    await exec('xcrun', ['simctl', 'io', udid, 'screenshot', file], 20000);
    return fs.readFileSync(file);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

// Keep working older runtimes on their existing API. Once the host AX translation fails,
// reuse the guest reader instead of retrying the broken host API on every poll.
const guestAccessibilityDevices = new Set<string>();

async function readAccessibility(udid: string, guest: boolean): Promise<any[]> {
  const args = ['ui', 'describe-all', '--udid', udid];
  if (guest) args.push('--api', 'axbridge');
  const out = await exec(idbCommand(), args);
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) throw new Error('idb returned an unexpected accessibility response (expected an array).');
  return parsed;
}

export async function describeAll(udid: string): Promise<any[]> {
  if (!guestAccessibilityDevices.has(udid)) {
    try {
      const raw = await readAccessibility(udid, false);
      if (!isBlankHierarchy(raw)) return raw;
    } catch (err: any) {
      // Modern companions report this failure explicitly; 1.1.8 instead serializes a
      // null translation into one all-null, zero-sized node. Both need the guest API.
      if (!/no translation object/i.test(err.message)) throw err;
    }
  }

  try {
    const raw = await readAccessibility(udid, true);
    if (isBlankHierarchy(raw)) {
      throw new Error('The accessibility bridge returned no usable element bounds.');
    }
    guestAccessibilityDevices.add(udid);
    return raw;
  } catch (err: any) {
    throw new Error(
      'iOS accessibility could not be read through idb. This is not evidence that the screen is locked. ' +
      'For Xcode 27 / iOS 27, use fb-idb and idb-companion 1.5.9 or newer, and restart any ' +
      'companion processes left running from an older installation. ' +
      `Details: ${err.message}`
    );
  }
}

/** All coordinates below are in POINTS, the space idb and the hierarchy both use. */
export async function tap(udid: string, x: number, y: number): Promise<void> {
  await exec(idbCommand(), ['ui', 'tap', '--udid', udid, String(Math.round(x)), String(Math.round(y))]);
}

export async function longPress(udid: string, x: number, y: number, seconds = 1): Promise<void> {
  await exec(idbCommand(), [
    'ui',
    'tap',
    '--udid',
    udid,
    '--duration',
    String(seconds),
    String(Math.round(x)),
    String(Math.round(y))
  ]);
}

export async function swipe(
  udid: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300
): Promise<void> {
  await exec(idbCommand(), [
    'ui',
    'swipe',
    '--udid',
    udid,
    '--duration',
    String(durationMs / 1000),
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2))
  ]);
}

export async function inputText(udid: string, text: string): Promise<void> {
  await exec(idbCommand(), ['ui', 'text', '--udid', udid, text]);
}

/** idb button names: HOME, LOCK, SIDE_BUTTON, SIRI, APPLE_PAY. */
export async function pressButton(udid: string, button: string): Promise<void> {
  await exec(idbCommand(), ['ui', 'button', '--udid', udid, button]);
}

/** HID keycodes, used for Enter (40) and Backspace (42). */
export async function pressKeycode(udid: string, keycode: number): Promise<void> {
  await exec(idbCommand(), ['ui', 'key', '--udid', udid, String(keycode)]);
}

/** Raw `simctl listapps` output; an old-style plist, parsed in installedApps.ts. */
export async function listApps(udid: string): Promise<string> {
  return exec('xcrun', ['simctl', 'listapps', udid], 30000);
}

export async function launchApp(udid: string, bundleId: string): Promise<void> {
  await exec('xcrun', ['simctl', 'launch', udid, bundleId]);
}

export async function terminateApp(udid: string, bundleId: string): Promise<void> {
  await exec('xcrun', ['simctl', 'terminate', udid, bundleId]);
}
