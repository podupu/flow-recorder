import * as adb from './adb';
import { parseUiNodes, resolveElementSelector, isSelectable } from './uiautomator';
import {
  DeviceDriver,
  DeviceElement,
  DevicePlatform,
  DeviceRect,
  DeviceSize
} from '../deviceDriver';

/**
 * Android via adb. Behaviour is unchanged from before the driver interface existed - this
 * only moves the calls behind a boundary so iOS can sit alongside.
 *
 * Android works entirely in device pixels: `uiautomator dump` bounds and `input tap`
 * coordinates share one space, so the only conversion here is pixels -> 0-1 fractions.
 */
export class AndroidDriver implements DeviceDriver {
  public readonly platform: DevicePlatform = 'Android';
  private size: DeviceSize | undefined;
  private lastRawSize: DeviceSize | undefined;

  constructor(public readonly deviceId: string) {}

  public async screenSize(): Promise<DeviceSize> {
    if (!this.size) this.size = await adb.getScreenSize(this.deviceId);
    return this.size;
  }

  public screenshot(): Promise<Buffer> {
    return adb.screenshot(this.deviceId);
  }

  public async elements(): Promise<DeviceElement[]> {
    const screen = await this.screenSize();
    this.lastRawSize = screen;
    const xml = await adb.dumpUiHierarchy(this.deviceId);
    const nodes = parseUiNodes(xml);

    return nodes.map((n, i) => {
      const centre = {
        x: Math.round((n.bounds.left + n.bounds.right) / 2),
        y: Math.round((n.bounds.top + n.bounds.bottom) / 2)
      };
      return {
        elementId: i,
        text: n.text,
        resourceId: n.resourceId,
        contentDesc: n.contentDesc,
        className: n.className,
        left: n.bounds.left / screen.width,
        top: n.bounds.top / screen.height,
        width: (n.bounds.right - n.bounds.left) / screen.width,
        height: (n.bounds.bottom - n.bounds.top) / screen.height,
        selector: resolveElementSelector(n, centre.x, centre.y, screen),
        parentId: n.parentId !== undefined ? n.parentId : -1,
        selectable: isSelectable(n, screen)
      };
    });
  }

  public async keyboardRegion(): Promise<DeviceRect | null> {
    const screen = this.lastRawSize || (await this.screenSize());
    const ime = await adb.getImeState(this.deviceId);
    const r = ime.region;
    if (!ime.showing || !r) return null;
    return {
      left: r.left / screen.width,
      top: r.top / screen.height,
      width: (r.right - r.left) / screen.width,
      height: (r.bottom - r.top) / screen.height
    };
  }

  public tap(x: number, y: number): Promise<void> {
    return adb.tap(this.deviceId, x, y);
  }

  public longPress(x: number, y: number): Promise<void> {
    return adb.longPress(this.deviceId, x, y);
  }

  public doubleTap(x: number, y: number): Promise<void> {
    return adb.doubleTap(this.deviceId, x, y);
  }

  public swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300): Promise<void> {
    return adb.swipe(this.deviceId, x1, y1, x2, y2, durationMs);
  }

  public scroll(): Promise<void> {
    return adb.scroll(this.deviceId);
  }

  public inputText(text: string): Promise<void> {
    return adb.inputText(this.deviceId, text);
  }

  public eraseText(count: number): Promise<void> {
    return adb.eraseText(this.deviceId, count);
  }

  public pressKey(key: string): Promise<void> {
    return adb.pressKey(this.deviceId, key);
  }

  public pressKeycode(keycode: number): Promise<void> {
    return adb.pressKeycode(this.deviceId, keycode);
  }

  public back(): Promise<void> {
    return adb.back(this.deviceId);
  }

  public hideKeyboard(): Promise<void> {
    return adb.hideKeyboard(this.deviceId);
  }

  public launchApp(appId: string): Promise<void> {
    return adb.launchApp(this.deviceId, appId);
  }

  public stopApp(appId: string): Promise<void> {
    return adb.stopApp(this.deviceId, appId);
  }

  public killApp(appId: string, clearState: boolean): Promise<void> {
    return adb.killApp(this.deviceId, appId, clearState);
  }

  public clearState(appId: string): Promise<void> {
    return adb.clearState(this.deviceId, appId);
  }

  public setOrientation(orientation: string): Promise<void> {
    return adb.setOrientation(this.deviceId, orientation);
  }

  public setClipboard(text: string): Promise<void> {
    return adb.setClipboard(this.deviceId, text);
  }

  public pasteText(): Promise<void> {
    return adb.pasteText(this.deviceId);
  }

  public setAirplaneMode(enabled: boolean): Promise<void> {
    return adb.setAirplaneMode(this.deviceId, enabled);
  }

  public setDarkMode(enabled: boolean): Promise<void> {
    return adb.setDarkMode(this.deviceId, enabled);
  }
}
