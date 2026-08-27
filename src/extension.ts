import * as vscode from 'vscode';
import { FlowEditorProvider } from './flowEditorProvider';
import { AndroidMirrorPanel } from './mirrorPanel';
import { appendFlowStep, parseFlowDocument } from './flowDocument';
import * as adb from './android/adb';

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

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(FlowEditorProvider.register(context));

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

      const config = parseFlowDocument(document).config;
      await AndroidMirrorPanel.createOrShow(context, deviceId, config, (step) => appendFlowStep(document, step));
    })
  );
}

export function deactivate() {}
