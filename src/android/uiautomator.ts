export interface UiNode {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
}

const NODE_REGEX = /<node\b([^>]*)\/?>/g;
const ATTR_REGEX = /(\w[\w-]*)="([^"]*)"/g;

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_REGEX.lastIndex = 0;
  while ((m = ATTR_REGEX.exec(attrString))) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function parseBounds(boundsStr: string) {
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] };
}

/**
 * uiautomator dump XML is a plain nested tree of <node ...> elements. We don't need the
 * parent/child structure for hit-testing - just every node's bounds + identifying attributes -
 * so a regex scan avoids pulling in a full XML parser dependency.
 */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  let match: RegExpExecArray | null;
  NODE_REGEX.lastIndex = 0;
  while ((match = NODE_REGEX.exec(xml))) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.bounds) continue;
    const bounds = parseBounds(attrs.bounds);
    if (!bounds) continue;
    nodes.push({
      text: attrs.text || undefined,
      resourceId: attrs['resource-id'] || undefined,
      contentDesc: attrs['content-desc'] || undefined,
      className: attrs.class || undefined,
      bounds
    });
  }
  return nodes;
}

/** Finds the smallest-area node whose bounds contain the point - i.e. the most specific element tapped. */
export function findSmallestNodeAtPoint(nodes: UiNode[], x: number, y: number): UiNode | undefined {
  let best: UiNode | undefined;
  let bestArea = Infinity;
  for (const n of nodes) {
    const { left, top, right, bottom } = n.bounds;
    if (x >= left && x <= right && y >= top && y <= bottom) {
      const area = (right - left) * (bottom - top);
      if (area > 0 && area < bestArea) {
        best = n;
        bestArea = area;
      }
    }
  }
  return best;
}

export type ElementSelector = { text?: string; id?: string; point?: string };

export function resolveElementSelector(
  node: UiNode | undefined,
  x: number,
  y: number,
  screen: { width: number; height: number }
): ElementSelector {
  if (node?.text) return { text: node.text };
  if (node?.contentDesc) return { text: node.contentDesc };
  if (node?.resourceId) return { id: node.resourceId };
  const pct = `${Math.round((x / screen.width) * 100)}%,${Math.round((y / screen.height) * 100)}%`;
  return { point: pct };
}

export function toMaestroStep(
  command: string,
  node: UiNode | undefined,
  x: number,
  y: number,
  screen: { width: number; height: number }
): any {
  return { [command]: resolveElementSelector(node, x, y, screen) };
}

export interface SelectableUiNode extends UiNode {
  elementId: number;
}

export function filterSelectableNodes(
  nodes: UiNode[],
  screen: { width: number; height: number }
): SelectableUiNode[] {
  const screenArea = screen.width * screen.height;
  const result: SelectableUiNode[] = [];
  for (const node of nodes) {
    const { left, top, right, bottom } = node.bounds;
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) continue;
    if (w * h > screenArea * 0.9) continue;
    const hasLabel = Boolean((node.text && node.text.trim()) || node.resourceId || node.contentDesc);
    if (!hasLabel) continue;
    result.push({ ...node, elementId: result.length });
  }
  return result;
}

/**
 * Delegating shim: kept so the compile gate stays green until the mirror panel switches over
 * to `toMaestroStep` in a later task.
 */
export function toMaestroSelector(
  node: UiNode | undefined,
  x: number,
  y: number,
  screen: { width: number; height: number }
): any {
  return { tapOn: resolveElementSelector(node, x, y, screen) };
}
