import * as vscode from 'vscode';
import * as fs from 'fs';
import { isFlowDocument } from './flowContext';
import { DeviceDriver, DeviceElement, UnsupportedOperationError } from './deviceDriver';

import { classifySwipeDirection } from './gestures';
import { navButtonsFor, navActionSpecFor } from './deviceNav';
import { saveScreenshotBesideFlow } from './screenshotCapture';
import { InstalledApp } from './installedApps';
import { appendFlowStep, parseFlowDocument } from './flowDocument';
import { findAccessibilityGaps, describeGaps } from './coverage';

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
  private frameProblem: string | undefined;
  /** Set only for a recoverable UiAutomation conflict, so Reload knows what to force-stop. */
  private recoverableDrivers: string[] = [];
  private keyboardShowing = false;
  private activeEditorSub: vscode.Disposable | undefined;
  private optional = false;
  private recording = false;
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
    this.postTarget();
    // A screenshot does not require accessibility or a known input coordinate space.
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
      if (this.disposed) return;
      this.panel.webview.postMessage({ type: 'frame', data: png.toString('base64') });
      if (this.frameProblem) {
        this.frameProblem = undefined;
        this.panel.webview.postMessage({ type: 'frameOk' });
      }
    } catch (err: any) {
      if (this.disposed) return;
      const text = `Screen capture unavailable. Retrying automatically. ${err.message || err}`;
      if (text !== this.frameProblem) {
        this.frameProblem = text;
        this.panel.webview.postMessage({ type: 'frameError', text });
      }
    }
  }

  /**
   * @param force Reload must produce a genuinely new dump. A poll tick may already be in
   * flight, and simply returning (as the poll path does) would make the button do nothing;
   * a forced refresh waits that dump out and then takes a fresh one.
   */
  private async refreshElements(force = false): Promise<void> {
    if (this.disposed) return;
    if (this.dumping) {
      if (!force) return;
      await this.waitForDumpToSettle();
      if (this.disposed || this.dumping) return;
    }
    this.dumping = true;
    try {
      // Retry failed startup lookups on every poll, including an explicit Reload.
      if (!this.screenSize) this.screenSize = await this.driver.screenSize();
      // Drivers hand back elements already normalised to 0-1 with selectors resolved, so
      // the panel stays free of any platform-specific hierarchy shape.
      this.allElements = await this.driver.elements();
      this.screenSize = await this.driver.screenSize();
      const keyboard = await this.driver.keyboardRegion();
      if (this.disposed) return;
      this.keyboardShowing = !!keyboard;
      this.panel.webview.postMessage({
        type: 'elements',
        nodes: this.allElements,
        keyboard,
        // A screen can detect perfectly and still have whole regions the app hides from
        // accessibility. Reported alongside the elements so the panel can say which it is
        // looking at rather than leaving an empty area looking like a recorder failure.
        coverageNote: describeGaps(findAccessibilityGaps(this.allElements))
      });
      // Recovered - clear any standing problem banner and re-arm the one-shot notification.
      if (this.hierarchyProblem) {
        this.hierarchyProblem = undefined;
        this.recoverableDrivers = [];
        this.panel.webview.postMessage({ type: 'hierarchyOk' });
      }
    } catch (err: any) {
      if (!this.disposed) this.reportHierarchyFailure(err);
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
    this.allElements = [];
    this.keyboardShowing = false;
    this.recoverableDrivers = this.driver.recoverableDriversFor(err);
    this.panel.webview.postMessage({ type: 'hierarchyError', text: message });
    if (this.hierarchyProblem === message) return;
    this.hierarchyProblem = message;
    vscode.window.showWarningMessage(message);
  }

  private async emit(step: any): Promise<void> {
    if (!this.recording) return;
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
      case 'setRecording':
        this.recording = msg.value === true;
        this.panel.webview.postMessage({ type: 'recordingState', recording: this.recording });
        break;
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
      // Top priority: a known-recoverable UiAutomation conflict is cleared before anything
      // else runs, since every dump will keep failing identically otherwise.
      if (this.recoverableDrivers.length) {
        this.panel.webview.postMessage({
          type: 'status',
          text: `Stopping ${this.recoverableDrivers.join(', ')}...`
        });
        const stopped = await this.driver.killConflictingAutomation();
        this.recoverableDrivers = [];
        if (stopped.length) {
          vscode.window.showInformationMessage(`Stopped ${stopped.join(', ')} - retrying element detection.`);
        }
      }
      this.panel.webview.postMessage({ type: 'status', text: 'Refreshing screen and elements...' });
    }
    await this.pushFrame();
    await this.refreshElements(isReload);
    if (isReload && !this.hierarchyProblem && !this.frameProblem) {
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

  /**
   * Resolves the app to act on: the flow's `appId` when it declares one, otherwise a pick from
   * what is actually installed on the device.
   *
   * Prompting only when the flow is silent matters - a flow that names its app should never be
   * second-guessed, and a flow that does not should not fall back to a guess. This used to
   * launch a fabricated `com.example.app`, which failed on any real device.
   */
  private async resolveAppId(): Promise<string | undefined> {
    const declared = this.currentAppId;
    if (declared && !declared.includes('${')) return declared;

    // `appId: ${APP_BUNDLE_ID}` is resolved by Maestro at run time, not by us.
    if (declared && declared.includes('${')) {
      vscode.window.showInformationMessage(
        `This flow uses ${declared} for its appId, which Maestro substitutes at run time. Pick an installed app to launch now.`
      );
    }

    let apps: InstalledApp[] = [];
    try {
      apps = await this.driver.listApps();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not list installed apps: ${err.message}`);
      return undefined;
    }
    if (!apps.length) {
      vscode.window.showErrorMessage('No apps found on the device. Install the app first.');
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      apps.map((a) => ({
        label: a.name || a.bundleId,
        description: a.name ? a.bundleId : undefined,
        detail: a.isSystem ? 'system app' : undefined,
        bundleId: a.bundleId
      })),
      { placeHolder: 'Which app should this flow launch?', matchOnDescription: true }
    );
    if (!picked) return undefined;

    await this.offerToRecordAppId(picked.bundleId);
    return picked.bundleId;
  }

  /** Writing the choice into the flow keeps it runnable outside VS Code. */
  private async offerToRecordAppId(appId: string): Promise<void> {
    if (this.currentAppId) return;
    const choice = await vscode.window.showInformationMessage(
      `Set appId: ${appId} in this flow?`,
      'Set appId',
      'Not now'
    );
    if (choice !== 'Set appId') return;

    try {
      const document = await vscode.workspace.openTextDocument(this.flowUri);
      const edit = new vscode.WorkspaceEdit();
      const text = document.getText();
      if (!text.trim()) {
        edit.insert(this.flowUri, new vscode.Position(0, 0), `appId: ${appId}\n---\n`);
      } else {
        edit.insert(this.flowUri, new vscode.Position(0, 0), `appId: ${appId}\n`);
      }
      await vscode.workspace.applyEdit(edit);
    } catch (err: any) {
      vscode.window.showWarningMessage(`Could not write appId into the flow: ${err.message}`);
    }
  }

  private async handleLaunchApp(clearState: boolean): Promise<void> {
    const appId = await this.resolveAppId();
    if (!appId) return;

    try {
      if (clearState) await this.driver.clearState(appId);
      await this.driver.launchApp(appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to launch app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { launchApp: { clearState: true } } : { launchApp: null });
    void this.refreshElements();
  }

  private async handleStopApp(): Promise<void> {
    const appId = await this.resolveAppId();
    if (!appId) return;
    try {
      await this.driver.stopApp(appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      return;
    }
    await this.emit('stopApp');
  }

  private async handleKillApp(clearState: boolean): Promise<void> {
    const appId = await this.resolveAppId();
    if (!appId) return;
    try {
      await this.driver.killApp(appId, clearState);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to kill app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { killApp: { clearState: true } } : 'killApp');
  }

  private async handleClearState(): Promise<void> {
    const appId = await this.resolveAppId();
    if (!appId) return;
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

  /**
   * Read a webview asset from disk so it can be inlined into the HTML.
   *
   * These were previously loaded as separate resources via `asWebviewUri`. That is the
   * documented pattern, and it is the one that kept failing: VS Code's webview service worker
   * caches resources on DISK, keyed by URI, and that cache survives window reloads, editor
   * restarts and extension reinstalls. Because the extension version stayed at 0.1.0 across
   * rebuilds the URIs never changed, so the panel went on serving the FIRST build's JS and CSS
   * while the files on disk were demonstrably new - several consecutive fixes appeared to do
   * nothing at all, because the code being executed was never the code being edited.
   *
   * The HTML string is generated here on every panel open and assigned straight to
   * `panel.webview.html`, so it never passes through that cache. Inlining moves the assets onto
   * that path, removing the staleness failure mode outright rather than trying to out-run it
   * with cache-busting query strings.
   */
  private readAsset(...segments: string[]): string {
    const uri = vscode.Uri.joinPath(this.context.extensionUri, ...segments);
    try {
      // `</script` inside the payload would close the wrapping tag early. Nothing in these
      // files contains it today, but a silently truncated panel is an expensive way to
      // find out that changed.
      return fs.readFileSync(uri.fsPath, 'utf8').replace(/<\/script/gi, '<\\/script');
    } catch (err: any) {
      return `/* Flow Recorder could not read ${segments.join('/')}: ${err.message} */`;
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Device mirror</title>
  <style>${this.readAsset('media', 'mirror.css')}</style>
</head>
<body>
  <div id="status" role="status" aria-atomic="true">Connecting to device...</div>
  <div id="record-target">
    <button id="recording-toggle" type="button" aria-pressed="false">Start recording</button>
    <span id="recording-label" role="status">Control only — interactions do not change your flow.</span>
    <div>Flow: <span id="record-target-path">-</span></div>
  </div>
  <div id="frame-banner" class="hidden" role="status" aria-atomic="true"></div>
  <div id="hierarchy-banner" class="hidden" role="status" aria-atomic="true"></div>
  <!--
    Distinct from the banner above: that one means detection FAILED, this one means
    detection succeeded and the app simply has nothing accessible in part of the screen.
    Conflating them sends the user hunting for a bug in the wrong codebase.
  -->
  <div id="coverage-note" class="hidden"></div>
  <main id="mirror-body" aria-label="Device mirror and inspector">
    <div id="stage">
      <canvas id="screen" role="img" aria-label="Live device screen. Use the detected elements control below for keyboard actions."></canvas>
      <div id="overlay" aria-hidden="true"></div>
      <div id="keyboard-mask"><span>System keyboard - not inspectable</span></div>
      <div id="selection" aria-hidden="true">
        <span id="selection-badge"></span>
      </div>
    </div>
    <div id="device-nav" role="group" aria-label="Device and view controls">
      ${navButtonsFor(this.driver.platform)
        .map(
          (b, i) =>
            `${i === navButtonsFor(this.driver.platform).length - 1 ? '<span class="nav-sep"></span>' : ''}` +
            `<button type="button" class="nav-btn" data-nav="${b.action}" title="${b.title}" aria-label="${b.label}">${b.icon}</button>`
        )
        .join('\n      ')}
      <span class="nav-sep"></span>
      <button type="button" id="show-all-btn" class="nav-btn" title="Show all detected elements, numbered like Maestro Studio" aria-label="Show all elements" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/></svg>
      </button>
      <!--
        Reports what the overlay actually received and drew. Element detection failing, the
        webview running a stale cached build, and a CSS problem hiding the boxes all look
        identical from outside - "nothing is highlighted" - and that ambiguity cost several
        rounds of misdiagnosis. This makes the three states tell themselves apart.
      -->
      <span id="element-count" title="Elements received from the device / boxes drawn">-</span>
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
    <div id="element-controls">
      <label for="element-picker">Detected elements</label>
      <select id="element-picker" aria-describedby="element-help" disabled><option>Waiting for element detection…</option></select>
      <button id="element-actions" type="button" aria-haspopup="dialog" disabled>Actions</button>
      <p id="element-help">Choose an element, then open Actions to tap, type or add an assertion. Escape closes Actions.</p>
    </div>
  </main>
  <div id="context-menu" class="hidden" role="dialog" aria-label="Device actions"></div>
  <script>${this.readAsset('media', 'mirror.js')}</script>
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
