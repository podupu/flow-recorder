# Right-Click Command Menu + Text Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the top toolbar from the Android mirror and move every command into a right-click context menu; keep the Elements list panel; mark the hovered element's text visually so the user can see exactly what will be recorded.

**Architecture:** The mirror webview (`media/mirror.js`) currently wires a 4-row toolbar in `#mirror-toolbar` (defined in `src/mirrorPanel.ts` getHtml). This plan deletes the toolbar, adds a `#context-menu` (position: fixed) that the canvas `contextmenu` event populates at the cursor, and adds a text badge to the hovered element's overlay box. The panel↔webview message contract is unchanged — the context menu posts the exact same message types the panel already handles.

**Tech Stack:** TypeScript (vscode), plain webview JS (IIFE), CSS. Gate: `npm run test:unit` + `node --check media/mirror.js`.

## Global Constraints

- Webview files stay plain IIFEs, no modules/imports. Gate with `node --check`.
- `npm run test:unit` must stay green.
- The message contract is UNCHANGED — the context menu posts the same types the panel already handles: `tap`, `elementTap`, `longPress`, `doubleTap`, `swipe` (gestures, still from pointer events), `inputText`, `eraseText`, `pressKey`, `back`, `hideKeyboard`, `pasteText`, `launchApp` (with `clearState`), `stopApp`, `killApp` (with `clearState`), `clearState`, `setOrientation`, `takeScreenshot`, `setClipboard`, `setAirplaneMode`, `toggleAirplaneMode`, `toggleDarkMode`, `scroll`, `assertVisible`, `assertNotVisible`, `optional`.
- Element text/id is untrusted UI data — build DOM with `textContent`, never innerHTML with element data (XSS).
- Element payload geometry stays 0–1 fractions.
- Commit only the files this task touches (`src/mirrorPanel.ts`, `media/mirror.js`, `media/mirror.css`). Do NOT stage the user's untracked/modified test files (`examples/example.flow.yaml`, `examples/assets/`, `.vscode/settings.json`).

---

### Task 1: Right-click context menu + text marking

**Files:**
- Modify: `src/mirrorPanel.ts` (getHtml)
- Modify: `media/mirror.js`
- Modify: `media/mirror.css`

**Interfaces:**
- Consumes: the existing `elements` payload (`{ elementId, text, resourceId, contentDesc, className, left, top, width, height, selector }`) and the panel message handlers.
- Produces: a right-click context menu with all commands; the hovered element's text marked in its overlay box.

- [ ] **Step 1: Remove the toolbar and add the context menu container (`src/mirrorPanel.ts` getHtml)**

In `getHtml()`, delete the entire `#mirror-toolbar` block (all 4 `.row` divs between `<div id="mirror-toolbar">` and its closing `</div>`). Keep `#status`, `#mirror-body` (with `#stage` and `#elements-panel`), and the script tag. Add a context menu container as the last element in `<body>` (after `#mirror-body`, before the script):

```html
  <div id="context-menu" class="hidden"></div>
```

The body should now be:

```html
<body>
  <div id="status">Connecting to device...</div>
  <div id="mirror-body">
    <div id="stage">
      <canvas id="screen"></canvas>
      <div id="overlay"></div>
      <div id="tooltip">
        <div id="overlap-stack"></div>
      </div>
    </div>
    <div id="elements-panel">
      <div class="panel-header">
        <span>Elements</span>
        <button id="toggle-elements" title="Show/hide list">-</button>
      </div>
      <div id="elements-list"></div>
    </div>
  </div>
  <div id="context-menu" class="hidden"></div>
  <script src="${scriptUri}"></script>
</body>
```

- [ ] **Step 2: Rewrite the webview wiring (`media/mirror.js`)**

Remove ALL toolbar wiring: the `optionalBox` block, `inputField`/`doInput`, `doErase`, `doScreenshot`, the `setClipboard` listener, `launchClear`, the `singleActions` object, and the `[data-action]` loop. Keep everything else: frame/elements/status handlers, `rect`/`toPct`, `elementAt`/`elementsAt`, `renderOverlay`, `showStatus`, `elementLabel`/`elementIdSuffix`/`renderElementList`, `updateHover`/`tooltipRow`/`renderTooltip`/`renderOverlapStack`, and all pointer gesture handling (`pointerdown`/`pointermove`/`pointercancel`/`lostpointercapture`/`pointerup`).

2a. Add a `menuTarget` variable and the menu builder. After `let lastTapTime = 0;` add `let menuTarget = null;`.

2b. Add the context menu logic (place near the end, before the closing `})();`):

```js
  // --- Right-click context menu ---
  const contextMenu = document.getElementById('context-menu');
  let menuTarget = null;

  function menuItem(label, onClick) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', () => { hideMenu(); onClick(); });
    return item;
  }

  function menuSeparator(text) {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    sep.textContent = text;
    return sep;
  }

  function menuField(id, placeholder, type) {
    const input = document.createElement('input');
    input.type = type || 'text';
    input.id = id;
    input.placeholder = placeholder || '';
    return input;
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function targetElement() {
    return menuTarget;
  }

  function elementAction(action) {
    const el = targetElement();
    if (!el) {
      showStatus('Right-click an element to use this action');
      return;
    }
    post({ type: action, elementId: el.elementId });
  }

  function buildMenu() {
    contextMenu.innerHTML = '';
    const target = targetElement();
    const targetRow = document.createElement('div');
    targetRow.className = 'menu-target';
    targetRow.textContent = target ? elementLabel(target) + (target.resourceId ? '  [' + target.resourceId + ']' : '') : 'Empty area — gestures only';
    contextMenu.appendChild(targetRow);

    contextMenu.appendChild(menuSeparator('Gestures'));
    contextMenu.appendChild(menuItem('Tap', () => elementAction('elementTap')));
    contextMenu.appendChild(menuItem('Long press', () => elementAction('longPress')));
    contextMenu.appendChild(menuItem('Double tap', () => elementAction('doubleTap')));
    contextMenu.appendChild(menuItem('Assert visible', () => elementAction('assertVisible')));
    contextMenu.appendChild(menuItem('Assert not visible', () => elementAction('assertNotVisible')));

    contextMenu.appendChild(menuSeparator('Text & keyboard'));
    const inputTextField = menuField('menu-input', 'Text to type...');
    contextMenu.appendChild(inputTextField);
    contextMenu.appendChild(menuItem('Input text', () => {
      const el = targetElement();
      post({ type: 'inputText', text: inputTextField.value, elementId: el ? el.elementId : undefined });
      inputTextField.value = '';
    }));
    const eraseField = menuField('menu-erase', 'Chars to erase', 'number');
    eraseField.value = '50';
    contextMenu.appendChild(eraseField);
    contextMenu.appendChild(menuItem('Erase', () => {
      post({ type: 'eraseText', count: parseInt(eraseField.value, 10) || 50 });
    }));
    contextMenu.appendChild(menuItem('Back', () => post({ type: 'back' })));
    contextMenu.appendChild(menuItem('Back key', () => post({ type: 'pressKey', key: 'back' })));
    contextMenu.appendChild(menuItem('Home', () => post({ type: 'pressKey', key: 'home' })));
    contextMenu.appendChild(menuItem('Enter', () => post({ type: 'pressKey', key: 'enter' })));
    contextMenu.appendChild(menuItem('Hide keyboard', () => post({ type: 'hideKeyboard' })));
    contextMenu.appendChild(menuItem('Paste', () => post({ type: 'pasteText' })));

    contextMenu.appendChild(menuSeparator('App'));
    const launchClear = menuField('menu-launch-clear', '', 'checkbox');
    const launchWrap = document.createElement('label');
    launchWrap.className = 'menu-item menu-check';
    launchWrap.appendChild(launchClear);
    launchWrap.appendChild(document.createTextNode(' Clear state on launch'));
    contextMenu.appendChild(launchWrap);
    contextMenu.appendChild(menuItem('Launch app', () => post({ type: 'launchApp', clearState: launchClear.checked })));
    contextMenu.appendChild(menuItem('Stop app', () => post({ type: 'stopApp' })));
    contextMenu.appendChild(menuItem('Kill app', () => post({ type: 'killApp', clearState: launchClear.checked })));
    contextMenu.appendChild(menuItem('Clear app state', () => post({ type: 'clearState' })));
    contextMenu.appendChild(menuItem('Toggle dark mode', () => post({ type: 'toggleDarkMode' })));

    contextMenu.appendChild(menuSeparator('Device'));
    contextMenu.appendChild(menuItem('Landscape', () => post({ type: 'setOrientation', orientation: 'LANDSCAPE' })));
    contextMenu.appendChild(menuItem('Portrait', () => post({ type: 'setOrientation', orientation: 'PORTRAIT' })));
    contextMenu.appendChild(menuItem('Scroll', () => post({ type: 'scroll' })));
    contextMenu.appendChild(menuItem('Toggle airplane mode', () => post({ type: 'toggleAirplaneMode' })));
    const clipboardField = menuField('menu-clipboard', 'Clipboard text...');
    contextMenu.appendChild(clipboardField);
    contextMenu.appendChild(menuItem('Set clipboard', () => {
      if (clipboardField.value) {
        post({ type: 'setClipboard', text: clipboardField.value });
        clipboardField.value = '';
      }
    }));

    contextMenu.appendChild(menuSeparator('Capture'));
    const shotField = menuField('menu-shot', 'screenshot-name');
    contextMenu.appendChild(shotField);
    contextMenu.appendChild(menuItem('Take screenshot', () => {
      post({ type: 'takeScreenshot', name: shotField.value });
      shotField.value = '';
    }));
    const optionalBox = menuField('menu-optional', '', 'checkbox');
    const optWrap = document.createElement('label');
    optWrap.className = 'menu-item menu-check';
    optWrap.appendChild(optionalBox);
    optWrap.appendChild(document.createTextNode(' Record steps as optional'));
    contextMenu.appendChild(optWrap);
    optionalBox.addEventListener('change', () => post({ type: 'optional', value: optionalBox.checked }));
  }

  function showMenu(x, y) {
    buildMenu();
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
    contextMenu.classList.add('show');
  }

  function hideMenu() {
    contextMenu.classList.add('hidden');
    contextMenu.classList.remove('show');
  }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = toPct(e.clientX, e.clientY);
    const el = elementAt(p.xPct, p.yPct);
    menuTarget = el;
    updateHover(el);
    showMenu(e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideMenu();
  });
```

Note: `menuTarget` is declared in 2b — do not also declare it in 2a (remove the duplicate from 2a if you added it there; declare it once in 2b).

- [ ] **Step 3: Mark the hovered element's text in its overlay box (`media/mirror.js` `updateHover`)**

Change `updateHover` so the hovered box gets a text badge showing the element label:

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

- [ ] **Step 4: Styles (`media/mirror.css`)**

Remove the `#mirror-toolbar` rules (the whole `#mirror-toolbar`, `#mirror-toolbar .row`, `#mirror-toolbar input[...]`, `#mirror-toolbar button`, `#mirror-toolbar .opt` block). Append:

```css
.element-badge {
  position: absolute;
  top: -1px;
  left: -1px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  background: #388add;
  color: #fff;
  border-radius: 2px 0 6px 0;
  z-index: 2;
}

#context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 320px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--vscode-editorWidget-background, #252526);
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-editorWidget-border, #444);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

#context-menu.hidden {
  display: none;
}

.menu-target {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
  word-break: break-all;
}

.menu-separator {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground, #999);
  padding: 6px 8px 2px;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  color: var(--vscode-foreground);
  border: none;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 12px;
  cursor: pointer;
}

.menu-item:hover {
  background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.2));
}

.menu-item.menu-check {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

#context-menu input[type="text"],
#context-menu input[type="number"] {
  display: block;
  width: calc(100% - 16px);
  margin: 4px 8px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, #444);
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
  box-sizing: border-box;
}
```

- [ ] **Step 5: Verify the gate and commit**

Run: `npm run test:unit && node --check media/mirror.js`
Expected: PASS + exit 0. Confirm the removed toolbar IDs are no longer referenced anywhere in `media/mirror.js`.

```bash
git add src/mirrorPanel.ts media/mirror.js media/mirror.css
git commit -m "feat: right-click command menu with text marking"
```

---

### Task 2: Manual verification (human, on emulator)

- [ ] **Step 1: On-device checklist**

1. Start the mirror. Confirm: the top toolbar is GONE; right-clicking on the mirrored screen opens a context menu at the cursor with all functions grouped (Gestures / Text & keyboard / App / Device / Capture); right-clicking an element shows its text + id at the top of the menu and marks that element's text with a blue badge on screen.
2. Left-click/drag/hold still record tap/swipe/long-press/double-tap; the Elements list still works (hover highlights + marks text, click records tap).
3. Each menu item posts the correct command into the flow (verify the YAML after reopening with the text editor).
4. The optional checkbox in the menu stamps new steps.
