import * as vscode from 'vscode';
import { runApiRequest, captureScreenshotStub } from './recorder';
import { parseFlowDocument, appendFlowStep, deleteFlowStep, updateStep } from './flowDocument';

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
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    const postState = () => {
      webviewPanel.webview.postMessage({ type: 'update', doc: parseFlowDocument(document) });
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
          const result = await runApiRequest(message.payload);
          await appendFlowStep(document, {
            apiRequest: {
              method: message.payload.method,
              url: message.payload.url,
              body: message.payload.body || undefined
            },
            response: {
              status: result.status,
              durationMs: result.durationMs,
              body: result.bodyPreview
            }
          });
          break;
        }

        case 'addScreenshotBlock': {
          const shot = await captureScreenshotStub();
          await appendFlowStep(document, {
            takeScreenshot: shot.path,
            note: shot.note
          });
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
