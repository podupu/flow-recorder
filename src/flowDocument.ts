import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

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

export async function appendFlowStep(document: vscode.TextDocument, step: any): Promise<void> {
  const parsed = parseFlowDocument(document);
  parsed.steps.push(step);
  await writeFlowDocument(document, parsed);
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
