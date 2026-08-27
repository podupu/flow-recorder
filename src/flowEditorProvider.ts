import * as vscode from 'vscode';
import { runApiRequest } from './recorder';
import { AndroidMirrorPanel } from './mirrorPanel';
import { saveScreenshotBesideFlow, resolveCaptureDevice } from './screenshotCapture';
import { parseFlowDocument, appendFlowStep, deleteFlowStep, updateStep, writeFlowDocument } from './flowDocument';
import { buildApiSteps, isLegacyApiStep, convertLegacyApiStepFull } from './maestroApi';

function buildCommandStep(command: { type: string; args: Record<string, any> }): any {
  const positiveNumber = (v: any, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  switch (command.type) {
    case 'assertVisible':
      return { assertVisible: { text: command.args.selector } };
    case 'assertNotVisible':
      return { assertNotVisible: { text: command.args.selector } };
    case 'waitForAnimationToEnd':
      return { waitForAnimationToEnd: { timeout: positiveNumber(command.args.timeout, 5000) } };
    case 'extendedWaitUntil':
      return {
        extendedWaitUntil: {
          visible: command.args.selector,
          timeout: positiveNumber(command.args.timeout, 120000)
        }
      };
    case 'openLink':
      return { openLink: command.args.uri };
    case 'runFlow':
      return { runFlow: command.args.path };
    case 'copyTextFrom':
      return { copyTextFrom: { text: command.args.selector, to: command.args.toVar } };
    default:
      return undefined;
  }
}

export class FlowEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = 'flowRecorder.flowEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new FlowEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      FlowEditorProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      // Screenshot thumbnails live beside the flow, outside the extension folder.
      localResourceRoots: [this.context.extensionUri, vscode.Uri.joinPath(document.uri, '..')]
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // Flows written by the old scaffold contain `apiRequest:`/`response:`, which Maestro
    // cannot replay. Convert them once, keeping a .bak alongside.
    await this.migrateLegacyApiSteps(document);

    const postState = () => {
      const doc = parseFlowDocument(document);
      // Webviews cannot load file:// paths directly - each screenshot needs a webview URI.
      const assets: Record<string, string> = {};
      for (const step of doc.steps || []) {
        const rel = step && step.takeScreenshot;
        if (typeof rel === 'string' && !assets[rel]) {
          const uri = vscode.Uri.joinPath(document.uri, '..', rel);
          assets[rel] = webviewPanel.webview.asWebviewUri(uri).toString();
        }
      }
      webviewPanel.webview.postMessage({ type: 'update', doc, assets });
    };

    // Keep the webview in sync if the file changes on disk / via text edits.
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        postState();
      }
    });
    webviewPanel.onDidDispose(() => changeSub.dispose());

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          postState();
          break;

        case 'addApiBlock': {
          // The request is run once so the recorded assertion reflects a real status, then
          // translated into official Maestro steps (evalScript/runScript + assertTrue).
          const result = await runApiRequest(message.payload);
          if (result.status === 0) {
            vscode.window.showWarningMessage(
              `Request failed (${result.bodyPreview}) - recording it to assert 200 anyway.`
            );
          }
          const index = (parseFlowDocument(document).steps || []).length + 1;
          const built = buildApiSteps(
            {
              method: message.payload.method,
              url: message.payload.url,
              headers: message.payload.headers,
              body: message.payload.body || undefined,
              expectStatus: result.status || 200
            },
            { outputVar: `api${index}`, scriptName: `api-${index}` }
          );
          if (built.script) {
            await this.writeScriptBesideFlow(document.uri, built.script);
          }
          for (const step of built.steps) {
            await appendFlowStep(document, step);
          }
          break;
        }

        case 'addScreenshotBlock': {
          // Reuse the device an open mirror is attached to; otherwise ask.
          const deviceId = await resolveCaptureDevice(AndroidMirrorPanel.current?.deviceId);
          if (!deviceId) break;
          try {
            const rel = await saveScreenshotBesideFlow(document.uri, deviceId, message.name);
            await appendFlowStep(document, { takeScreenshot: rel });
          } catch (err: any) {
            vscode.window.showErrorMessage(`Could not capture screenshot: ${err.message}`);
          }
          break;
        }

        case 'deleteStep':
          await deleteFlowStep(document, message.index);
          break;

        case 'addCommand': {
          if (message.command && message.command.type) {
            const step = buildCommandStep(message.command);
            if (step) await appendFlowStep(document, step);
          }
          break;
        }

        case 'setOptional':
          await updateStep(document, message.index, { optional: message.optional });
          break;
      }
    });
  }

  /** Writes a generated JavaScript file to `scripts/` beside the flow. */
  private async writeScriptBesideFlow(
    flowUri: vscode.Uri,
    script: { fileName: string; contents: string }
  ): Promise<void> {
    const dir = vscode.Uri.joinPath(flowUri, '..', 'scripts');
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, script.fileName),
      Buffer.from(script.contents, 'utf8')
    );
  }

  private async migrateLegacyApiSteps(document: vscode.TextDocument): Promise<void> {
    const parsed = parseFlowDocument(document);
    const steps = parsed.steps || [];
    if (!steps.some(isLegacyApiStep)) return;

    const backup = vscode.Uri.file(`${document.uri.fsPath}.bak`);
    try {
      await vscode.workspace.fs.copy(document.uri, backup, { overwrite: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not back up the flow, leaving it unchanged: ${err.message}`);
      return;
    }

    const next: any[] = [];
    let converted = 0;
    for (const step of steps) {
      const result = convertLegacyApiStepFull(step, converted + 1);
      if (result) {
        if (result.script) {
          await this.writeScriptBesideFlow(document.uri, result.script);
        }
        next.push(...result.steps);
        converted += 1;
      } else {
        next.push(step);
      }
    }

    await writeFlowDocument(document, { config: parsed.config, steps: next });
    vscode.window.showInformationMessage(
      `Converted ${converted} apiRequest block${converted === 1 ? '' : 's'} to official Maestro steps. ` +
        `Backup saved as ${vscode.workspace.asRelativePath(backup)}.`
    );
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="toolbar">
    <button id="addApi">+ API block</button>
    <button id="addScreenshot">+ Screenshot block</button>
    <button id="addCommandBtn">+ Command</button>
  </div>

  <div id="apiForm" class="hidden">
    <div class="form-row">
      <select id="apiMethod">
        <option>GET</option>
        <option>POST</option>
        <option>PUT</option>
        <option>PATCH</option>
        <option>DELETE</option>
      </select>
      <input id="apiUrl" type="text" placeholder="https://api.example.com/endpoint" />
    </div>
    <textarea id="apiBody" placeholder="Request body (JSON, optional)" rows="3"></textarea>
    <div class="form-row form-actions">
      <button id="apiCancel" class="secondary">Cancel</button>
      <button id="apiSubmit">Run request</button>
    </div>
  </div>

  <div id="commandForm" class="hidden">
    <div class="form-row">
      <select id="commandType">
        <option value="assertVisible">assertVisible</option>
        <option value="assertNotVisible">assertNotVisible</option>
        <option value="waitForAnimationToEnd">waitForAnimationToEnd</option>
        <option value="extendedWaitUntil">extendedWaitUntil</option>
        <option value="openLink">openLink</option>
        <option value="runFlow">runFlow</option>
        <option value="copyTextFrom">copyTextFrom</option>
      </select>
    </div>
    <div id="commandFields"></div>
    <div class="form-row form-actions">
      <button id="commandCancel" class="secondary">Cancel</button>
      <button id="commandSubmit">Add</button>
    </div>
  </div>

  <div id="blocks"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
