# Labeled Element Resolution (Maestro-Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make element selection on the mirror match how Maestro Studio works: when the user hovers/right-clicks/taps a point, resolve it to the nearest **labeled** element by walking up the UI-hierarchy ancestors, so the recorded command uses text (`tapOn: "Login"`) instead of falling back to coordinates. Also remove the Elements list panel so selection happens directly on the mirrored screen.

**Architecture:** The root cause is that the uiautomator parser flattens the XML tree, so it cannot find a labeled ancestor when the deepest element under a point has no text/id. This plan makes the parser hierarchy-aware (`parentId` on every node), adds ancestor-walking resolution, removes the Elements panel, and rewires hover/tap/right-click to use the labeled resolution.

**Tech Stack:** TypeScript (vscode), plain webview JS (IIFE), CSS. Gate: `npm run test:unit` + `node --check media/mirror.js`.

## Global Constraints

- Pure module (`src/android/uiautomator.ts`) must NOT import `vscode` — unit-tested in plain Node via Mocha.
- `npm run test:unit` must stay green (tests updated to match the new API).
- Webview files stay plain IIFEs. Gate with `node --check`.
- The message contract is unchanged except the `elements` payload gains `parentId` and `selectable` and `elementId` now indexes ALL parsed nodes (not just filtered ones). No new message types.
- Element text/id is untrusted UI data — build DOM with `textContent`, never innerHTML with element data.
- Commit only the files this task touches (`src/android/uiautomator.ts`, `test/unit/uiautomator.test.js`, `src/mirrorPanel.ts`, `media/mirror.js`, `media/mirror.css`). Do NOT stage the user's untracked/modified test files (`examples/example.flow.yaml`, `examples/assets/`, `.vscode/settings.json`).

---

### Task 1: Hierarchy-aware parser + labeled resolution + remove Elements panel

**Files:**
- Modify: `src/android/uiautomator.ts`
- Modify: `test/unit/uiautomator.test.js`
- Modify: `src/mirrorPanel.ts`
- Modify: `media/mirror.js`
- Modify: `media/mirror.css`

**Interfaces:**
- Produces (uiautomator):
  - `UiNode` gains optional `parentId?: number` (index into the parsed array; `-1` = root).
  - `export function parseUiNodes(xml: string): UiNode[]` — now hierarchy-aware (stack-based).
  - `export function hasLabel(node: UiNode): boolean`
  - `export function isSelectable(node: UiNode, screen): boolean` (replaces `filterSelectableNodes`/`SelectableUiNode`).
  - `export function nearestLabeledAncestor(node, nodes): UiNode`
  - `export function findLabeledNodeAtPoint(nodes, x, y): UiNode | undefined`
  - `findSmallestNodeAtPoint`, `resolveElementSelector`, `toMaestroStep` unchanged.
- Consumes (mirrorPanel): `parseUiNodes`, `findLabeledNodeAtPoint`, `isSelectable`, `resolveElementSelector`, `UiNode`.
- Consumes (mirror.js): the payload with `parentId` + `selectable`.

- [ ] **Step 1: Rewrite `src/android/uiautomator.ts`**

Replace the `UiNode` interface, `parseUiNodes`, and the selectable helpers. Keep `ATTR_REGEX`, `parseAttrs`, `parseBounds`, `findSmallestNodeAtPoint`, `resolveElementSelector`, `toMaestroStep` as they are (only `UiNode` gets `parentId`).

```ts
export interface UiNode {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Index of this node's parent in the parsed array, or -1 for the root. */
  parentId?: number;
}
```

Replace `parseUiNodes`:

```ts
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
```

Replace the `SelectableUiNode` + `filterSelectableNodes` block with:

```ts
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
    const p = current.parentId !== undefined && current.parentId >= 0 ? nodes[current.parentId] : undefined;
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
```

- [ ] **Step 2: Update `test/unit/uiautomator.test.js`**

Replace the file's contents (keeping the resolveElementSelector test; removing the `filterSelectableNodes` test):

```js
const assert = require('assert');
const {
  parseUiNodes,
  isSelectable,
  findLabeledNodeAtPoint,
  resolveElementSelector
} = require('../../out/android/uiautomator');

const XML = `<hierarchy>
  <node text="" resource-id="" content-desc="" class="android.widget.LinearLayout" bounds="[0,0][1080,1920]">
    <node text="Settings" resource-id="" content-desc="" class="android.widget.Button" bounds="[0,0][200,100]">
      <node text="" resource-id="" content-desc="" class="android.widget.View" bounds="[0,0][200,100]"/>
    </node>
    <node text="" resource-id="com.app:id/email" content-desc="" class="android.widget.EditText" bounds="[10,100][200,150]"/>
  </node>
</hierarchy>`;

describe('uiautomator', () => {
  it('parses nodes with parent links', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(nodes.length, 4);
    assert.strictEqual(nodes[0].parentId, -1);
    assert.strictEqual(nodes[1].parentId, 0);
    assert.strictEqual(nodes[2].parentId, 1);
    assert.strictEqual(nodes[3].parentId, 0);
  });

  it('walks up to the nearest labeled ancestor at a point', () => {
    const nodes = parseUiNodes(XML);
    const n = findLabeledNodeAtPoint(nodes, 100, 50);
    assert.strictEqual(n.text, 'Settings');
  });

  it('returns the labeled node itself when deepest is labeled', () => {
    const nodes = parseUiNodes(XML);
    const n = findLabeledNodeAtPoint(nodes, 100, 125);
    assert.strictEqual(n.resourceId, 'com.app:id/email');
  });

  it('isSelectable filters by label and size', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.strictEqual(isSelectable(nodes[0], screen), false);
    assert.strictEqual(isSelectable(nodes[1], screen), true);
    assert.strictEqual(isSelectable(nodes[2], screen), false);
  });

  it('resolves selector preferring text, then content-desc, then id, then point', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.deepStrictEqual(resolveElementSelector(nodes[1], 0, 0, screen), { text: 'Settings' });
    assert.deepStrictEqual(resolveElementSelector(nodes[3], 0, 0, screen), { id: 'com.app:id/email' });
    assert.deepStrictEqual(resolveElementSelector(nodes[0], 0, 0, screen), { point: '0%,0%' });
  });
});
```

- [ ] **Step 3: Update `src/mirrorPanel.ts`**

3a. Imports — change to:

```ts
import {
  parseUiNodes,
  findLabeledNodeAtPoint,
  resolveElementSelector,
  isSelectable,
  UiNode
} from './android/uiautomator';
```

(remove `findSmallestNodeAtPoint`, `filterSelectableNodes`, `SelectableUiNode` if imported)

3b. Replace the field `private selectableNodes: SelectableUiNode[] = [];` with:

```ts
  private allNodes: UiNode[] = [];
```

3c. In `refreshElements`, replace the body so `elementId` indexes ALL parsed nodes, and each payload node carries `parentId` + `selectable`:

```ts
      const all = parseUiNodes(xml);
      this.allNodes = all;
      const screen = this.screenSize;
      const payload = all.map((n, i) => {
        const c = elementCenter(n);
        return {
          elementId: i,
          text: n.text,
          resourceId: n.resourceId,
          contentDesc: n.contentDesc,
          className: n.className,
          left: n.bounds.left / screen.width,
          top: n.bounds.top / screen.height,
          width: (n.bounds.right - n.bounds.left) / screen.width,
          height: (n.bounds.bottom - n.bounds.top) / screen.height,
          selector: resolveElementSelector(n, c.x, c.y, screen),
          parentId: n.parentId !== undefined ? n.parentId : -1,
          selectable: isSelectable(n, screen)
        };
      });
      this.panel.webview.postMessage({ type: 'elements', nodes: payload });
```

3d. `nodeAt` now indexes `this.allNodes`:

```ts
  private nodeAt(elementId: number | undefined): UiNode | undefined {
    if (elementId === undefined) return undefined;
    return this.allNodes[elementId];
  }
```

3e. In `handleRawTap`, resolve via the labeled walk:

```ts
    const node = findLabeledNodeAtPoint(this.allNodes, x, y);
    await this.emit({ tapOn: resolveElementSelector(node, x, y, this.screenSize) });
```

3f. Remove the Elements panel from `getHtml()`. Replace the `#mirror-body` block so it wraps only `#stage`:

```html
  <div id="mirror-body">
    <div id="stage">
      <canvas id="screen"></canvas>
      <div id="overlay"></div>
      <div id="tooltip">
        <div id="overlap-stack"></div>
      </div>
    </div>
  </div>
```

(delete the `#elements-panel` div and everything inside it)

- [ ] **Step 4: Update `media/mirror.js`**

4a. `elements` handler — remove the `renderElementList()` call:

```js
    } else if (msg.type === 'elements') {
      elements = msg.nodes || [];
      renderOverlay();
    }
```

4b. Remove the `elementIdSuffix` and `renderElementList` functions entirely, and the `toggleElements` wiring block. Keep `elementLabel`.

4c. Add `isLabeled` and make `elementAt` walk up to the nearest labeled ancestor:

```js
  function isLabeled(e) {
    return !!(e.text || e.resourceId || e.contentDesc);
  }

  function elementAt(xPct, yPct) {
    let best = null;
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        if (!best || e.width * e.height < best.width * best.height) {
          best = e;
        }
      }
    }
    while (best && !isLabeled(best) && best.parentId >= 0 && elements[best.parentId]) {
      best = elements[best.parentId];
    }
    return best;
  }
```

4d. Make `elementsAt` (overlap) resolve each hit to its labeled ancestor and dedupe:

```js
  function elementsAt(xPct, yPct) {
    const seen = new Set();
    const hits = [];
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        let node = e;
        while (node && !isLabeled(node) && node.parentId >= 0 && elements[node.parentId]) {
          node = elements[node.parentId];
        }
        if (node && isLabeled(node) && !seen.has(node.elementId)) {
          seen.add(node.elementId);
          hits.push(node);
        }
      }
    }
    hits.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return hits;
  }
```

4e. `renderOverlay` — only draw boxes for selectable nodes:

```js
  function renderOverlay() {
    overlay.innerHTML = '';
    for (const e of elements) {
      if (!e.selectable) continue;
      const box = document.createElement('div');
      box.className = 'element-box';
      box.dataset.id = e.elementId;
      box.style.left = e.left * 100 + '%';
      box.style.top = e.top * 100 + '%';
      box.style.width = e.width * 100 + '%';
      box.style.height = e.height * 100 + '%';
      overlay.appendChild(box);
    }
    if (hoveredElement) updateHover(hoveredElement);
  }
```

4f. `updateHover` — remove the `.element-row` active-state loop (rows are gone); keep the overlay box highlight, badge, and tooltip:

```js
  function updateHover(e) {
    hoveredElement = e;
    for (const el of overlay.children) {
      const on = el.dataset.id === String(e && e.elementId);
      el.classList.toggle('hover', on);
      const badge = el.querySelector('.element-badge');
      if (on && e) {
        if (!badge) {
          const b = document.createElement('span');
          b.className = 'element-badge';
          b.textContent = elementLabel(e);
          el.appendChild(b);
        } else {
          badge.textContent = elementLabel(e);
        }
      } else if (badge) {
        badge.remove();
      }
    }
    if (e) {
      renderTooltip(e);
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  }
```

- [ ] **Step 5: Update `media/mirror.css`**

Remove the Elements-panel styles: `#mirror-body`, `#elements-panel`, `#elements-panel.collapsed #elements-list`, `.panel-header`, `#elements-list`, `.element-row`, `.element-row:hover`, `.element-row.active`, `.element-label`, `.element-id`. (Keep `#stage`, `.element-box`, `.element-box.hover`, `.element-badge`, `#tooltip`, tooltip rows/title, `#overlap-stack`, `.overlap-chip`, `#context-menu`, menu styles.)

- [ ] **Step 6: Verify the gate and commit**

Run: `npm run test:unit && node --check media/mirror.js`
Expected: PASS + exit 0. Confirm no references remain to `renderElementList`, `elementIdSuffix`, `filterSelectableNodes`, `SelectableUiNode`, or `#elements-panel` in the changed files.

```bash
git add src/android/uiautomator.ts test/unit/uiautomator.test.js src/mirrorPanel.ts media/mirror.js media/mirror.css
git commit -m "feat: resolve elements by labeled ancestor like Maestro Studio; drop Elements panel"
```

---

### Task 2: Manual verification (human, on emulator)

- [ ] **Step 1: On-device checklist**

1. Start the mirror. Confirm the Elements list panel is GONE; only the mirrored screen remains.
2. Hover over an element whose text is on a child/container (e.g. a "Login" button): the box highlights and the badge shows the actual text ("Login"), not a coordinate. Hover shows the tooltip with text/id/class/bounds.
3. Left-click such an element: records `tapOn: "Login"` (text selector), not `point:`.
4. Right-click it: menu opens; "Assert visible" records `assertVisible: {text: "Login"}`; "Tap" records `tapOn: "Login"`.
5. Elements that truly have no label still record a `point:` fallback.
6. Reopen the flow in the text editor and confirm the recorded YAML uses text selectors.
