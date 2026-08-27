export interface UiNode {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Index of this node's parent in the parsed array, or -1 for the root. */
  parentId?: number;
}

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
 * uiautomator dump XML is a plain nested tree of <node ...> elements. We walk it with a
 * stack so every parsed node knows its parent (for walking up to a labeled ancestor), while
 * still avoiding a full XML parser dependency.
 */
export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const stack: number[] = [];
  const NODE_RE = /<node\b([^>]*?)(\/)?>|<\/node\s*>/g;
  let m: RegExpExecArray | null;
  NODE_RE.lastIndex = 0;
  while ((m = NODE_RE.exec(xml))) {
    if (m[0].charAt(1) === '/') {
      stack.pop();
      continue;
    }
    const attrs = parseAttrs(m[1]);
    if (!attrs.bounds) continue;
    const bounds = parseBounds(attrs.bounds);
    if (!bounds) continue;
    const node: UiNode = {
      text: attrs.text || undefined,
      resourceId: attrs['resource-id'] || undefined,
      contentDesc: attrs['content-desc'] || undefined,
      className: attrs.class || undefined,
      bounds,
      parentId: stack.length ? stack[stack.length - 1] : -1
    };
    nodes.push(node);
    if (!m[2]) stack.push(nodes.length - 1);
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

export function hasLabel(node: UiNode): boolean {
  return Boolean((node.text && node.text.trim()) || node.resourceId || node.contentDesc);
}

export function isSelectable(node: UiNode, screen: { width: number; height: number }): boolean {
  const { left, top, right, bottom } = node.bounds;
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return false;
  if (w * h > screen.width * screen.height * 0.9) return false;
  return hasLabel(node);
}

/** Walks up the ancestor chain to the nearest node with a readable label; returns the original node if none found. */
export function nearestLabeledAncestor(node: UiNode, nodes: UiNode[]): UiNode {
  let current: UiNode | undefined = node;
  while (current && !hasLabel(current)) {
    const p: UiNode | undefined =
      current.parentId !== undefined && current.parentId >= 0 ? nodes[current.parentId] : undefined;
    if (!p) break;
    current = p;
  }
  return current || node;
}

/** Deepest node at the point, then walked up to its nearest labeled ancestor. */
export function findLabeledNodeAtPoint(nodes: UiNode[], x: number, y: number): UiNode | undefined {
  const node = findSmallestNodeAtPoint(nodes, x, y);
  return node ? nearestLabeledAncestor(node, nodes) : undefined;
}

