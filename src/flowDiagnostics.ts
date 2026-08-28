import * as vscode from 'vscode';
import { DEFAULT_FLOW_PATTERNS, isFlowFile } from './flowFiles';
import { flowPatterns } from './flowContext';

/**
 * Reports what the extension actually sees when deciding whether a file is a flow.
 *
 * "My pattern is set but it still says no flow is open" has several possible causes — a
 * setting written at the wrong scope, a second copy of the extension shadowing this one, or a
 * path that genuinely does not match. Guessing between them wastes far more time than printing
 * the inputs and letting the answer be obvious.
 */
export async function showFlowDiagnostics(): Promise<void> {
  const config = vscode.workspace.getConfiguration('flowRecorder');
  const inspected = config.inspect<string[]>('flowPatterns');
  const patterns = flowPatterns();

  // Where the effective value came from - a setting written at the wrong scope is a common
  // cause, and `inspect` is the only way to tell the difference.
  const scopes: string[] = [];
  if (inspected?.workspaceFolderValue) scopes.push('folder');
  if (inspected?.workspaceValue) scopes.push('workspace');
  if (inspected?.globalValue) scopes.push('user');
  const source = scopes.length ? scopes.join(' + ') : 'default (no setting found)';

  const editor = vscode.window.activeTextEditor;
  const activePath = editor?.document.uri.fsPath;

  const lines: string[] = [];
  lines.push('Flow Recorder — flow detection');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Extension path : ${vscode.extensions.getExtension('podupu.flow-recorder')?.extensionPath ?? 'not resolved'}`);
  lines.push('');
  lines.push(`Patterns from  : ${source}`);
  for (const p of patterns) lines.push(`                 ${p}`);
  if (!scopes.length) {
    lines.push('');
    lines.push('  Using built-in defaults. If you set flowRecorder.flowPatterns and expected');
    lines.push('  it here, it was written to a scope this window is not reading.');
  }
  lines.push('');
  lines.push(`Active editor  : ${activePath ?? '(none — no text editor focused)'}`);
  if (activePath) {
    lines.push(`Matches?       : ${isFlowFile(activePath, patterns) ? 'YES' : 'NO'}`);
    if (!isFlowFile(activePath, patterns) && isFlowFile(activePath, DEFAULT_FLOW_PATTERNS)) {
      lines.push('                 (it WOULD match the built-in defaults — your custom');
      lines.push('                  patterns replace the defaults rather than adding to them)');
    }
  }

  lines.push('');
  lines.push('Open tabs:');
  let any = false;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input: any = tab.input;
      const uri: vscode.Uri | undefined = input?.uri;
      if (!uri || !/\.ya?ml$/i.test(uri.fsPath)) continue;
      any = true;
      const ok = isFlowFile(uri.fsPath, patterns);
      lines.push(`  [${ok ? 'flow' : '    '}] ${vscode.workspace.asRelativePath(uri)}`);
    }
  }
  if (!any) lines.push('  (no YAML tabs open)');

  lines.push('');
  lines.push('If a file you expect is marked [    ], adjust flowRecorder.flowPatterns.');
  lines.push('If everything looks right but commands still fail, check you do not have both');
  lines.push('an installed copy and an Extension Development Host running the same extension.');

  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'text' });
  await vscode.window.showTextDocument(doc, { preview: true });
}
