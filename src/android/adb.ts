import { execFile } from 'child_process';
import { ERASE_MAX } from '../gestures';
import {
  classifyDumpFailure,
  looksLikeHierarchyXml,
  parseAccessibilityServices,
  parseAutomationDrivers,
  HierarchyUnavailableError
} from './hierarchy';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeInputText(text: string): string {
  return text.replace(/ /g, '%s');
}

const KEYCODE_BY_NAME: Record<string, number> = {
  home: 3,
  back: 4,
  enter: 66,
  backspace: 67,
  'volume up': 24,
  'volume down': 25,
  power: 26,
  tab: 61,
  lock: 26
};

export function keyNameToKeycode(key: string): number {
  const code = KEYCODE_BY_NAME[key.toLowerCase()];
  if (code === undefined) {
    throw new Error(`Unsupported Maestro key: ${key}`);
  }
  return code;
}

export function orientationToSettings(orientation: string): string {
  if (orientation === 'LANDSCAPE') return '1';
  if (orientation === 'PORTRAIT') return '0';
  throw new Error(`Unsupported orientation: ${orientation}`);
}

function execAdb(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      { maxBuffer: 1024 * 1024 * 50, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) {
          const stderrText = stderr ? stderr.toString('utf8') : '';
          reject(new Error(`adb ${args.join(' ')} failed: ${err.message}${stderrText ? ' - ' + stderrText : ''}`));
          return;
        }
        resolve(stdout as unknown as Buffer);
      }
    );
  });
}

/**
 * Like execAdb but never rejects on a non-zero exit - it hands back stdout/stderr so the
 * caller can inspect them. `adb shell` reports the *adb* exit status, not the remote
 * command's, so remote failures have to be detected from the output itself.
 */
function execAdbRaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('adb', args, { maxBuffer: 1024 * 1024 * 50, encoding: 'buffer' }, (_err, stdout, stderr) => {
      resolve({
        stdout: stdout ? stdout.toString('utf8') : '',
        stderr: stderr ? stderr.toString('utf8') : ''
      });
    });
  });
}

export interface AdbDevice {
  id: string;
  state: string;
  isEmulator: boolean;
}

/** Lists devices/emulators adb currently knows about, including offline/unauthorized ones. */
export async function listDevices(): Promise<AdbDevice[]> {
  const out = await execAdb(['devices']);
  const lines = out.toString('utf8').split('\n').slice(1);
  const devices: AdbDevice[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [id, state] = trimmed.split(/\s+/);
    if (!id || !state) continue;
    devices.push({ id, state, isEmulator: id.startsWith('emulator-') });
  }
  return devices;
}

/** Captures a single PNG screenshot. exec-out avoids CRLF-mangling that `adb shell` can do over some transports. */
export async function screenshot(deviceId: string): Promise<Buffer> {
  return execAdb(['-s', deviceId, 'exec-out', 'screencap', '-p']);
}

export async function tap(deviceId: string, x: number, y: number): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

export async function swipe(
  deviceId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300
): Promise<void> {
  await execAdb([
    '-s',
    deviceId,
    'shell',
    'input',
    'swipe',
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    String(durationMs)
  ]);
}

export async function getScreenSize(deviceId: string): Promise<{ width: number; height: number }> {
  const out = await execAdb(['-s', deviceId, 'shell', 'wm', 'size']);
  const text = out.toString('utf8');
  // Prefer "Override size" if present (some devices report both physical and override).
  const overrideMatch = text.match(/Override size:\s*(\d+)x(\d+)/);
  const match = overrideMatch || text.match(/(\d+)x(\d+)/);
  if (!match) {
    throw new Error(`Could not parse screen size from adb output: ${text.trim()}`);
  }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
}

/**
 * /data/local/tmp is owned by the adb shell user, so it needs no storage permission and is
 * unaffected by scoped storage - unlike /sdcard, which is a symlink into managed storage.
 */
const REMOTE_DUMP_PATH = '/data/local/tmp/flow-recorder-dump.xml';

/** Automation drivers currently running, which hold UiAutomation and block `uiautomator dump`. */
export async function getRunningAutomationDrivers(deviceId: string): Promise<string[]> {
  try {
    const out = await execAdb(['-s', deviceId, 'shell', 'ps', '-A']);
    return parseAutomationDrivers(out.toString('utf8'));
  } catch {
    return [];
  }
}

/** Packages whose accessibility services are currently enabled, for diagnosing dump conflicts. */
export async function getEnabledAccessibilityServices(deviceId: string): Promise<string[]> {
  try {
    const out = await execAdb([
      '-s',
      deviceId,
      'shell',
      'settings',
      'get',
      'secure',
      'enabled_accessibility_services'
    ]);
    return parseAccessibilityServices(out.toString('utf8'));
  } catch {
    return [];
  }
}

/**
 * Dumps the current UI Automator accessibility-tree XML.
 *
 * Throws HierarchyUnavailableError - rather than returning unusable text - when the dump
 * fails. The legacy `uiautomator` command connects to UiAutomation without
 * FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES, so any enabled accessibility service holds the
 * single available slot and this process is SIGKILLed. That used to surface as an empty
 * element list, i.e. hover and outlines silently doing nothing.
 */
export async function dumpUiHierarchy(deviceId: string): Promise<string> {
  // Fold stderr into stdout and append the remote exit code: `adb shell` reports adb's own
  // status, so a SIGKILLed uiautomator is otherwise indistinguishable from success.
  const dump = await execAdbRaw([
    '-s',
    deviceId,
    'shell',
    `uiautomator dump ${REMOTE_DUMP_PATH} 2>&1; echo "__RC=$?"`
  ]);
  const dumpText = `${dump.stdout}${dump.stderr}`;
  const rcMatch = dumpText.match(/__RC=(\d+)/);
  const rc = rcMatch ? parseInt(rcMatch[1], 10) : 0;

  const dumpFailure = classifyDumpFailure(dumpText, rc);
  if (dumpFailure) {
    throw new HierarchyUnavailableError(
      dumpFailure,
      await getEnabledAccessibilityServices(deviceId),
      await getRunningAutomationDrivers(deviceId)
    );
  }

  // `adb exec-out cat` on a missing file writes its error to STDOUT and still exits 0,
  // so the payload must be validated rather than trusted.
  const out = await execAdb(['-s', deviceId, 'exec-out', 'cat', REMOTE_DUMP_PATH]);
  const xml = out.toString('utf8');
  if (!looksLikeHierarchyXml(xml)) {
    const reason = classifyDumpFailure(xml, 0) || 'unknown';
    throw new HierarchyUnavailableError(
      reason,
      await getEnabledAccessibilityServices(deviceId),
      await getRunningAutomationDrivers(deviceId)
    );
  }
  return xml;
}

export async function longPress(deviceId: string, x: number, y: number): Promise<void> {
  const rx = String(Math.round(x));
  const ry = String(Math.round(y));
  await execAdb(['-s', deviceId, 'shell', 'input', 'swipe', rx, ry, rx, ry, '600']);
}

export async function doubleTap(deviceId: string, x: number, y: number): Promise<void> {
  await tap(deviceId, x, y);
  await delay(100);
  await tap(deviceId, x, y);
}

export async function inputText(deviceId: string, text: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'text', escapeInputText(text)]);
}

export async function eraseText(deviceId: string, count: number): Promise<void> {
  const n = Math.min(Math.max(1, count), ERASE_MAX);
  for (let i = 0; i < n; i++) {
    await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '67']);
  }
}

export async function pressKey(deviceId: string, key: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', String(keyNameToKeycode(key))]);
}

export async function back(deviceId: string): Promise<void> {
  await pressKey(deviceId, 'back');
}

/**
 * Injects a raw Android keycode. Used by the device nav bar for keys that have no Maestro
 * name - notably APP_SWITCH (187), which drives Recents but is not a recordable command.
 */
export async function pressKeycode(deviceId: string, keycode: number): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', String(keycode)]);
}

export async function hideKeyboard(deviceId: string): Promise<void> {
  await pressKey(deviceId, 'back');
}

export async function pasteText(deviceId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '279']);
}

export async function launchApp(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
}

export async function stopApp(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'am', 'force-stop', appId]);
}

export async function killApp(deviceId: string, appId: string, shouldClearState: boolean): Promise<void> {
  await stopApp(deviceId, appId);
  if (shouldClearState) {
    await clearState(deviceId, appId);
  }
}

export async function clearState(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'pm', 'clear', appId]);
}

export async function setOrientation(deviceId: string, orientation: string): Promise<void> {
  const rotation = orientationToSettings(orientation);
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'system', 'user_rotation', rotation]);
}

export async function setClipboard(deviceId: string, text: string): Promise<void> {
  try {
    await execAdb(['-s', deviceId, 'shell', 'cmd', 'clipboard', 'set-text', text]);
  } catch {
    // Best-effort: not every device exposes a writable clipboard service.
  }
}

export async function setAirplaneMode(deviceId: string, enabled: boolean): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'global', 'airplane_mode_on', enabled ? '1' : '0']);
  await execAdb(['-s', deviceId, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE']);
}

export async function setDarkMode(deviceId: string, enabled: boolean): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'cmd', 'uimode', 'night', enabled ? 'yes' : 'no']);
}

export async function scroll(deviceId: string): Promise<void> {
  const size = await getScreenSize(deviceId);
  const x = Math.round(size.width / 2);
  const yFrom = Math.round(size.height * 0.8);
  const yTo = Math.round(size.height * 0.2);
  await execAdb(['-s', deviceId, 'shell', 'input', 'swipe', String(x), String(yFrom), String(x), String(yTo), '300']);
}
