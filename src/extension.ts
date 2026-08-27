import * as vscode from 'vscode';
import { FlowEditorProvider } from './flowEditorProvider';
import { FlowLinkProvider } from './flowLinkProvider';
import { EnvironmentController } from './envStatusBar';
import { FlowTestController } from './flowTestController';
import { AndroidMirrorPanel } from './mirrorPanel';
import { parseFlowDocument, insertFlowStepsAtLine } from './flowDocument';
import { runApiRequest } from './recorder';
import { buildApiSteps, parseHeaderLine } from './maestroApi';
import { saveScreenshotBesideFlow, resolveCaptureDevice } from './screenshotCapture';
import * as adb from './android/adb';
import { registerMaestroFlowSchema } from './yamlSchema';

/**
 * .flow.yaml files open in our CustomTextEditorProvider (a webview), and VS Code does NOT
 * surface custom editors through `window.activeTextEditor` - that API only tracks plain text
 * editors. The reliable way to find "the flow the user is currently looking at" is the active
 * tab, which works for both custom editors and, as a fallback, plain text editors (e.g. if
 * someone reopened the file with "Reopen Editor With... > Text Editor").
 */
function flowUriFromTab(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (
    (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) &&
    input.uri.fsPath.endsWith('.flow.yaml')
  ) {
    return input.uri;
  }
  return undefined;
}

async function getActiveFlowDocument(): Promise<vscode.TextDocument | undefined> {
  // 1. The tab the user is actually looking at.
  const activeUri = flowUriFromTab(vscode.window.tabGroups.activeTabGroup.activeTab);
  if (activeUri) {
    return vscode.workspace.openTextDocument(activeUri);
  }

  const active = vscode.window.activeTextEditor;
  if (active && active.document.fileName.endsWith('.flow.yaml')) {
    return active.document;
  }

  // 2. Any flow open in any group. The mirror panel opens in ViewColumn.Beside and takes
  //    focus, so re-running the command with the mirror focused would otherwise report "no
  //    flow open" even though the flow being recorded sits in the group next to it.
  const openFlows: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = flowUriFromTab(tab);
      if (uri && !seen.has(uri.fsPath)) {
        seen.add(uri.fsPath);
        openFlows.push(uri);
      }
    }
  }
  if (openFlows.length === 1) {
    return vscode.workspace.openTextDocument(openFlows[0]);
  }
  if (openFlows.length > 1) {
    const picked = await vscode.window.showQuickPick(
      openFlows.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
      { placeHolder: 'Which flow should recorded steps be appended to?' }
    );
    return picked ? vscode.workspace.openTextDocument(picked.uri) : undefined;
  }
  return undefined;
}

/** The .flow.yaml text editor the command was invoked from. */
function activeFlowEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.fileName.endsWith('.flow.yaml')) return editor;
  vscode.window.showErrorMessage('Open a .flow.yaml file in the editor to add a step.');
  return undefined;
}

/**
 * Prompts for an API request, runs it once so the recorded assertion reflects a real status,
 * and inserts official Maestro steps at the cursor. See src/maestroApi.ts for the mapping.
 */
async function promptAndInsertApiBlock(): Promise<void> {
  const editor = activeFlowEditor();
  if (!editor) return;

  const method = await vscode.window.showQuickPick(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], {
    placeHolder: 'HTTP method'
  });
  if (!method) return;

  const url = await vscode.window.showInputBox({
    prompt: 'Request URL',
    placeHolder: 'https://api.example.com/endpoint',
    validateInput: (v) => (v.trim().startsWith('http') ? undefined : 'Enter an http(s) URL')
  });
  if (!url) return;

  let body: string | undefined;
  if (method !== 'GET') {
    body = await vscode.window.showInputBox({
      prompt: 'Request body (optional)',
      placeHolder: '{"user":"demo"}'
    });
  }

  const headerLine = await vscode.window.showInputBox({
    prompt: 'Headers (optional), comma-separated',
    placeHolder: 'Content-Type: application/json, Authorization: Bearer abc'
  });
  const headers = parseHeaderLine(headerLine);

  const result = await runApiRequest({ method, url: url.trim(), headers, body });
  if (result.status === 0) {
    const go = await vscode.window.showWarningMessage(
      `Request failed: ${result.bodyPreview}. Record it anyway, asserting 200?`,
      'Record',
      'Cancel'
    );
    if (go !== 'Record') return;
  }

  const index = (parseFlowDocument(editor.document).steps || []).length + 1;
  const built = buildApiSteps(
    { method, url: url.trim(), headers, body: body || undefined, expectStatus: result.status || 200 },
    { outputVar: `api${index}`, scriptName: `api-${index}` }
  );
  if (built.script) {
    await writeScriptBesideFlow(editor.document.uri, built.script);
  }
  await insertFlowStepsAtLine(editor.document, editor.selection.active.line, built.steps);
  vscode.window.showInformationMessage(
    built.script ? `Added runScript + assertTrue (scripts/${built.script.fileName}).` : 'Added evalScript + assertTrue.'
  );
}

async function writeScriptBesideFlow(
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

async function promptAndInsertScreenshotBlock(): Promise<void> {
  const editor = activeFlowEditor();
  if (!editor) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Screenshot name (saved to assets/ beside this flow)',
    value: 'screenshot'
  });
  if (name === undefined) return;

  const deviceId = await resolveCaptureDevice(AndroidMirrorPanel.current?.deviceId);
  if (!deviceId) return;

  try {
    const rel = await saveScreenshotBesideFlow(editor.document.uri, deviceId, name);
    await insertFlowStepsAtLine(editor.document, editor.selection.active.line, [{ takeScreenshot: rel }]);
    vscode.window.showInformationMessage(`Captured ${rel}`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Could not capture screenshot: ${err.message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(FlowEditorProvider.register(context));
  // Make runFlow / runScript / takeScreenshot paths clickable.
  context.subscriptions.push(FlowLinkProvider.register());

  // Named variable sets, injected as `-e KEY=VALUE` when running a flow.
  const environments = new EnvironmentController(context);
  context.subscriptions.push(...environments.register());

  // Flows appear in the Testing view with a gutter play button beside each one.
  const flowTests = new FlowTestController(environments);
  void flowTests.register().then((d) => context.subscriptions.push(...d));

  // SchemaStore mis-matches *.flow.yaml to Estuary Flow; point it at Maestro instead.
  void registerMaestroFlowSchema(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('flowRecorder.addApiBlock', promptAndInsertApiBlock),
    vscode.commands.registerCommand('flowRecorder.addScreenshotBlock', promptAndInsertScreenshotBlock),
    vscode.commands.registerCommand('flowRecorder.openBlockView', async () => {
      const editor = activeFlowEditor();
      if (!editor) return;
      await vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        'flowRecorder.flowEditor',
        vscode.ViewColumn.Beside
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowRecorder.startAndroidMirror', async () => {
      const document = await getActiveFlowDocument();
      if (!document) {
        // A mirror already recording into a flow stays valid even when no flow tab is
        // focused - just bring it back rather than reporting a missing flow.
        if (AndroidMirrorPanel.current) {
          AndroidMirrorPanel.current.reveal();
          return;
        }
        vscode.window.showErrorMessage(
          'No .flow.yaml is open. Open the flow you want to record into (any tab group), then run this command again.'
        );
        return;
      }

      let devices: adb.AdbDevice[];
      try {
        devices = await adb.listDevices();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Could not run adb. Is Android platform-tools installed and on your PATH? (${err.message})`
        );
        return;
      }

      const online = devices.filter((d) => d.state === 'device');
      if (online.length === 0) {
        vscode.window.showErrorMessage(
          'No connected Android devices or emulators found. Start an emulator, or plug in a device with USB debugging enabled, then try again.'
        );
        return;
      }

      let deviceId: string;
      if (online.length === 1) {
        deviceId = online[0].id;
      } else {
        const picked = await vscode.window.showQuickPick(
          online.map((d) => ({ label: d.id, description: d.isEmulator ? 'emulator' : 'device' })),
          { placeHolder: 'Select an Android device' }
        );
        if (!picked) return;
        deviceId = picked.label;
      }

      await AndroidMirrorPanel.createOrShow(context, deviceId, document.uri);
    })
  );
}

export function deactivate() {}
