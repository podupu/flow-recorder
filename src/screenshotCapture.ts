import * as vscode from 'vscode';
import * as adb from './android/adb';
import { DeviceDriver } from './deviceDriver';
import { AndroidDriver } from './android/androidDriver';
import { ASSETS_DIR, uniqueScreenshotName } from './screenshots';

/**
 * Captures the device screen and writes it to `assets/` **beside the flow file**, returning the
 * path to record. Maestro resolves `takeScreenshot:` relative to the flow, so saving at the
 * workspace root (as the mirror used to) produced a path that pointed nowhere.
 */
export async function saveScreenshotBesideFlow(
  flowUri: vscode.Uri,
  driver: DeviceDriver,
  name: string
): Promise<string> {
  const dir = vscode.Uri.joinPath(flowUri, '..', ASSETS_DIR);

  let existing: string[] = [];
  try {
    existing = (await vscode.workspace.fs.readDirectory(dir)).map(([entry]) => entry);
  } catch {
    // assets/ does not exist yet - createDirectory below makes it.
  }

  const fileName = uniqueScreenshotName(name, existing);
  const png = await driver.screenshot();
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, fileName), png);
  return `${ASSETS_DIR}/${fileName}`;
}

/**
 * Resolves which device to capture from. `preferred` is the device an open mirror is already
 * attached to, so the common case needs no prompt.
 */
/**
 * The driver to capture from: the one an open mirror is already attached to, otherwise an
 * Android device chosen here. Returning a driver rather than an id keeps capture working on
 * whichever platform the mirror is showing.
 */
export async function resolveCaptureDevice(preferred?: DeviceDriver): Promise<DeviceDriver | undefined> {
  if (preferred) return preferred;

  let devices: adb.AdbDevice[];
  try {
    devices = await adb.listDevices();
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Could not run adb. Is Android platform-tools installed and on your PATH? (${err.message})`
    );
    return undefined;
  }

  const online = devices.filter((d) => d.state === 'device');
  if (online.length === 0) {
    vscode.window.showErrorMessage('No connected Android devices or emulators found.');
    return undefined;
  }
  if (online.length === 1) return new AndroidDriver(online[0].id);

  const picked = await vscode.window.showQuickPick(
    online.map((d) => ({ label: d.id, description: d.isEmulator ? 'emulator' : 'device' })),
    { placeHolder: 'Capture a screenshot from which device?' }
  );
  return picked ? new AndroidDriver(picked.label) : undefined;
}
