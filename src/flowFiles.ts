/**
 * Which files count as Maestro flows.
 *
 * The defaults are Maestro's own convention, taken from the official SchemaStore entry:
 * `*.flow.yaml` anywhere, plus any `.yaml`/`.yml` inside a `.maestro/` directory. Matching
 * every `.yaml` instead would sweep in docker-compose files, CI workflows and k8s manifests -
 * they would gain Flow Recorder commands and appear in the Testing view, which is worse than
 * missing a flow.
 *
 * Teams with a different layout override `flowRecorder.flowPatterns`; custom patterns replace
 * the defaults rather than extending them, so an explicit list is exactly what you get.
 */

export const DEFAULT_FLOW_PATTERNS = [
  '**/*.flow.yaml',
  '**/*.flow.yml',
  '**/.maestro/**/*.yaml',
  '**/.maestro/**/*.yml'
];

/**
 * Minimal glob → RegExp. Supports `**` (any depth, including none), `*` (within one segment)
 * and `?`. Everything else is escaped, so dots stay literal.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];

    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` collapses to "zero or more directories" so the pattern also matches at root.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]*/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      continue;
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * Matches `patterns` against the path and against each of its suffixes at a directory
 * boundary. A user writes `e2e-tests/**\/*.yaml` meaning "relative to the workspace", but the
 * caller usually has an absolute path - testing suffixes makes both work without this function
 * needing to know where the workspace root is.
 */
export function isFlowFile(fsPath: string | undefined, patterns: string[] = DEFAULT_FLOW_PATTERNS): boolean {
  if (!fsPath || !patterns.length) return false;

  const normalised = fsPath.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '').replace(/^\/+/, '');
  const segments = normalised.split('/');
  const candidates: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    candidates.push(segments.slice(i).join('/'));
  }

  return patterns.some((pattern) => {
    const re = globToRegExp(pattern);
    return candidates.some((candidate) => re.test(candidate));
  });
}
