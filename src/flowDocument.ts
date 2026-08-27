import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { stepsToYamlItems, insertionLine } from './flowText';

export interface FlowDoc {
  config: Record<string, any>;
  steps: any[];
}

export function parseFlowDocument(document: vscode.TextDocument): FlowDoc {
  const text = document.getText();
  if (!text.trim()) {
    return { config: { appId: 'com.example.app' }, steps: [] };
  }
  try {
    const docs = yaml.loadAll(text) as any[];
    if (docs.length >= 2) {
      return { config: docs[0] || {}, steps: (docs[1] as any[]) || [] };
    }
    return { config: {}, steps: (docs[0] as any[]) || [] };
  } catch {
    // Malformed YAML (e.g. mid-edit) - treat as empty rather than crash the caller.
    return { config: {}, steps: [] };
  }
}

export async function writeFlowDocument(document: vscode.TextDocument, parsed: FlowDoc): Promise<void> {
  const configYaml = yaml.dump(parsed.config || {});
  const stepsYaml = yaml.dump(parsed.steps || []);
  const fullText = `${configYaml}---\n${stepsYaml}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), fullText);
  await vscode.workspace.applyEdit(edit);
}

/**
 * Appends a step by inserting text at the end of the file, rather than re-dumping the whole
 * document. Everything already written - comments, blank lines, quoting, key order - survives.
 */
export async function appendFlowStep(document: vscode.TextDocument, step: any): Promise<void> {
  await appendFlowSteps(document, [step]);
}

export async function appendFlowSteps(document: vscode.TextDocument, steps: any[]): Promise<void> {
  if (!steps.length) return;
  const text = stepsToYamlItems(steps);
  const full = document.getText();
  const end = document.lineAt(document.lineCount - 1).range.end;
  const edit = new vscode.WorkspaceEdit();
  // A file not ending in a newline would otherwise glue the new item onto the last line.
  edit.insert(document.uri, end, `${full.endsWith('\n') || full.length === 0 ? '' : '\n'}${text}`);
  await vscode.workspace.applyEdit(edit);
}

/** Inserts steps after the step the cursor is inside, preserving the rest of the file. */
export async function insertFlowStepsAtLine(
  document: vscode.TextDocument,
  cursorLine: number,
  steps: any[]
): Promise<void> {
  if (!steps.length) return;
  const lines = document.getText().split('\n');
  const line = insertionLine(lines, cursorLine);
  if (line >= document.lineCount) {
    await appendFlowSteps(document, steps);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(line, 0), stepsToYamlItems(steps));
  await vscode.workspace.applyEdit(edit);
}

export async function deleteFlowStep(document: vscode.TextDocument, index: number): Promise<void> {
  const parsed = parseFlowDocument(document);
  parsed.steps.splice(index, 1);
  await writeFlowDocument(document, parsed);
}

export async function updateStep(
  document: vscode.TextDocument,
  index: number,
  patch: Record<string, any>
): Promise<void> {
  const parsed = parseFlowDocument(document);
  if (index < 0 || index >= parsed.steps.length) return;
  parsed.steps[index] = { ...parsed.steps[index], ...patch };
  await writeFlowDocument(document, parsed);
}
