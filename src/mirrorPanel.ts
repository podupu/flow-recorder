import * as vscode from 'vscode';
import * as adb from './android/adb';
import { parseUiNodes, findSmallestNodeAtPoint, toMaestroSelector } from './android/uiautomator';

export class AndroidMirrorPanel {
  public static current: AndroidMirrorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pollTimer: NodeJS.Timeout | undefined;
  private screenSize: { width: number; height: number } | undefined;
  private disposed = false;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    deviceId: string,
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
    AndroidMirrorPanel.current = new AndroidMirrorPanel(context, panel, deviceId, appendStep);
    await AndroidMirrorPanel.current.init();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly deviceId: string,
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
  }

  /**
   * Live view via polled screenshots (~1-2 fps). This is the reliable, verified-working default.
   * A real-time video path (scrcpy + WebCodecs, per the earlier research) is the natural next
   * upgrade but needs a physical device/emulator to test its binary wire protocol against -
   * worth doing once this screenshot-based flow is confirmed working in your environment.
   */
  private startPolling(): void {
    const intervalMs = 700;
    const tick = async () => {
      if (this.disposed) return;
      try {
        const png = await adb.screenshot(this.deviceId);
        this.panel.webview.postMessage({ type: 'frame', data: png.toString('base64') });
      } catch {
        // Device likely mid-reconnect or briefly busy - keep polling rather than giving up.
      }
      if (!this.disposed) {
        this.pollTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg.type !== 'tap') return;
    if (!this.screenSize) {
      vscode.window.showErrorMessage('Device screen size is unknown; cannot translate the tap.');
      return;
    }

    const x = msg.xPct * this.screenSize.width;
    const y = msg.yPct * this.screenSize.height;

    try {
      await adb.tap(this.deviceId, x, y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send tap to device: ${err.message}`);
      return;
    }

    let selector: any;
    try {
      const xml = await adb.dumpUiHierarchy(this.deviceId);
      const nodes = parseUiNodes(xml);
      const node = findSmallestNodeAtPoint(nodes, x, y);
      selector = toMaestroSelector(node, x, y, this.screenSize);
    } catch {
      // Hierarchy dump can fail transiently (e.g. mid-animation) - fall back to a plain
      // percentage coordinate rather than losing the step.
      const pct = `${Math.round(msg.xPct * 100)}%,${Math.round(msg.yPct * 100)}%`;
      selector = { tapOn: { point: pct } };
    }

    await this.appendStep(selector);
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
  <canvas id="screen"></canvas>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    AndroidMirrorPanel.current = undefined;
  }
}
