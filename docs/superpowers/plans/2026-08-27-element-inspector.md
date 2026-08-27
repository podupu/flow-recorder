# Element Inspector + Rich Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a persistent element-inspector list panel beside the Android mirror and a richer hover popup (detail rows + overlap picker), building on the existing element-detection overlay.

**Architecture:** The panel already sends `{ type: 'elements', nodes: [{ elementId, text, resourceId, contentDesc, left, top, width, height, selector }] }` on a ~2.5s poll. This plan adds `className` to that payload, a list container to the mirror webview HTML, and the rendering/wiring in `media/mirror.js` + styling in `media/mirror.css`.

**Tech Stack:** TypeScript (vscode), plain webview JS (IIFE), CSS. Gate: `npm run test:unit` + `node --check media/mirror.js`.

## Global Constraints

- Webview files stay plain IIFEs, no modules/imports. Gate with `node --check`.
- `npm run test:unit` must stay green.
- The existing message contract (panel↔webview) is unchanged except the payload gains one field (`className`); no new message types.
- Element payload geometry stays 0–1 fractions.
- Element text/id is untrusted UI data — build DOM with `textContent`, never innerHTML with element data (prevent XSS).
- Commit only the files this task touches.

---

### Task 1: Element inspector list + rich hover

**Files:**
- Modify: `src/mirrorPanel.ts` (payload + getHtml)
- Modify: `media/mirror.js`
- Modify: `media/mirror.css`

**Interfaces:**
- Consumes: the existing `elements` payload; adds `className` to each node.
- Produces: webview UI that lists elements, highlights on hover both ways, and shows a rich detail tooltip with an overlap picker.

- [ ] **Step 1: Add `className` to the elements payload (`src/mirrorPanel.ts` `refreshElements`)**

In the `payload` object (currently at `src/mirrorPanel.ts:126-136`), add `className: n.className,` after the `contentDesc` line.

- [ ] **Step 2: Add the list panel container to `getHtml()` (`src/mirrorPanel.ts`)**

Currently the body is: `#status`, `#mirror-toolbar`, `#stage` (canvas/overlay/tooltip), script. Wrap `#stage` and a new `#elements-panel` in a flex row:

Replace:

```html
  <div id="stage">
    <canvas id="screen"></canvas>
    <div id="overlay"></div>
    <div id="tooltip"></div>
  </div>
```

with:

```html
  <div id="mirror-body">
    <div id="stage">
      <canvas id="screen"></canvas>
      <div id="overlay"></div>
      <div id="tooltip"></div>
    </div>
    <div id="elements-panel">
      <div class="panel-header">
        <span>Elements</span>
        <button id="toggle-elements" title="Show/hide list">-</button>
      </div>
      <div id="elements-list"></div>
    </div>
  </div>
```

- [ ] **Step 3: Webview logic (`media/mirror.js`)**

3a. In the `elements` message handler, also call a new `renderElementList()`:

```js
    } else if (msg.type === 'elements') {
      elements = msg.nodes || [];
      renderOverlay();
      renderElementList();
    }
```

3b. Add `elementsAt` (all overlapping nodes at a point, smallest-area first) after the existing `elementAt`:

```js
  function elementsAt(xPct, yPct) {
    const hits = [];
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        hits.push(e);
      }
    }
    hits.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return hits;
  }
```

3c. Add element-label helpers and `renderElementList()`. Replace the existing `selectorLabel` with a richer set:

```js
  function elementLabel(e) {
    return e.text || e.resourceId || e.contentDesc || '(unnamed)';
  }

  function elementIdSuffix(e) {
    if (e.text && e.resourceId) return e.resourceId;
    return '';
  }

  function renderElementList() {
    const list = document.getElementById('elements-list');
    list.innerHTML = '';
    for (const e of elements) {
      const row = document.createElement('div');
      row.className = 'element-row';
      row.dataset.id = e.elementId;
      const label = document.createElement('span');
      label.className = 'element-label';
      label.textContent = elementLabel(e);
      row.appendChild(label);
      const suffix = elementIdSuffix(e);
      if (suffix) {
        const idSpan = document.createElement('span');
        idSpan.className = 'element-id';
        idSpan.textContent = suffix;
        row.appendChild(idSpan);
      }
      row.addEventListener('mouseenter', () => updateHover(e));
      row.addEventListener('click', () => vscode.postMessage({ type: 'elementTap', elementId: e.elementId }));
      list.appendChild(row);
    }
    if (hoveredElement) updateHover(hoveredElement);
  }
```

3d. Replace `updateHover` so it also marks the active list row and renders a rich tooltip:

```js
  function updateHover(e) {
    hoveredElement = e;
    for (const el of overlay.children) {
      el.classList.toggle('hover', el.dataset.id === String(e && e.elementId));
    }
    for (const row of document.querySelectorAll('.element-row')) {
      row.classList.toggle('active', row.dataset.id === String(e && e.elementId));
    }
    if (e) {
      renderTooltip(e);
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  }
```

3e. Add `renderTooltip(e)` (builds DOM rows; never innerHTML with element data):

```js
  function tooltipRow(label, value) {
    const row = document.createElement('div');
    row.className = 'tooltip-row';
    const lbl = document.createElement('span');
    lbl.className = 'tooltip-label';
    lbl.textContent = label + ':';
    row.appendChild(lbl);
    const val = document.createElement('span');
    val.className = 'tooltip-value';
    val.textContent = value;
    row.appendChild(val);
    return row;
  }

  function renderTooltip(e) {
    tooltip.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = elementLabel(e);
    tooltip.appendChild(title);
    if (e.text) tooltip.appendChild(tooltipRow('text', e.text));
    if (e.resourceId) tooltip.appendChild(tooltipRow('id', e.resourceId));
    if (e.contentDesc) tooltip.appendChild(tooltipRow('content-desc', e.contentDesc));
    if (e.className) tooltip.appendChild(tooltipRow('class', e.className));
    const pctW = Math.round(e.width * 100);
    const pctH = Math.round(e.height * 100);
    tooltip.appendChild(tooltipRow('bounds', e.left * 100 + '%,' + e.top * 100 + '% ' + pctW + 'x' + pctH));
  }
```

3f. Overlap picker: in the canvas `pointermove` handler, when multiple elements overlap the cursor, render a compact stack of labels; hovering/clicking a stack item targets it. Replace the `updateHover(elementAt(p.xPct, p.yPct))` line in `pointermove` with:

```js
    const hits = elementsAt(p.xPct, p.yPct);
    updateHover(hits[0] || null);
    renderOverlapStack(hits);
```

Add `renderOverlapStack(hits)`:

```js
  function renderOverlapStack(hits) {
    const stack = document.getElementById('overlap-stack');
    stack.innerHTML = '';
    if (!hits || hits.length < 2) {
      stack.classList.remove('show');
      return;
    }
    for (const e of hits) {
      const chip = document.createElement('span');
      chip.className = 'overlap-chip' + (hoveredElement && hoveredElement.elementId === e.elementId ? ' active' : '');
      chip.textContent = elementLabel(e);
      chip.addEventListener('mouseenter', () => updateHover(e));
      chip.addEventListener('click', () => vscode.postMessage({ type: 'elementTap', elementId: e.elementId }));
      stack.appendChild(chip);
    }
    stack.classList.add('show');
  }
```

Note: when the overlap stack is shown, `renderTooltip` (called from `updateHover`) still shows the active element's details; the stack chips sit at the bottom of the tooltip. `updateHover` must clear/refresh the stack's active chip when called from list or stack hover — add `document.querySelectorAll('.overlap-chip').forEach((c, i) => c.classList.toggle('active', hits && hits[i] && hits[i].elementId === hoveredElement.elementId));` inside `renderOverlapStack` by re-reading `hoveredElement` (already done above).

3g. Add `id="overlap-stack"` as a child of `#tooltip` (so it shows inside the popup). The tooltip container is in `mirrorPanel.ts` getHtml — add `<div id="overlap-stack"></div>` inside `#tooltip`, after the (now dynamically populated) content. Since `renderTooltip` clears `tooltip.innerHTML`, it would wipe the stack; instead make the stack a SIBLING that `renderTooltip` appends after rebuilding. Implementation: in `renderTooltip`, after the bound rows, append the stack element:

```js
    const stack = document.getElementById('overlap-stack');
    if (stack) tooltip.appendChild(stack);
```

And `renderOverlapStack` fills `#overlap-stack` (which lives inside `#tooltip`). So the getHtml `#tooltip` should contain the static `<div id="overlap-stack"></div>`.

3h. Toggle button: wire `#toggle-elements` to collapse/expand the list panel:

```js
  const toggleElements = document.getElementById('toggle-elements');
  const elementsPanel = document.getElementById('elements-panel');
  toggleElements.addEventListener('click', () => {
    const collapsed = elementsPanel.classList.toggle('collapsed');
    toggleElements.textContent = collapsed ? '+' : '-';
  });
```

- [ ] **Step 4: Styles (`media/mirror.css`)**

Append:

```css
#mirror-body {
  display: flex;
  gap: 8px;
  padding: 8px;
  align-items: flex-start;
}

#stage {
  flex: 0 0 auto;
}

#elements-panel {
  flex: 1 1 260px;
  min-width: 200px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-editorWidget-border, #444);
  border-radius: 6px;
  overflow: hidden;
}

#elements-panel.collapsed #elements-list {
  display: none;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
}

#elements-list {
  overflow-y: auto;
  flex: 1;
}

.element-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.element-row:hover {
  background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.15));
}

.element-row.active {
  background: var(--vscode-list-activeSelectionBackground, rgba(56, 138, 221, 0.3));
}

.element-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.element-id {
  color: var(--vscode-descriptionForeground, #999);
  font-size: 11px;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-row {
  display: flex;
  gap: 8px;
  font-size: 11px;
}

.tooltip-label {
  color: var(--vscode-descriptionForeground, #bbb);
}

.tooltip-value {
  word-break: break-all;
}

.tooltip-title {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 3px;
  word-break: break-all;
}

#overlap-stack {
  display: none;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(128, 128, 128, 0.3);
}

#overlap-stack.show {
  display: flex;
}

.overlap-chip {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 8px;
  border: 1px solid var(--vscode-editorWidget-border, #555);
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlap-chip.active {
  background: var(--vscode-list-activeSelectionBackground, rgba(56, 138, 221, 0.35));
}
```

Note: the existing `#stage { width: fit-content; max-width: 100%; margin: 0 auto; }` rule exists; keep it (the flex parent overrides `margin: 0 auto` behavior acceptably). Also `#tooltip` needs `max-width`/overflow so a rich tooltip doesn't break layout — keep existing `max-width: 80%` and add `min-width: 160px`.

- [ ] **Step 5: Verify the gate and commit**

Run: `npm run test:unit && node --check media/mirror.js`
Expected: PASS + exit 0.

```bash
git add src/mirrorPanel.ts media/mirror.js media/mirror.css
git commit -m "feat: element inspector list and rich hover with overlap picker"
```

---

### Task 2: Manual verification (human, on emulator)

- [ ] **Step 1: On-device checklist**

1. Start the mirror (command palette → Flow Recorder: Start Android Mirror). Confirm:
   - The **Elements** list panel appears beside the mirrored screen and lists detected elements (text with dimmed id suffix).
   - Hovering a list row highlights that element's box on the screen and shows the rich tooltip (text, id, content-desc, class, bounds).
   - Clicking a list row records `tapOn: <selector>` and taps the device.
   - Hovering the screen still highlights; the rich tooltip shows the detail rows; when elements overlap, a chip stack appears and hovering/clicking a chip targets that element.
   - The toolbar actions (long-press, assert visible, etc.) target whichever element is hovered (screen, list, or chip).
   - The "-"/"+" button collapses/expands the list.
2. Reopen the flow and confirm the recorded steps are correct YAML.
