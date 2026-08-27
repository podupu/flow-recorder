/**
 * Finds file paths inside a flow so the editor can turn them into clickable links.
 *
 * Only commands that genuinely take a path are considered - `inputText: subflows/x` is text,
 * not a reference. Maestro `${...}` expressions are skipped: they resolve at run time, so
 * there is no file to open.
 */

export interface FlowLink {
  /** Zero-based line index. */
  line: number;
  /** Column span of the path itself, excluding any quotes. */
  startCol: number;
  endCol: number;
  path: string;
  /** The command the path came from - `takeScreenshot` implies a .png when no suffix is given. */
  key: string;
}

/** Commands whose scalar value is a path relative to the flow file. */
const PATH_KEYS = ['runFlow', 'runScript', 'takeScreenshot'];

// `- runFlow: value` / `runFlow: value`, at any indentation.
const KEY_RE = new RegExp(`^(\\s*(?:-\\s*)?(${PATH_KEYS.join('|')}|file)\\s*:\\s*)(\\S.*)$`);

export function findFlowLinks(text: string): FlowLink[] {
  const links: FlowLink[] = [];
  const lines = (text || '').split('\n');

  lines.forEach((line, index) => {
    if (/^\s*#/.test(line)) return;

    const m = KEY_RE.exec(line);
    if (!m) return;

    const prefixLength = m[1].length;
    const key = m[2];
    let value = m[3];

    // Drop a trailing inline comment, but only when it is clearly separated - a '#' can
    // legitimately appear inside a quoted path.
    const comment = value.search(/\s+#/);
    if (comment !== -1) value = value.slice(0, comment);
    value = value.trimEnd();
    if (!value) return;

    let start = prefixLength;
    let end = prefixLength + value.length;

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
      start += 1;
      end -= 1;
    }

    // Runtime expressions have no file to point at.
    if (!value || value.includes('${')) return;

    links.push({ line: index, startCol: start, endCol: end, path: value, key });
  });

  return links;
}
