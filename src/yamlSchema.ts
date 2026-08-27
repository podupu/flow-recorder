import * as vscode from 'vscode';

/**
 * Points the YAML language server at the official Maestro Flow schema for `.flow.yaml`.
 *
 * SchemaStore has a genuine collision on this pattern: both "Maestro Flow"
 * (`**\/*.flow.yaml`) and "Estuary Flow Catalog" (`*.flow.yaml`) claim it, and Estuary wins
 * the auto-match - producing `Incorrect type. Expected "Estuary Flow Catalog"` on a perfectly
 * valid Maestro flow.
 *
 * Registering a contributor with redhat.vscode-yaml takes precedence over SchemaStore, and
 * serving the schema from disk means validation and command autocomplete work offline.
 */

const SCHEMA_URI = 'flow-recorder://schemas/maestro-flow.json';

interface YamlExtensionApi {
  registerContributor(
    schema: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent: (uri: string) => string | undefined,
    label?: string
  ): boolean;
}

export async function registerMaestroFlowSchema(context: vscode.ExtensionContext): Promise<void> {
  const yamlExt = vscode.extensions.getExtension<YamlExtensionApi>('redhat.vscode-yaml');
  if (!yamlExt) {
    // Without the YAML extension there is no schema validation at all - and no wrong schema
    // either, so there is nothing to correct.
    return;
  }

  let schemaText: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(context.extensionUri, 'schemas', 'maestro-flow.json')
    );
    schemaText = Buffer.from(bytes).toString('utf8');
  } catch (err: any) {
    console.error('Flow Recorder: bundled Maestro schema missing', err);
    return;
  }

  try {
    const api = await yamlExt.activate();
    if (!api || typeof api.registerContributor !== 'function') return;
    api.registerContributor(
      'flow-recorder',
      (resource) => (resource.endsWith('.flow.yaml') || resource.endsWith('.flow.yml') ? SCHEMA_URI : undefined),
      (uri) => (uri === SCHEMA_URI ? schemaText : undefined),
      'Maestro Flow'
    );
  } catch (err: any) {
    console.error('Flow Recorder: could not register the Maestro schema', err);
  }
}
