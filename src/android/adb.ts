import { execFile } from 'child_process';

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

/** Dumps the current UI Automator accessibility-tree XML and returns it as a string. */
export async function dumpUiHierarchy(deviceId: string): Promise<string> {
  const remotePath = '/sdcard/flow-recorder-dump.xml';
  await execAdb(['-s', deviceId, 'shell', 'uiautomator', 'dump', remotePath]);
  const out = await execAdb(['-s', deviceId, 'exec-out', 'cat', remotePath]);
  return out.toString('utf8');
}
