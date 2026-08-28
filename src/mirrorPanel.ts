import * as vscode from 'vscode';
import { isFlowDocument } from './flowContext';
import { DeviceDriver, DeviceElement, UnsupportedOperationError } from './deviceDriver';

import { classifySwipeDirection } from './gestures';
import { navButtonsFor, navActionSpecFor } from './deviceNav';
import { saveScreenshotBesideFlow } from './screenshotCapture';
import { appendFlowStep, parseFlowDocument } from './flowDocument';

/** Fallback selector when a point resolves to no labelled element. */
function pointSelector(x: number, y: number, screen: { width: number; height: number }) {
  return { point: `${Math.round((x / screen.width) * 100)}%,${Math.round((y / screen.height) * 100)}%` };
}


/** Centre of a normalised element, in the driver's own coordinate space. */
function elementCenter(
  element: DeviceElement,
  screen: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: Math.round((element.left + element.width / 2) * screen.width),
    y: Math.round((element.top + element.height / 2) * screen.height)
  };
}

/** Smallest element containing the point - the same rule the webview hover uses. */
function elementAtPoint(
  elements: DeviceElement[],
  xPct: number,
  yPct: number
): DeviceElement | undefined {
  let best: DeviceElement | undefined;
  for (const e of elements) {
    if (xPct < e.left || xPct > e.left + e.width) continue;
    if (yPct < e.top || yPct > e.top + e.height) continue;
    if (!best || e.width * e.height < best.width * best.height) best = e;
  }
  return best;
}

export class MirrorPanel {
  public static current: MirrorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pollTimer: NodeJS.Timeout | undefined;
  private elementTimer: NodeJS.Timeout | undefined;
  private screenSize: { width: number; height: number } | undefined;
  private allElements: DeviceElement[] = [];
  private dumping = false;
  /** Last reported hierarchy problem, so the 2.5s poll does not spam notifications. */
  private hierarchyProblem: string | undefined;
  private keyboardShowing = false;
  private activeEditorSub: vscode.Disposable | undefined;
  private optional = false;
  private darkMode = false;
  private disposed = false;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    driver: DeviceDriver,
    flowUri: vscode.Uri
  ): Promise<void> {
    if (MirrorPanel.current) {
      MirrorPanel.current.setTarget(flowUri);
      MirrorPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'flowRecorder.deviceMirror',
      `${driver.platform} mirror - ${driver.deviceId}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const mirror = new MirrorPanel(context, panel, driver, flowUri);
    MirrorPanel.current = mirror;
    await mirror.init();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    public readonly driver: DeviceDriver,
    private flowUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());

    // Follow whichever flow the user is editing. A non-flow editor (or the mirror itself
    // taking focus) leaves the target alone rather than dropping recorded steps.
    this.activeEditorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isFlowDocument(editor.document)) {
        this.setTarget(editor.document.uri);
      }
    });
    this.panel.webview.onDidReceiveMessage((msg) => {
      this.handleMessage(msg).catch((err) => {
        // A capability the platform genuinely lacks is not a bug - say so plainly.
        if (err instanceof UnsupportedOperationError) {
          vscode.window.showInformationMessage(err.message);
          return;
        }
        vscode.window.showErrorMessage('Command failed: ' + err.message);
      });
    });
  }

  /** Brings an existing mirror back into view without re-resolving the flow it records into. */
  public reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private async init(): Promise<void> {
    try {
      this.screenSize = await this.driver.screenSize();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not read device screen size: ${err.message}`);
    }
    this.postTarget();
    this.startPolling();
    this.startElementPolling();
  }

  private startPolling(): void {
    const intervalMs = 700;
    const tick = async () => {
      if (this.disposed) return;
      await this.pushFrame();
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

  /** Captures one frame and pushes it to the webview. Used by the poll and by Reload. */
  private async pushFrame(): Promise<void> {
    try {
      const png = await this.driver.screenshot();
      this.panel.webview.postMessage({ type: 'frame', data: png.toString('base64') });
    } catch {
      // Device briefly busy or reconnecting - the next poll tick catches up.
    }
  }

  /**
   * @param force Reload must produce a genuinely new dump. A poll tick may already be in
   * flight, and simply returning (as the poll path does) would make the button do nothing;
   * a forced refresh waits that dump out and then takes a fresh one.
   */
  private async refreshElements(force = false): Promise<void> {
    if (!this.screenSize) return;
    if (this.dumping) {
      if (!force) return;
      await this.waitForDumpToSettle();
      if (this.disposed || !this.screenSize) return;
    }
    this.dumping = true;
    try {
      // Drivers hand back elements already normalised to 0-1 with selectors resolved, so
      // the panel stays free of any platform-specific hierarchy shape.
      this.allElements = await this.driver.elements();
      const keyboard = await this.driver.keyboardRegion();
      this.keyboardShowing = !!keyboard;
      this.panel.webview.postMessage({
        type: 'elements',
        nodes: this.allElements,
        keyboard
      });
      // Recovered - clear any standing problem banner and re-arm the one-shot notification.
      if (this.hierarchyProblem) {
        this.hierarchyProblem = undefined;
        this.panel.webview.postMessage({ type: 'hierarchyOk' });
      }
    } catch (err: any) {
      this.reportHierarchyFailure(err);
    } finally {
      this.dumping = false;
    }
  }

  /**
   * Resolves once any in-flight hierarchy dump has finished, or after `timeoutMs` so a wedged
   * adb call cannot leave Reload waiting forever.
   */
  private waitForDumpToSettle(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const check = () => {
        if (!this.dumping || this.disposed || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  /**
   * Surfaces a hierarchy failure instead of swallowing it. The element poll runs every 2.5s,
   * so the VS Code notification fires only when the message changes - the webview banner is
   * what stays visible while the problem persists.
   */
  private reportHierarchyFailure(err: any): void {
    const message: string = err?.message || 'Element hierarchy could not be read.';
    this.panel.webview.postMessage({ type: 'hierarchyError', text: message });
    if (this.hierarchyProblem === message) return;
    this.hierarchyProblem = message;
    vscode.window.showWarningMessage(message);
  }

  private async emit(step: any): Promise<void> {
    if (this.optional) {
      const obj = typeof step === 'string' ? { [step]: null } : step;
      await this.writeStep({ ...obj, optional: true });
    } else {
      await this.writeStep(step);
    }
  }

  /**
   * Resolves the target document at write time. The panel used to hold an `appendStep` closure
   * bound to whichever document was active when it started, so opening a second flow kept
   * recording into the first one - silently, and with no way to tell from the UI.
   */
  private async writeStep(step: any): Promise<void> {
    const document = await vscode.workspace.openTextDocument(this.flowUri);
    await appendFlowStep(document, step);
  }

  /** Repoints the mirror at another flow and tells the webview, so the target is never a guess. */
  public setTarget(flowUri: vscode.Uri): void {
    if (this.flowUri.toString() === flowUri.toString()) return;
    this.flowUri = flowUri;
    this.postTarget();
  }

  private postTarget(): void {
    this.panel.webview.postMessage({
      type: 'target',
      path: vscode.workspace.asRelativePath(this.flowUri)
    });
  }

  private nodeAt(elementId: number | undefined): DeviceElement | undefined {
    if (elementId === undefined) return undefined;
    return this.allElements[elementId];
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
      case 'nav':
        await this.handleNav(msg.action);
        break;
      case 'keyboardTap':
        await this.handleKeyboardTap(msg.xPct, msg.yPct);
        break;
    }
  }

  /**
   * Device nav-bar buttons. Back and Home map onto real Maestro commands and are recorded;
   * Recents drives the device only (Maestro has no app-switch command) and Reload just
   * re-polls the mirror. See src/deviceNav.ts for that policy.
   */
  private async handleNav(action: string): Promise<void> {
    let spec;
    try {
      spec = navActionSpecFor(action, this.driver.platform);
    } catch {
      return;
    }

    try {
      // Delivery differs per platform; the recorded step does not.
      if (spec.keycode !== null) {
        await this.driver.pressKeycode(spec.keycode);
      } else if (spec.gesture === 'edgeSwipeBack') {
        await this.driver.back();
      } else if (spec.gesture === 'doubleHome') {
        await this.driver.pressKey('home');
        await this.driver.pressKey('home');
      } else if (spec.button === 'HOME') {
        await this.driver.pressKey('home');
      } else if (spec.button === 'LOCK') {
        await this.driver.pressKey('lock');
      }
    } catch (err: any) {
      if (err instanceof UnsupportedOperationError) {
        vscode.window.showInformationMessage(err.message);
        return;
      }
      vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
      return;
    }

    if (spec.step !== null) {
      await this.emit(spec.step);
    }

    // Every nav action changes what is on screen, so refresh the frame and hierarchy now
    // instead of waiting out the poll interval. Reload forces a genuinely new dump and
    // reports the result, so the button visibly does something.
    const isReload = action === 'reload';
    if (isReload) {
      this.panel.webview.postMessage({ type: 'status', text: 'Refreshing screen and elements...' });
    }
    await this.pushFrame();
    await this.refreshElements(isReload);
    if (isReload && !this.hierarchyProblem) {
      this.panel.webview.postMessage({
        type: 'status',
        text: `Refreshed - ${this.allElements.length} elements${this.keyboardShowing ? ' (keyboard open)' : ''}`
      });
    }
  }

  /**
   * A tap on the soft keyboard. It is sent to the device so typing works in the mirror, but
   * nothing is recorded: the IME is not in the hierarchy, so the only honest step would be a
   * raw coordinate that breaks on any layout or language change. Maestro represents typing
   * with inputText, which the context menu offers.
   */
  private async handleKeyboardTap(xPct: number, yPct: number): Promise<void> {
    if (!this.screenSize) return;
    try {
      await this.driver.tap(xPct * this.screenSize.width, yPct * this.screenSize.height);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send tap to device: ${err.message}`);
      return;
    }
    this.panel.webview.postMessage({
      type: 'status',
      text: 'Keyboard tap sent (not recorded) - use right-click > Input text to record typing.'
    });
    void this.pushFrame();
  }

  private async handleRawTap(xPct: number, yPct: number): Promise<void> {
    if (!this.screenSize) return;
    const x = xPct * this.screenSize.width;
    const y = yPct * this.screenSize.height;
    try {
      await this.driver.tap(x, y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send tap to device: ${err.message}`);
      return;
    }
    const node = elementAtPoint(this.allElements, xPct, yPct);
    await this.emit({ tapOn: (node ? node.selector : pointSelector(x, y, this.screenSize)) });
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
    const c = elementCenter(node, this.screenSize);
    try {
      if (action === 'tap') await this.driver.tap(c.x, c.y);
      else if (action === 'longPress') await this.driver.longPress(c.x, c.y);
      else await this.driver.doubleTap(c.x, c.y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
      return;
    }
    await this.emit({ [commandKey]: node.selector });
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
      const c = elementCenter(node, this.screenSize);
      try {
        if (action === 'longPress') await this.driver.longPress(c.x, c.y);
        else await this.driver.doubleTap(c.x, c.y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: node.selector });
    } else {
      if (!Number.isFinite(msg.xPct) || !Number.isFinite(msg.yPct)) {
        vscode.window.showWarningMessage('Hover an element, or press on the screen, to long-press or double-tap.');
        return;
      }
      const x = msg.xPct * this.screenSize.width;
      const y = msg.yPct * this.screenSize.height;
      try {
        if (action === 'longPress') await this.driver.longPress(x, y);
        else await this.driver.doubleTap(x, y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: pointSelector(x, y, this.screenSize) });
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
      await this.driver.swipe(sx, sy, ex, ey);
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
        const c = elementCenter(node, this.screenSize);
        await this.driver.tap(c.x, c.y);
        await this.emit({ tapOn: node.selector });
      }
      await this.driver.inputText(msg.text);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to input text: ${err.message}`);
      return;
    }
    await this.emit({ inputText: msg.text });
    void this.refreshElements();
  }

  private async handleEraseText(count: number): Promise<void> {
    try {
      await this.driver.eraseText(count);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to erase text: ${err.message}`);
      return;
    }
    await this.emit({ eraseText: count });
  }

  private async handlePressKey(key: string): Promise<void> {
    try {
      await this.driver.pressKey(key);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to press key: ${err.message}`);
      return;
    }
    await this.emit({ pressKey: key });
  }

  private async handleBack(): Promise<void> {
    try {
      await this.driver.back();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to go back: ${err.message}`);
      return;
    }
    await this.emit('back');
  }

  private async handleHideKeyboard(): Promise<void> {
    try {
      await this.driver.hideKeyboard();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to hide keyboard: ${err.message}`);
      return;
    }
    await this.emit('hideKeyboard');
  }

  private get currentAppId(): string | undefined {
    try {
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === this.flowUri.toString()
      );
      return doc ? parseFlowDocument(doc).config?.appId : undefined;
    } catch {
      return undefined;
    }
  }

  private appId(): string | undefined {
    return this.currentAppId;
  }

  private async handleLaunchApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to launch the app.');
      return;
    }
    try {
      if (clearState) await this.driver.clearState(appId);
      await this.driver.launchApp(appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to launch app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { launchApp: { appId, clearState: true } } : { launchApp: { appId } });
    void this.refreshElements();
  }

  private async handleStopApp(): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to use this command.');
      return;
    }
    try {
      await this.driver.stopApp(appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      return;
    }
    await this.emit('stopApp');
  }

  private async handleKillApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to use this command.');
      return;
    }
    try {
      await this.driver.killApp(appId, clearState);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to kill app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { killApp: { clearState: true } } : 'killApp');
  }

  private async handleClearState(): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to use this command.');
      return;
    }
    try {
      await this.driver.clearState(appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to clear state: ${err.message}`);
      return;
    }
    await this.emit('clearState');
  }

  private async handleSetOrientation(orientation: string): Promise<void> {
    try {
      await this.driver.setOrientation(orientation);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set orientation: ${err.message}`);
      return;
    }
    await this.emit({ setOrientation: orientation });
  }

  private async handleTakeScreenshot(name: string): Promise<void> {
    // Saved beside the flow, not at the workspace root: Maestro resolves takeScreenshot
    // relative to the flow file, so a workspace-root path pointed at nothing.
    try {
      const rel = await saveScreenshotBesideFlow(this.flowUri, this.driver, name || 'step');
      await this.emit({ takeScreenshot: rel });
      this.panel.webview.postMessage({ type: 'status', text: `Saved ${rel}` });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not capture screenshot: ${err.message}`);
    }
  }

  private async handleSetClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
      await this.driver.setClipboard(text);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set clipboard: ${err.message}`);
      return;
    }
    await this.emit({ setClipboard: text });
  }

  private async handlePasteText(): Promise<void> {
    try {
      await this.driver.pasteText();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste text: ${err.message}`);
      return;
    }
    await this.emit('pasteText');
  }

  private async handleSetAirplaneMode(enabled: boolean): Promise<void> {
    try {
      await this.driver.setAirplaneMode(enabled);
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
    const next = !this.darkMode;
    try {
      await this.driver.setDarkMode(next);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to toggle dark mode: ${err.message}`);
      return;
    }
    this.darkMode = next;
    await this.emit('toggleDarkMode');
  }

  private async handleScroll(): Promise<void> {
    try {
      await this.driver.scroll();
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
    const c = elementCenter(node, this.screenSize);
    const selector = node.selector;
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
  <div id="record-target">Recording into: <span id="record-target-path">-</span></div>
  <div id="hierarchy-banner" class="hidden"></div>
  <div id="mirror-body">
    <div id="stage">
      <canvas id="screen"></canvas>
      <div id="overlay"></div>
      <div id="keyboard-mask"><span>System keyboard - not inspectable</span></div>
      <div id="selection">
        <span id="selection-badge"></span>
      </div>
    </div>
    <div id="device-nav">
      ${navButtonsFor(this.driver.platform)
        .map(
          (b, i) =>
            `${i === navButtonsFor(this.driver.platform).length - 1 ? '<span class="nav-sep"></span>' : ''}` +
            `<button type="button" class="nav-btn" data-nav="${b.action}" title="${b.title}" aria-label="${b.label}">${b.icon}</button>`
        )
        .join('\n      ')}
      <span class="nav-sep"></span>
      <span id="zoom-controls">
        <button type="button" class="zoom-btn" data-zoom="out" title="Zoom out" aria-label="Zoom out">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 12h12"/></svg>
        </button>
        <span id="zoom-label">50%</span>
        <button type="button" class="zoom-btn" data-zoom="in" title="Zoom in" aria-label="Zoom in">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>
        </button>
      </span>
    </div>
  </div>
  <div id="context-menu" class="hidden"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.elementTimer) clearTimeout(this.elementTimer);
    this.activeEditorSub?.dispose();
    MirrorPanel.current = undefined;
  }
}
