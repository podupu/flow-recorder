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
async function getActiveFlowDocument(): Promise<vscode.TextDocument | undefined> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (input instanceof vscode.TabInputCustom && input.uri.fsPath.endsWith('.flow.yaml')) {
    return vscode.workspace.openTextDocument(input.uri);
  }
  if (input instanceof vscode.TabInputText && input.uri.fsPath.endsWith('.flow.yaml')) {
    return vscode.workspace.openTextDocument(input.uri);
  }
  const active = vscode.window.activeTextEditor;
  if (active && active.document.fileName.endsWith('.flow.yaml')) {
    return active.document;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(FlowEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('flowRecorder.startAndroidMirror', async () => {
      const document = await getActiveFlowDocument();
      if (!document) {
        vscode.window.showErrorMessage(
          'Open a .flow.yaml file first - recorded taps are appended to whichever flow is currently active.'
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
