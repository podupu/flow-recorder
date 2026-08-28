import * as vscode from 'vscode';
import * as adb from './android/adb';
import * as idb from './ios/idb';
import { AndroidDriver } from './android/androidDriver';
import { IosDriver } from './ios/iosDriver';
import { DeviceDriver } from './deviceDriver';
import { sortSimulators } from './deviceSort';

interface DeviceChoice extends vscode.QuickPickItem {
  make?: () => Promise<DeviceDriver | undefined>;
}

/** Waits for a freshly booted Android emulator to appear and finish booting. */
async function waitForAndroidDevice(timeoutMs = 180000): Promise<string | undefined> {
  const known = new Set((await adb.listDevices()).map((d) => d.id));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const devices = await adb.listDevices();
    const fresh = devices.find((d) => d.state === 'device' && !known.has(d.id));
    if (fresh) return fresh.id;
    // An emulator that was already listed can also transition offline -> device.
    const ready = devices.find((d) => d.state === 'device' && d.isEmulator);
    if (ready && known.size === 0) return ready.id;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return undefined;
}

/**
 * Offers every mirrorable target: connected Android devices, installed Android emulators, and
 * iOS Simulators.
 *
 * Ordering is deliberate. Running devices come first, then the newest OS version - `simctl`
 * returns runtimes in arbitrary order, so anything relying on the list's own order shows a
 * random OS version. Stopped emulators and simulators are offered too and booted on demand,
 * because "no devices found" merely because nothing is running is a dead end.
 */
export async function pickDevice(): Promise<DeviceDriver | undefined> {
  const items: DeviceChoice[] = [];
  const problems: string[] = [];

  // --- Android ---
  try {
    const online = (await adb.listDevices()).filter((d) => d.state === 'device');
    const runningAvds = new Set(online.filter((d) => d.isEmulator).map((d) => d.id));
    const avds = await adb.listAvds();

    if (online.length || avds.length) {
      items.push({ label: 'Android', kind: vscode.QuickPickItemKind.Separator });
    }
    for (const d of online) {
      items.push({
        label: `$(device-mobile) ${d.id}`,
        description: d.isEmulator ? 'emulator · running' : 'device · connected',
        make: async () => new AndroidDriver(d.id)
      });
    }
    // An AVD whose emulator is already up is covered by the entries above.
    for (const avd of avds) {
      if (runningAvds.size && online.some((d) => d.isEmulator)) break;
      items.push({
        label: `$(debug-start) ${avd}`,
        description: 'emulator · will boot',
        make: async () => {
          adb.bootAvd(avd);
          const id = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Booting ${avd}...` },
            () => waitForAndroidDevice()
          );
          if (!id) {
            vscode.window.showErrorMessage(`${avd} did not finish booting in time.`);
            return undefined;
          }
          return new AndroidDriver(id);
        }
      });
    }
  } catch (err: any) {
    problems.push(`adb unavailable (${err.message})`);
  }

  // --- iOS Simulators ---
  try {
    const sims = sortSimulators(await idb.listSimulators());
    let lastRuntime: string | undefined;
    let bootedHeaderShown = false;

    for (const s of sims) {
      if (s.booted) {
        // Booted simulators get their own section. Grouping them by runtime instead would
        // print that version's header twice - once here, once for its stopped simulators.
        if (!bootedHeaderShown) {
          items.push({ label: 'iOS Simulators · running', kind: vscode.QuickPickItemKind.Separator });
          bootedHeaderShown = true;
        }
      } else if (s.runtime !== lastRuntime) {
        // Then a section per OS version, newest first, so the list stays scannable.
        items.push({
          label: `iOS Simulators · ${s.runtime}`,
          kind: vscode.QuickPickItemKind.Separator
        });
        lastRuntime = s.runtime;
      }
      items.push({
        label: `${s.booted ? '$(device-mobile)' : '$(debug-start)'} ${s.name}`,
        description: s.booted ? `${s.runtime} · booted` : 'will boot',
        make: async () => {
          if (!s.booted) {
            await vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `Booting ${s.name}...` },
              () => idb.bootSimulator(s.udid)
            );
          }
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

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a device to mirror',
    matchOnDescription: true
  });
  if (!picked || !picked.make) return undefined;

  const driver = await picked.make();
  if (!driver) return undefined;

  // iOS element detection and input both require idb; screenshots alone would be a
  // view-only mirror, so say so rather than letting taps silently fail.
  if (driver.platform === 'iOS' && !(await idb.isIdbAvailable())) {
    vscode.window.showErrorMessage(idb.IDB_INSTALL_HINT);
    return undefined;
  }

  return driver;
}
