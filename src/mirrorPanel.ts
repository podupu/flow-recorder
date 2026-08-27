import * as vscode from 'vscode';
import * as adb from './android/adb';
import {
  parseUiNodes,
  findSmallestNodeAtPoint,
  resolveElementSelector,
  filterSelectableNodes,
  SelectableUiNode
} from './android/uiautomator';
import { classifySwipeDirection } from './gestures';

interface FlowConfig {
  appId?: string;
}

function elementCenter(node: { bounds: { left: number; top: number; right: number; bottom: number } }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2)
  };
}

export class AndroidMirrorPanel {
  public static current: AndroidMirrorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pollTimer: NodeJS.Timeout | undefined;
  private elementTimer: NodeJS.Timeout | undefined;
  private screenSize: { width: number; height: number } | undefined;
  private selectableNodes: SelectableUiNode[] = [];
  private dumping = false;
  private optional = false;
  private darkMode = false;
  private disposed = false;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    deviceId: string,
    flowConfig: FlowConfig,
    appendStep: (step: any) => Promise<void>
  ): Promise<void> {
    if (AndroidMirrorPanel.current) {
      AndroidMirrorPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'flowRecorder.androidMirror',
      `Android mirror - ${deviceId}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const mirror = new AndroidMirrorPanel(context, panel, deviceId, flowConfig, appendStep);
    AndroidMirrorPanel.current = mirror;
    await mirror.init();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly deviceId: string,
    private readonly flowConfig: FlowConfig,
    private readonly appendStep: (step: any) => Promise<void>
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private async init(): Promise<void> {
    try {
      this.screenSize = await adb.getScreenSize(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not read device screen size: ${err.message}`);
    }
    this.startPolling();
    this.startElementPolling();
  }

  private startPolling(): void {
    const intervalMs = 700;
    const tick = async () => {
      if (this.disposed) return;
      try {
        const png = await adb.screenshot(this.deviceId);
        this.panel.webview.postMessage({ type: 'frame', data: png.toString('base64') });
      } catch {
        // Device briefly busy or reconnecting - keep polling.
      }
      if (!this.disposed) {
        this.pollTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private startElementPolling(): void {
    const intervalMs = 2500;
    const tick = async () => {
      if (this.disposed) return;
      await this.refreshElements();
      if (!this.disposed) {
        this.elementTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private async refreshElements(): Promise<void> {
    if (this.dumping || !this.screenSize) return;
    this.dumping = true;
    try {
      const xml = await adb.dumpUiHierarchy(this.deviceId);
      const nodes = parseUiNodes(xml);
      this.selectableNodes = filterSelectableNodes(nodes, this.screenSize);
      const screen = this.screenSize;
      const payload = this.selectableNodes.map((n) => {
        const c = elementCenter(n);
        return {
          elementId: n.elementId,
          text: n.text,
          resourceId: n.resourceId,
          contentDesc: n.contentDesc,
          left: n.bounds.left / screen.width,
          top: n.bounds.top / screen.height,
          width: (n.bounds.right - n.bounds.left) / screen.width,
          height: (n.bounds.bottom - n.bounds.top) / screen.height,
          selector: resolveElementSelector(n, c.x, c.y, screen)
        };
      });
      this.panel.webview.postMessage({ type: 'elements', nodes: payload });
    } catch {
      // Hierarchy dump can fail transiently; keep the previous overlay.
    } finally {
      this.dumping = false;
    }
  }

  private async emit(step: any): Promise<void> {
    if (this.optional) {
      const obj = typeof step === 'string' ? { [step]: null } : step;
      await this.appendStep({ ...obj, optional: true });
    } else {
      await this.appendStep(step);
    }
  }

  private nodeAt(elementId: number | undefined): SelectableUiNode | undefined {
    if (elementId === undefined) return undefined;
    return this.selectableNodes[elementId];
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'optional':
        this.optional = !!msg.value;
        break;
      case 'tap':
        await this.handleRawTap(msg.xPct, msg.yPct);
        break;
      case 'elementTap':
        await this.handleElementAction(msg.elementId, 'tapOn', 'tap');
        break;
      case 'longPress':
        await this.handlePointGesture(msg, 'longPressOn', 'longPress');
        break;
      case 'doubleTap':
        await this.handlePointGesture(msg, 'doubleTapOn', 'doubleTap');
        break;
      case 'swipe':
        await this.handleSwipe(msg);
        break;
      case 'inputText':
        await this.handleInputText(msg);
        break;
      case 'eraseText':
        await this.handleEraseText(msg.count);
        break;
      case 'pressKey':
        await this.handlePressKey(msg.key);
        break;
      case 'back':
        await this.handleBack();
        break;
      case 'hideKeyboard':
        await this.handleHideKeyboard();
        break;
      case 'launchApp':
        await this.handleLaunchApp(!!msg.clearState);
        break;
      case 'stopApp':
        await this.handleStopApp();
        break;
      case 'killApp':
        await this.handleKillApp(!!msg.clearState);
        break;
      case 'clearState':
        await this.handleClearState();
        break;
      case 'setOrientation':
        await this.handleSetOrientation(msg.orientation);
        break;
      case 'takeScreenshot':
        await this.handleTakeScreenshot(msg.name);
        break;
      case 'setClipboard':
        await this.handleSetClipboard(msg.text);
        break;
      case 'pasteText':
        await this.handlePasteText();
        break;
      case 'setAirplaneMode':
        await this.handleSetAirplaneMode(!!msg.enabled);
        break;
      case 'toggleAirplaneMode':
        await this.handleToggleAirplaneMode();
        break;
      case 'toggleDarkMode':
        await this.handleToggleDarkMode();
        break;
      case 'scroll':
        await this.handleScroll();
        break;
      case 'assertVisible':
        await this.handleAssert(msg.elementId, true);
        break;
      case 'assertNotVisible':
        await this.handleAssert(msg.elementId, false);
        break;
    }
  }

  private async handleRawTap(xPct: number, yPct: number): Promise<void> {
    if (!this.screenSize) return;
    const x = xPct * this.screenSize.width;
    const y = yPct * this.screenSize.height;
    try {
      await adb.tap(this.deviceId, x, y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send tap to device: ${err.message}`);
      return;
    }
    const node = findSmallestNodeAtPoint(this.selectableNodes, x, y);
    await this.emit({ tapOn: resolveElementSelector(node, x, y, this.screenSize) });
    void this.refreshElements();
  }

  private async handleElementAction(
    elementId: number,
    commandKey: string,
    action: 'tap' | 'longPress' | 'doubleTap'
  ): Promise<void> {
    if (!this.screenSize) return;
    const node = this.nodeAt(elementId);
    if (!node) {
      vscode.window.showWarningMessage('Element no longer present - refresh and try again.');
      return;
    }
    const c = elementCenter(node);
    try {
      if (action === 'tap') await adb.tap(this.deviceId, c.x, c.y);
      else if (action === 'longPress') await adb.longPress(this.deviceId, c.x, c.y);
      else await adb.doubleTap(this.deviceId, c.x, c.y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
      return;
    }
    await this.emit({ [commandKey]: resolveElementSelector(node, c.x, c.y, this.screenSize) });
    void this.refreshElements();
  }

  private async handlePointGesture(
    msg: any,
    commandKey: string,
    action: 'longPress' | 'doubleTap'
  ): Promise<void> {
    if (!this.screenSize) return;
    const node = this.nodeAt(msg.elementId);
    if (node) {
      const c = elementCenter(node);
      try {
        if (action === 'longPress') await adb.longPress(this.deviceId, c.x, c.y);
        else await adb.doubleTap(this.deviceId, c.x, c.y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: resolveElementSelector(node, c.x, c.y, this.screenSize) });
    } else {
      const x = msg.xPct * this.screenSize.width;
      const y = msg.yPct * this.screenSize.height;
      try {
        if (action === 'longPress') await adb.longPress(this.deviceId, x, y);
        else await adb.doubleTap(this.deviceId, x, y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: resolveElementSelector(undefined, x, y, this.screenSize) });
    }
    void this.refreshElements();
  }

  private async handleSwipe(msg: any): Promise<void> {
    if (!this.screenSize) return;
    const sx = msg.startXpct * this.screenSize.width;
    const sy = msg.startYpct * this.screenSize.height;
    const ex = msg.endXpct * this.screenSize.width;
    const ey = msg.endYpct * this.screenSize.height;
    try {
      await adb.swipe(this.deviceId, sx, sy, ex, ey);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send swipe to device: ${err.message}`);
      return;
    }
    const direction = classifySwipeDirection({ x: sx, y: sy }, { x: ex, y: ey });
    await this.emit({ swipe: { direction } });
    void this.refreshElements();
  }

  private async handleInputText(msg: any): Promise<void> {
    if (!msg.text || !this.screenSize) return;
    const node = this.nodeAt(msg.elementId);
    try {
      if (node) {
        const c = elementCenter(node);
        await adb.tap(this.deviceId, c.x, c.y);
        await this.emit({ tapOn: resolveElementSelector(node, c.x, c.y, this.screenSize) });
      }
      await adb.inputText(this.deviceId, msg.text);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to input text: ${err.message}`);
      return;
    }
    await this.emit({ inputText: msg.text });
    void this.refreshElements();
  }

  private async handleEraseText(count: number): Promise<void> {
    try {
      await adb.eraseText(this.deviceId, count);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to erase text: ${err.message}`);
      return;
    }
    await this.emit({ eraseText: count });
  }

  private async handlePressKey(key: string): Promise<void> {
    try {
      await adb.pressKey(this.deviceId, key);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to press key: ${err.message}`);
      return;
    }
    await this.emit({ pressKey: key });
  }

  private async handleBack(): Promise<void> {
    try {
      await adb.back(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to go back: ${err.message}`);
      return;
    }
    await this.emit('back');
  }

  private async handleHideKeyboard(): Promise<void> {
    try {
      await adb.hideKeyboard(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to hide keyboard: ${err.message}`);
      return;
    }
    await this.emit('hideKeyboard');
  }

  private appId(): string | undefined {
    return this.flowConfig.appId || undefined;
  }

  private async handleLaunchApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to launch the app.');
      return;
    }
    try {
      if (clearState) await adb.clearState(this.deviceId, appId);
      await adb.launchApp(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to launch app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { launchApp: { appId, clearState: true } } : { launchApp: { appId } });
    void this.refreshElements();
  }

  private async handleStopApp(): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.stopApp(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      return;
    }
    await this.emit('stopApp');
  }

  private async handleKillApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.killApp(this.deviceId, appId, clearState);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to kill app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { killApp: { clearState: true } } : 'killApp');
  }

  private async handleClearState(): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.clearState(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to clear state: ${err.message}`);
      return;
    }
    await this.emit('clearState');
  }

  private async handleSetOrientation(orientation: string): Promise<void> {
    try {
      await adb.setOrientation(this.deviceId, orientation);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set orientation: ${err.message}`);
      return;
    }
    await this.emit({ setOrientation: orientation });
  }

  private async handleTakeScreenshot(name: string): Promise<void> {
    const clean = (name || 'step').trim().replace(/\.png$/, '');
    const fileName = `${clean}.png`;
    try {
      const png = await adb.screenshot(this.deviceId);
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const dir = vscode.Uri.joinPath(folder.uri, 'assets');
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, fileName), png);
      }
    } catch (err: any) {
      vscode.window.showWarningMessage(`Could not save screenshot (${err.message}) - step still recorded.`);
    }
    await this.emit({ takeScreenshot: `assets/${fileName}` });
  }

  private async handleSetClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
      await adb.setClipboard(this.deviceId, text);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set clipboard: ${err.message}`);
      return;
    }
    await this.emit({ setClipboard: text });
  }

  private async handlePasteText(): Promise<void> {
    try {
      await adb.pasteText(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste text: ${err.message}`);
      return;
    }
    await this.emit('pasteText');
  }

  private async handleSetAirplaneMode(enabled: boolean): Promise<void> {
    try {
      await adb.setAirplaneMode(this.deviceId, enabled);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set airplane mode: ${err.message}`);
      return;
    }
    await this.emit({ setAirplaneMode: enabled });
  }

  private async handleToggleAirplaneMode(): Promise<void> {
    await this.emit('toggleAirplaneMode');
  }

  private async handleToggleDarkMode(): Promise<void> {
    this.darkMode = !this.darkMode;
    try {
      await adb.setDarkMode(this.deviceId, this.darkMode);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to toggle dark mode: ${err.message}`);
      return;
    }
    await this.emit('toggleDarkMode');
  }

  private async handleScroll(): Promise<void> {
    try {
      await adb.scroll(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to scroll: ${err.message}`);
      return;
    }
    await this.emit('scroll');
    void this.refreshElements();
  }

  private async handleAssert(elementId: number, visible: boolean): Promise<void> {
    const node = this.nodeAt(elementId);
    if (!node || !this.screenSize) {
      vscode.window.showWarningMessage('Hover an element to assert it.');
      return;
    }
    const c = elementCenter(node);
    const selector = resolveElementSelector(node, c.x, c.y, this.screenSize);
    await this.emit(visible ? { assertVisible: selector } : { assertNotVisible: selector });
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mirror.js')
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mirror.css')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="status">Connecting to device...</div>
  <div id="mirror-toolbar">
    <div class="row">
      <button data-action="tap">Tap</button>
      <button data-action="longPress">Long press</button>
      <button data-action="doubleTap">Double tap</button>
      <button data-action="assertVisible">Assert visible</button>
      <button data-action="assertNotVisible">Assert not visible</button>
    </div>
    <div class="row">
      <input id="inputText" type="text" placeholder="Text to type..." />
      <button id="doInput">Input</button>
      <input id="eraseCount" type="number" value="50" min="1" max="100" />
      <button id="doErase">Erase</button>
      <button data-action="pressKey" data-key="back">Back</button>
      <button data-action="pressKey" data-key="home">Home</button>
      <button data-action="pressKey" data-key="enter">Enter</button>
      <button data-action="hideKeyboard">Hide KB</button>
    </div>
    <div class="row">
      <button data-action="setOrientation" data-orientation="LANDSCAPE">Landscape</button>
      <button data-action="setOrientation" data-orientation="PORTRAIT">Portrait</button>
      <button data-action="scroll">Scroll</button>
      <button data-action="pasteText">Paste</button>
      <label class="opt"><input id="optional" type="checkbox" /> optional</label>
    </div>
    <div class="row">
      <label class="opt">Clear state <input id="launchClear" type="checkbox" /></label>
      <button data-action="launchApp">Launch app</button>
      <button data-action="stopApp">Stop</button>
      <button data-action="killApp">Kill</button>
      <button data-action="clearState">Clear state</button>
      <button data-action="toggleDarkMode">Dark mode</button>
      <button data-action="toggleAirplaneMode">Airplane</button>
    </div>
    <div class="row">
      <input id="screenshotName" type="text" placeholder="screenshot-name" />
      <button id="doScreenshot">Screenshot</button>
    </div>
  </div>
  <div id="stage">
    <canvas id="screen"></canvas>
    <div id="overlay"></div>
    <div id="tooltip"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.elementTimer) clearTimeout(this.elementTimer);
    AndroidMirrorPanel.current = undefined;
  }
}
