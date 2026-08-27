import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  DEFAULT_ENVIRONMENTS_FILE,
  MaestroEnvironment,
  buildMaestroArgs,
  defaultEnvironmentsTemplate,
  parseEnvironments
} from './environments';

const ENV_KEY = 'flowRecorder.activeEnvironment';
const PLATFORM_KEY = 'flowRecorder.activePlatform';

/** Maestro's platform identifiers, per the `when: platform:` condition. */
export const PLATFORMS = ['Android', 'iOS', 'Web'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Status-bar controls for the active environment and platform, plus the run command that
 * applies them. Environments are named variable sets injected with `-e KEY=VALUE`, which is
 * how Maestro varies values per run without touching the flow file.
 */
export class EnvironmentController {
  private readonly envItem: vscode.StatusBarItem;
  private readonly platformItem: vscode.StatusBarItem;
  private environments: MaestroEnvironment[] = [];
  private shared: Record<string, string> = {};
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.envItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.envItem.command = 'flowRecorder.selectEnvironment';
    this.platformItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.platformItem.command = 'flowRecorder.selectPlatform';
  }

  public register(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [
      this.envItem,
      this.platformItem,
      vscode.commands.registerCommand('flowRecorder.selectEnvironment', () => this.pickEnvironment()),
      vscode.commands.registerCommand('flowRecorder.selectPlatform', () => this.pickPlatform()),
      vscode.commands.registerCommand('flowRecorder.editEnvironments', () => this.openEnvironmentsFile()),
      // The status bar is only meaningful next to a flow.
      vscode.window.onDidChangeActiveTextEditor(() => this.updateVisibility())
    ];

    const folder = this.workspaceFolder();
    if (folder) {
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, DEFAULT_ENVIRONMENTS_FILE)
      );
      const reload = () => this.loadEnvironments();
      this.watcher.onDidCreate(reload);
      this.watcher.onDidChange(reload);
      this.watcher.onDidDelete(reload);
      disposables.push(this.watcher);
    }

    this.loadEnvironments();
    this.updateVisibility();
    return disposables;
  }

  private workspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  private environmentsUri(): vscode.Uri | undefined {
    const folder = this.workspaceFolder();
    return folder ? vscode.Uri.joinPath(folder.uri, DEFAULT_ENVIRONMENTS_FILE) : undefined;
  }

  private loadEnvironments(): void {
    const uri = this.environmentsUri();
    this.environments = [];
    if (uri && fs.existsSync(uri.fsPath)) {
      const { environments, shared, errors } = parseEnvironments(fs.readFileSync(uri.fsPath, 'utf8'));
      this.environments = environments;
      this.shared = shared;
      if (errors.length) {
        vscode.window.showWarningMessage(`${DEFAULT_ENVIRONMENTS_FILE}: ${errors.join('; ')}`);
      }
    }
    // A selection that no longer exists must not silently keep injecting old values.
    const active = this.activeEnvironmentName();
    if (active && !this.environments.some((e) => e.name === active)) {
      void this.context.workspaceState.update(ENV_KEY, undefined);
    }
    this.render();
  }

  private activeEnvironmentName(): string | undefined {
    return this.context.workspaceState.get<string>(ENV_KEY);
  }

  public activeEnvironment(): MaestroEnvironment | undefined {
    const name = this.activeEnvironmentName();
    if (name) return this.environments.find((e) => e.name === name);
    // Selecting "None" still applies $shared, as REST Client does.
    return Object.keys(this.shared).length ? { name: 'None', variables: this.shared } : undefined;
  }

  public activePlatform(): Platform {
    return this.context.workspaceState.get<Platform>(PLATFORM_KEY) || 'Android';
  }

  private render(): void {
    const env = this.activeEnvironmentName();
    this.envItem.text = `$(server-environment) ${env || 'No env'}`;
    this.envItem.tooltip = env
      ? `Maestro environment: ${env} - click to switch`
      : `No Maestro environment selected - click to choose (${DEFAULT_ENVIRONMENTS_FILE})`;

    const platform = this.activePlatform();
    this.platformItem.text = `$(device-mobile) ${platform}`;
    this.platformItem.tooltip = `Target platform: ${platform} - click to switch`;
  }

  private updateVisibility(): void {
    const editor = vscode.window.activeTextEditor;
    const isFlow = !!editor && editor.document.fileName.endsWith('.flow.yaml');
    if (isFlow) {
      this.envItem.show();
      this.platformItem.show();
    } else {
      this.envItem.hide();
      this.platformItem.hide();
    }
  }

  private async pickEnvironment(): Promise<void> {
    if (!this.environments.length) {
      const create = await vscode.window.showInformationMessage(
        `No ${DEFAULT_ENVIRONMENTS_FILE} found. Create one with staging/prod/test to get started?`,
        'Create',
        'Cancel'
      );
      if (create === 'Create') await this.createEnvironmentsFile();
      return;
    }

    const items: (vscode.QuickPickItem & { name?: string })[] = [
      {
        label: 'None',
        description: Object.keys(this.shared).length ? '$shared variables only' : 'No variables'
      },
      ...this.environments.map((e) => ({
        label: e.name,
        name: e.name,
        description: Object.keys(e.variables).join(', ') || 'no variables'
      })),
      { label: '$(gear) Edit environments...', name: '__edit' }
    ];

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a Maestro environment' });
    if (!picked) return;
    if (picked.name === '__edit') {
      await this.openEnvironmentsFile();
      return;
    }
    await this.context.workspaceState.update(ENV_KEY, picked.label === 'None' ? undefined : picked.label);
    this.render();
  }

  private async pickPlatform(): Promise<void> {
    const picked = await vscode.window.showQuickPick([...PLATFORMS], { placeHolder: 'Target platform' });
    if (!picked) return;
    await this.context.workspaceState.update(PLATFORM_KEY, picked as Platform);
    this.render();
    if (picked !== 'Android') {
      vscode.window.showInformationMessage(
        `Platform set to ${picked}. Flows will run against ${picked}, but the Android mirror is adb-based and stays Android-only.`
      );
    }
  }

  private async createEnvironmentsFile(): Promise<void> {
    const uri = this.environmentsUri();
    if (!uri) {
      vscode.window.showErrorMessage('Open a folder to create an environments file.');
      return;
    }
    if (!fs.existsSync(uri.fsPath)) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(defaultEnvironmentsTemplate(), 'utf8'));
    }
    this.loadEnvironments();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  }

  private async openEnvironmentsFile(): Promise<void> {
    const uri = this.environmentsUri();
    if (uri && !fs.existsSync(uri.fsPath)) {
      await this.createEnvironmentsFile();
      return;
    }
    if (uri) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  }


  public dispose(): void {
    this.envItem.dispose();
    this.platformItem.dispose();
    this.watcher?.dispose();
  }
}
