import * as vscode from 'vscode';
import { findFlowLinks } from './flowLinks';
import { isFlowDocument } from './flowContext';

/**
 * Makes referenced files clickable in a flow: `runFlow: subflows/demographics.flow.yaml`
 * becomes a link that opens that flow, the way Go to Definition would.
 *
 * Paths are resolved relative to the flow file, which is how Maestro resolves them.
 */
export class FlowLinkProvider implements vscode.DocumentLinkProvider {
  public static register(): vscode.Disposable {
    return vscode.languages.registerDocumentLinkProvider(
      // Every yaml document; provideDocumentLinks returns nothing for non-flows.
      [{ language: 'yaml' }],
      new FlowLinkProvider()
    );
  }

  public provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (!isFlowDocument(document)) return [];
    return findFlowLinks(document.getText()).map((found) => {
      const range = new vscode.Range(found.line, found.startCol, found.line, found.endCol);
      const link = new vscode.DocumentLink(range, this.resolveTarget(document.uri, found.path, found.key));
      link.tooltip = `Open ${found.path}`;
      return link;
    });
  }

  /** Maestro appends .png to a takeScreenshot name that has no suffix. */
  private resolveTarget(flowUri: vscode.Uri, relPath: string, key: string): vscode.Uri {
    const withSuffix = key === 'takeScreenshot' && !/\.[A-Za-z0-9]+$/.test(relPath) ? `${relPath}.png` : relPath;
    return vscode.Uri.joinPath(flowUri, '..', withSuffix);
  }
}
