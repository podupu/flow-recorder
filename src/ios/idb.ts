import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

export async function bootSimulator(udid: string): Promise<void> {
  await exec('xcrun', ['simctl', 'boot', udid], 120000);
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

export async function describeAll(udid: string): Promise<any[]> {
  let out: string;
  try {
    out = await exec(idbCommand(), ['ui', 'describe-all', '--udid', udid]);
  } catch (err: any) {
    // idb reports a shut-down simulator as an accessibility failure, which reads as a bug in
    // element detection rather than "the device is off".
    if (/not booted|cannot spawn companion|no such (device|target)/i.test(err.message)) {
      throw new Error(
        'The simulator is shut down. Boot it (or pick it again from the device list, which ' +
          'boots it for you) and reopen the mirror.'
      );
    }
    throw err;
  }
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
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
