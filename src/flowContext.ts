import * as vscode from 'vscode';
import { DEFAULT_FLOW_PATTERNS, isFlowFile } from './flowFiles';

/**
 * `when` clauses cannot evaluate a user-configured glob, so the extension maintains a context
 * key instead. Menus test `flowRecorder.isFlowFile`, which stays correct when someone points
 * `flowRecorder.flowPatterns` at their own layout.
 */
const CONTEXT_KEY = 'flowRecorder.isFlowFile';

export function flowPatterns(): string[] {
  const configured = vscode.workspace
    .getConfiguration('flowRecorder')
    .get<string[]>('flowPatterns');
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_FLOW_PATTERNS;
}

export function isFlow(fsPath: string | undefined): boolean {
  return isFlowFile(fsPath, flowPatterns());
}

export function isFlowDocument(document: vscode.TextDocument | undefined): boolean {
  return !!document && isFlow(document.uri.fsPath);
}

function refresh(): void {
  void vscode.commands.executeCommand(
    'setContext',
    CONTEXT_KEY,
    isFlowDocument(vscode.window.activeTextEditor?.document)
  );
}

export function registerFlowContext(): vscode.Disposable[] {
  refresh();
  return [
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flowRecorder.flowPatterns')) refresh();
    })
  ];
}
