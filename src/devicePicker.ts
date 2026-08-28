import * as vscode from 'vscode';
import * as adb from './android/adb';
import * as idb from './ios/idb';
import { AndroidDriver } from './android/androidDriver';
import { IosDriver } from './ios/iosDriver';
import { DeviceDriver } from './deviceDriver';

interface DeviceChoice extends vscode.QuickPickItem {
  make?: () => Promise<DeviceDriver>;
}

/**
 * Offers every mirrorable target - connected Android devices and iOS Simulators - and returns
 * a driver for the chosen one.
 *
 * A shut-down simulator is still offered and booted on demand, because "no devices found" when
 * a simulator merely is not running is a confusing dead end.
 */
export async function pickDevice(): Promise<DeviceDriver | undefined> {
  const items: DeviceChoice[] = [];
  const problems: string[] = [];

  // --- Android ---
  try {
    const online = (await adb.listDevices()).filter((d) => d.state === 'device');
    if (online.length) {
      items.push({ label: 'Android', kind: vscode.QuickPickItemKind.Separator });
      for (const d of online) {
        items.push({
          label: `$(device-mobile) ${d.id}`,
          description: d.isEmulator ? 'emulator' : 'device',
          make: async () => new AndroidDriver(d.id)
        });
      }
    }
  } catch (err: any) {
    problems.push(`adb unavailable (${err.message})`);
  }

  // --- iOS Simulators ---
  try {
    const sims = await idb.listSimulators();
    const booted = sims.filter((s) => s.booted);
    const shutdown = sims.filter((s) => !s.booted);

    if (booted.length || shutdown.length) {
      items.push({ label: 'iOS Simulators', kind: vscode.QuickPickItemKind.Separator });
    }
    for (const s of booted) {
      items.push({
        label: `$(device-mobile) ${s.name}`,
        description: `${s.runtime} · booted`,
        make: async () => new IosDriver(s.udid)
      });
    }
    // Only the most recent runtime's shut-down simulators, to keep the list usable - there
    // are typically well over a hundred across every installed runtime.
    const newestRuntime = shutdown.length ? shutdown[shutdown.length - 1].runtime : undefined;
    for (const s of shutdown.filter((s) => s.runtime === newestRuntime).slice(0, 12)) {
      items.push({
        label: `$(debug-start) ${s.name}`,
        description: `${s.runtime} · will boot`,
        make: async () => {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Booting ${s.name}...` },
            () => idb.bootSimulator(s.udid)
          );
          return new IosDriver(s.udid);
        }
      });
    }
  } catch (err: any) {
    problems.push(`simctl unavailable (${err.message})`);
  }

  const selectable = items.filter((i) => i.make);
  if (!selectable.length) {
    vscode.window.showErrorMessage(
      `No mirrorable devices found. Start an Android emulator or an iOS Simulator, then try again.${
        problems.length ? ` (${problems.join('; ')})` : ''
      }`
    );
    return undefined;
  }

  const picked =
    selectable.length === 1 && items.length <= 2
      ? selectable[0]
      : await vscode.window.showQuickPick(items, { placeHolder: 'Select a device to mirror' });

  if (!picked || !picked.make) return undefined;

  const driver = await picked.make();

  // iOS element detection and input both require idb; screenshots alone would be a
  // view-only mirror, so say so rather than letting taps silently fail.
  if (driver.platform === 'iOS' && !(await idb.isIdbAvailable())) {
    vscode.window.showErrorMessage(idb.IDB_INSTALL_HINT);
    return undefined;
  }

  return driver;
}
