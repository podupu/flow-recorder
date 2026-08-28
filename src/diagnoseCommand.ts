import * as vscode from 'vscode';
import { isFlowDocument } from './flowContext';
import * as yaml from 'js-yaml';
import { diagnoseFlow, Diagnosis } from './diagnose';
import { pickDevice } from './devicePicker';
import { MirrorPanel } from './mirrorPanel';
import { DeviceDriver } from './deviceDriver';

const COLLECTION = vscode.languages.createDiagnosticCollection('flowRecorder');

/** Line each step starts on, so a report can point at the right place in the file. */
function stepLines(text: string): number[] {
  const lines: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (/^-\s/.test(line) || /^-$/.test(line.trimEnd())) lines.push(i);
  });
  return lines;
}

function describe(selector: { text?: string; id?: string }): string {
  if (selector.text !== undefined) return `text: ${selector.text}`;
  if (selector.id !== undefined) return `id: ${selector.id}`;
  return JSON.stringify(selector);
}

function report(document: vscode.TextDocument, result: Diagnosis): void {
  const lines = stepLines(document.getText());
  const diagnostics: vscode.Diagnostic[] = [];

  for (const broken of result.broken) {
    const line = lines[broken.index] ?? 0;
    const range = document.lineAt(Math.min(line, document.lineCount - 1)).range;
    const suggestion = broken.suggestion
      ? `  Did you mean ${describe({
          text: broken.suggestion.text,
          id: broken.suggestion.text ? undefined : broken.suggestion.resourceId
        })}?`
      : '  No similar element found on screen.';
    diagnostics.push(
      new vscode.Diagnostic(
        range,
        `${broken.command} selector no longer matches: ${describe(broken.selector)}.${suggestion}`,
        vscode.DiagnosticSeverity.Warning
      )
    );
  }
  COLLECTION.set(document.uri, diagnostics);
}

/**
 * Checks every selector in the open flow against the live screen.
 *
 * Deliberately manual and free: it answers "which selector went stale?" — the question that
 * actually costs time once a suite exists — without pretending to fix anything automatically.
 */
export async function diagnoseSelectors(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isFlowDocument(editor.document)) {
    vscode.window.showErrorMessage('Open a Maestro flow to diagnose its selectors.');
    return;
  }

  let steps: unknown;
  try {
    const docs = yaml.loadAll(editor.document.getText()) as any[];
    steps = docs.length >= 2 ? docs[1] : docs[0];
  } catch (err: any) {
    vscode.window.showErrorMessage(`Could not parse the flow: ${err.message}`);
    return;
  }

  // Reuse the device an open mirror is already attached to, so this costs no extra setup.
  const driver: DeviceDriver | undefined = MirrorPanel.current?.driver ?? (await pickDevice());
  if (!driver) return;

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Checking selectors against the screen...' },
    async () => diagnoseFlow(steps, await driver.elements())
  );

  report(editor.document, result);

  const { matched, broken, skipped } = result;
  if (!broken.length) {
    vscode.window.showInformationMessage(
      `All ${matched.length} selectors still match${skipped.length ? ` (${skipped.length} skipped — contain variables)` : ''}.`
    );
    return;
  }

  const withFix = broken.filter((b) => b.suggestion).length;
  vscode.window.showWarningMessage(
    `${broken.length} selector${broken.length === 1 ? '' : 's'} no longer match` +
      `${withFix ? `, ${withFix} with a suggested replacement` : ''}. ` +
      `${matched.length} still fine. See Problems.`,
    'Show Problems'
  ).then((choice) => {
    if (choice === 'Show Problems') void vscode.commands.executeCommand('workbench.actions.view.problems');
  });
}

export function disposeDiagnostics(): vscode.Disposable {
  return COLLECTION;
}
