import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMaestroArgs } from './environments';
import { EnvironmentController } from './envStatusBar';

/**
 * Surfaces every `.flow.yaml` in VS Code's Testing UI: a gutter play button beside each flow,
 * a Test Explorer listing, and run/debug profiles that apply the active environment.
 *
 * Maestro has no debug-adapter protocol, so the debug profile does not step - it runs with
 * `--debug-output` so screenshots, hierarchy dumps and logs survive for a failed flow.
 */
export class FlowTestController {
  private readonly controller: vscode.TestController;
  private readonly items = new Map<string, vscode.TestItem>();

  constructor(private readonly environments: EnvironmentController) {
    this.controller = vscode.tests.createTestController('flowRecorder.flows', 'Maestro Flows');

    this.controller.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.run(request, token, false),
      true
    );
    this.controller.createRunProfile(
      'Debug (keep artifacts)',
      vscode.TestRunProfileKind.Debug,
      (request, token) => this.run(request, token, true),
      false
    );

    this.controller.refreshHandler = async () => {
      await this.discover();
    };
  }

  public async register(): Promise<vscode.Disposable[]> {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.flow.yaml');
    watcher.onDidCreate((uri) => this.addFlow(uri));
    watcher.onDidDelete((uri) => this.removeFlow(uri));
    // Content changes do not alter the item, but keep the range anchored.
    watcher.onDidChange((uri) => this.addFlow(uri));

    await this.discover();
    return [this.controller, watcher];
  }

  private async discover(): Promise<void> {
    const found = await vscode.workspace.findFiles('**/*.flow.yaml', '**/node_modules/**');
    const seen = new Set(found.map((u) => u.toString()));

    for (const [key, item] of this.items) {
      if (!seen.has(key)) {
        this.controller.items.delete(item.id);
        this.items.delete(key);
      }
    }
    for (const uri of found) this.addFlow(uri);
  }

  private addFlow(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.items.has(key)) return;

    const label = vscode.workspace.asRelativePath(uri);
    const item = this.controller.createTestItem(key, label, uri);
    // A range is what makes VS Code draw the gutter play button next to the flow.
    item.range = new vscode.Range(0, 0, 0, 0);
    this.controller.items.add(item);
    this.items.set(key, item);
  }

  private removeFlow(uri: vscode.Uri): void {
    const key = uri.toString();
    const item = this.items.get(key);
    if (!item) return;
    this.controller.items.delete(item.id);
    this.items.delete(key);
  }

  private itemsFor(request: vscode.TestRunRequest): vscode.TestItem[] {
    if (request.include?.length) return [...request.include];
    const all: vscode.TestItem[] = [];
    this.controller.items.forEach((item) => all.push(item));
    return all.filter((item) => !request.exclude?.includes(item));
  }

  /** `maestro` is commonly installed to ~/.maestro/bin and not always on the GUI PATH. */
  private maestroCommand(): string {
    const bundled = path.join(os.homedir(), '.maestro', 'bin', 'maestro');
    return fs.existsSync(bundled) ? bundled : 'maestro';
  }

  private async run(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    debug: boolean
  ): Promise<void> {
    const run = this.controller.createTestRun(request);
    const queue = this.itemsFor(request);

    for (const item of queue) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }
      run.started(item);
      await this.runOne(run, item, token, debug);
    }
    run.end();
  }

  private async runOne(
    run: vscode.TestRun,
    item: vscode.TestItem,
    token: vscode.CancellationToken,
    debug: boolean
  ): Promise<void> {
    const flowPath = item.uri?.fsPath;
    if (!flowPath) {
      run.errored(item, new vscode.TestMessage('Flow has no file path.'));
      return;
    }

    const debugOutput = debug
      ? path.join(path.dirname(flowPath), '.maestro-debug', path.basename(flowPath, '.flow.yaml'))
      : undefined;

    const args = buildMaestroArgs(
      this.environments.activeEnvironment(),
      flowPath,
      this.environments.activePlatform(),
      { debugOutput, flattenDebugOutput: !!debugOutput }
    );

    const started = Date.now();
    run.appendOutput(`\r\n$ ${this.maestroCommand()} ${args.join(' ')}\r\n`);

    const code = await new Promise<number>((resolve) => {
      const child = spawn(this.maestroCommand(), args, {
        cwd: vscode.workspace.getWorkspaceFolder(item.uri!)?.uri.fsPath
      });

      // The Testing output pane is a terminal: bare \n leaves a staircase.
      const append = (buf: Buffer) => run.appendOutput(buf.toString().replace(/\r?\n/g, '\r\n'));
      child.stdout.on('data', append);
      child.stderr.on('data', append);

      token.onCancellationRequested(() => child.kill());
      child.on('error', (err) => {
        run.appendOutput(`\r\nCould not start maestro: ${err.message}\r\n`);
        resolve(-1);
      });
      child.on('close', (c) => resolve(c ?? -1));
    });

    const duration = Date.now() - started;

    if (token.isCancellationRequested) {
      run.skipped(item);
      return;
    }
    if (code === 0) {
      run.passed(item, duration);
      return;
    }

    const message = new vscode.TestMessage(
      code === -1
        ? 'maestro could not be started - is it installed and on your PATH?'
        : `Flow failed (exit ${code}).${debugOutput ? `\nArtifacts: ${debugOutput}` : ''}`
    );
    message.location = new vscode.Location(item.uri!, new vscode.Position(0, 0));
    run.failed(item, message, duration);
  }

  public dispose(): void {
    this.controller.dispose();
  }
}
