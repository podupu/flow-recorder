import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMaestroArgs } from './environments';
import { EnvironmentController } from './envStatusBar';
import { flowPatterns } from './flowContext';
import {
  parseFlowSteps,
  stepLabel,
  buildPartialFlow,
  attributeFailure,
  FlowStep
} from './stepItems';
import * as yaml from 'js-yaml';
import { MirrorPanel } from './mirrorPanel';
import { pickDevice } from './devicePicker';
import { replaySteps } from './replayRunner';
import { summariseReplay } from './replay';

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
    // Runs against the mirrored device directly - no `maestro` process, so the app's current
    // screen is untouched. This is what makes "run from line 12" actually start at line 12:
    // maestro's own driver backgrounds the app before the first step of any CLI run.
    this.controller.createRunProfile(
      'Replay on live app (no relaunch)',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runReplay(request, token),
      false
    );

    this.controller.refreshHandler = async () => {
      await this.discover();
    };
  }

  public async register(): Promise<vscode.Disposable[]> {
    const watcher = vscode.workspace.createFileSystemWatcher(`{${flowPatterns().join(',')}}`);
    watcher.onDidCreate((uri) => this.addFlow(uri));
    watcher.onDidDelete((uri) => this.removeFlow(uri));
    // Content changes do not alter the item, but keep the range anchored.
    watcher.onDidChange((uri) => this.addFlow(uri));

    await this.discover();
    return [this.controller, watcher];
  }

  private async discover(): Promise<void> {
    const found = await vscode.workspace.findFiles(`{${flowPatterns().join(',')}}`, '**/node_modules/**');
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
    let item = this.items.get(key);

    if (!item) {
      const label = vscode.workspace.asRelativePath(uri);
      item = this.controller.createTestItem(key, label, uri);
      // A range is what makes VS Code draw the gutter play button next to the flow.
      item.range = new vscode.Range(0, 0, 0, 0);
      this.controller.items.add(item);
      this.items.set(key, item);
    }
    void this.buildSteps(item, uri);
  }

  /**
   * One child item per step, each anchored to its line. VS Code turns that into the hover
   * play button and the pass/fail icon in the gutter beside every step.
   */
  private async buildSteps(parent: vscode.TestItem, uri: vscode.Uri): Promise<void> {
    let steps: FlowStep[] = [];
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      steps = parseFlowSteps(Buffer.from(bytes).toString('utf8'));
    } catch {
      // Unreadable or mid-edit - keep whatever children are already there.
      return;
    }

    parent.children.replace(
      steps.map((step) => {
        const child = this.controller.createTestItem(
          `${uri.toString()}#${step.index}`,
          `${step.index + 1}. ${stepLabel(step)}`,
          uri
        );
        child.range = new vscode.Range(step.line, 0, step.line, 0);
        return child;
      })
    );
  }

  private removeFlow(uri: vscode.Uri): void {
    const key = uri.toString();
    const item = this.items.get(key);
    if (!item) return;
    this.controller.items.delete(item.id);
    this.items.delete(key);
  }

  /** Step index encoded in a child item id, or undefined for a whole-flow item. */
  private static stepIndexOf(item: vscode.TestItem): number | undefined {
    const hash = item.id.lastIndexOf('#');
    if (hash === -1) return undefined;
    const n = Number(item.id.slice(hash + 1));
    return Number.isInteger(n) ? n : undefined;
  }

  private async runReplay(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
    // Prefer the device an open mirror is already attached to; otherwise ask. The mirror is
    // commonly closed - notably right after the extension itself reloads or reinstalls, which
    // always clears this - so requiring it to already be open was a needless dead end.
    const driver = MirrorPanel.current?.driver ?? (await pickDevice());
    if (!driver) return;

    const run = this.controller.createTestRun(request);
    for (const item of this.itemsFor(request)) {
      if (token.isCancellationRequested) {
        run.skipped(item);
        continue;
      }
      await this.replayOne(run, item, driver, token);
    }
    run.end();
  }

  private async replayOne(
    run: vscode.TestRun,
    item: vscode.TestItem,
    driver: import('./deviceDriver').DeviceDriver,
    token: vscode.CancellationToken
  ): Promise<void> {
    run.started(item);

    const parentUri = item.uri;
    const fromIndex = FlowTestController.stepIndexOf(item) ?? 0;
    if (!parentUri) {
      run.errored(item, new vscode.TestMessage('Flow has no file path.'));
      return;
    }

    let steps: FlowStep[];
    try {
      const bytes = await vscode.workspace.fs.readFile(parentUri);
      steps = parseFlowSteps(Buffer.from(bytes).toString('utf8'));
    } catch (err: any) {
      run.errored(item, new vscode.TestMessage(`Could not read the flow: ${err.message}`));
      return;
    }

    // Children exist only on the parent flow item, keyed by their own step index - replaying
    // the parent should still report each child's outcome as it happens.
    const children = new Map<number, vscode.TestItem>();
    item.children.forEach((c) => {
      const idx = FlowTestController.stepIndexOf(c);
      if (idx !== undefined) children.set(idx, c);
    });

    const started = Date.now();
    const outcome = await replaySteps(
      driver,
      steps.slice(fromIndex).map((s) => s.value),
      (offset, result) => {
        const child = children.get(fromIndex + offset);
        if (!child) return;
        if (result === 'ok') run.passed(child);
        else if (result === 'skipped') run.skipped(child);
        else run.failed(child, new vscode.TestMessage('Step failed during replay.'));
      }
    );
    const duration = Date.now() - started;

    if (token.isCancellationRequested) {
      run.skipped(item);
      return;
    }

    const summary = summariseReplay(outcome);
    run.appendOutput(`\r\n${summary}\r\n`);

    if (outcome.failedAt !== undefined) {
      const line = steps[fromIndex + outcome.failedAt]?.line ?? item.range?.start.line ?? 0;
      const message = new vscode.TestMessage(summary);
      message.location = new vscode.Location(parentUri, new vscode.Position(line, 0));
      run.failed(item, message, duration);
      return;
    }
    run.passed(item, duration);
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

  /**
   * Writes a temporary flow containing the setup prefix plus the chosen step onward, since
   * Maestro has no "run from step N". The file lives beside the original so relative paths
   * (runFlow, runScript, takeScreenshot) still resolve.
   */
  private async writePartialFlow(flowPath: string, fromIndex: number): Promise<string | undefined> {
    try {
      const text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(flowPath))).toString('utf8');
      const docs = yaml.loadAll(text) as any[];
      const header = docs.length >= 2 ? docs[0] : {};
      const steps = (docs.length >= 2 ? docs[1] : docs[0]) as any[];
      if (!Array.isArray(steps)) return undefined;

      const partial = buildPartialFlow(header || {}, steps, fromIndex);
      const target = path.join(
        path.dirname(flowPath),
        `.flow-recorder-step-${fromIndex + 1}.flow.yaml`
      );
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(partial, 'utf8'));
      return target;
    } catch {
      return undefined;
    }
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

    const stepIndex = FlowTestController.stepIndexOf(item);
    let target = flowPath;
    let temporary: string | undefined;

    if (stepIndex !== undefined) {
      temporary = await this.writePartialFlow(flowPath, stepIndex);
      if (!temporary) {
        run.errored(item, new vscode.TestMessage('Could not build a flow starting at this step.'));
        return;
      }
      target = temporary;
    }

    const debugOutput = debug
      ? path.join(path.dirname(flowPath), '.maestro-debug', path.basename(flowPath).replace(/\.(flow\.)?ya?ml$/, ''))
      : undefined;

    // Target the device the mirror is on; otherwise maestro picks (and boots) its own.
    const mirror = MirrorPanel.current;
    const args = buildMaestroArgs(
      this.environments.activeEnvironment(),
      target,
      mirror?.driver.platform ?? this.environments.activePlatform(),
      { debugOutput, flattenDebugOutput: !!debugOutput, deviceId: mirror?.driver.deviceId }
    );

    const started = Date.now();
    run.appendOutput(`\r\n$ ${this.maestroCommand()} ${args.join(' ')}\r\n`);

    let output = '';
    const code = await new Promise<number>((resolve) => {
      const child = spawn(this.maestroCommand(), args, {
        cwd: vscode.workspace.getWorkspaceFolder(item.uri!)?.uri.fsPath
      });
      const append = (buf: Buffer) => {
        output += buf.toString();
        // The Testing output pane is a terminal: bare \n leaves a staircase.
        run.appendOutput(buf.toString().replace(/\r?\n/g, '\r\n'));
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      token.onCancellationRequested(() => child.kill());
      child.on('error', (err) => {
        run.appendOutput(`\r\nCould not start maestro: ${err.message}\r\n`);
        resolve(-1);
      });
      child.on('close', (c) => resolve(c ?? -1));
    });

    if (temporary) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(temporary));
      } catch {
        // Leaving a temp flow behind is untidy but not worth failing the run over.
      }
    }

    const duration = Date.now() - started;
    if (token.isCancellationRequested) {
      run.skipped(item);
      return;
    }
    if (code === 0) {
      run.passed(item, duration);
      if (stepIndex === undefined) this.markSteps(run, item, undefined);
      return;
    }

    const failureLine = this.failureMessage(output);
    const message = new vscode.TestMessage(
      code === -1
        ? 'maestro could not be started - is it installed and on your PATH?'
        : `${failureLine || `Flow failed (exit ${code}).`}${debugOutput ? `\nArtifacts: ${debugOutput}` : ''}`
    );
    message.location = new vscode.Location(item.uri!, new vscode.Position(item.range?.start.line ?? 0, 0));
    run.failed(item, message, duration);

    if (stepIndex === undefined) this.markSteps(run, item, failureLine);
  }

  /** Maestro prints the reason in brackets on its summary line. */
  private failureMessage(output: string): string | undefined {
    // e.g. [Failed] probe (18s) (Assertion is false: "X" is visible)
    const m = output.match(/\[Failed\][^\n(]*\([^)]*\)\s*\((.+?)\)\s*$/m);
    return m ? m[1].trim() : undefined;
  }

  /**
   * Maestro reports per flow, not per step, so step states are reconstructed: the step named
   * in the failure message failed, everything before it passed, everything after never ran.
   */
  private markSteps(run: vscode.TestRun, parent: vscode.TestItem, failure: string | undefined): void {
    const children: vscode.TestItem[] = [];
    parent.children.forEach((c) => children.push(c));
    if (!children.length) return;

    if (!failure) {
      for (const child of children) run.passed(child);
      return;
    }

    const steps = children
      .map((c) => FlowTestController.stepIndexOf(c))
      .filter((n): n is number => n !== undefined);
    const failedAt = attributeFailure(failure, steps.map((index) => ({ index, line: 0, value: null })));

    for (const child of children) {
      const index = FlowTestController.stepIndexOf(child);
      if (index === undefined) continue;
      if (failedAt === undefined) {
        run.skipped(child);
      } else if (index < failedAt) {
        run.passed(child);
      } else if (index === failedAt) {
        run.failed(child, new vscode.TestMessage(failure));
      } else {
        run.skipped(child);
      }
    }
  }

  public dispose(): void {
    this.controller.dispose();
  }
}
