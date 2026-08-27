import * as yaml from 'js-yaml';

/**
 * Text-level editing of a flow file.
 *
 * Rewriting the whole document through `yaml.dump` (as writeFlowDocument does) discards
 * comments, blank lines, quoting style and key order. That is invisible behind a block UI, but
 * destructive once the flow is edited as YAML by hand - so recorded steps are spliced in as
 * text instead, leaving the rest of the file byte-for-byte intact.
 */

/** Serialises one step as a YAML sequence item, e.g. `- tapOn:\n    text: Login\n`. */
export function stepToYamlItem(step: any): string {
  // lineWidth: -1 disables folding; a wrapped `${...}` expression would no longer parse.
  return yaml.dump([step], { lineWidth: -1 });
}

export function stepsToYamlItems(steps: any[]): string {
  return steps.map(stepToYamlItem).join('');
}

/** A new top-level step starts at column 0 with "- ". */
function isStepStart(line: string): boolean {
  return /^-\s/.test(line) || /^-$/.test(line.trimEnd());
}

/** First line of the steps section: just after the `---` separator, if there is one. */
function stepsStartLine(lines: string[]): number {
  const sep = lines.findIndex((l) => l.trimEnd() === '---');
  return sep === -1 ? 0 : sep + 1;
}

/**
 * Line to insert a new step at, given where the cursor is: immediately after the step the
 * cursor is inside, so a multi-line mapping is never split down the middle.
 */
export function insertionLine(lines: string[], cursorLine: number): number {
  const start = stepsStartLine(lines);
  if (cursorLine < start) return Math.min(start, lines.length);

  const from = Math.min(cursorLine, lines.length - 1);
  for (let i = from + 1; i < lines.length; i += 1) {
    if (isStepStart(lines[i])) return i;
  }
  return lines.length;
}
