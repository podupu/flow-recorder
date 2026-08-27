import * as vscode from 'vscode';
import { runApiRequest, captureScreenshotStub } from './recorder';
import { parseFlowDocument, appendFlowStep, deleteFlowStep } from './flowDocument';

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

  <div id="blocks"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
