# Full Maestro Command Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Flow Recorder's Android mirror from a tap-only recorder into a Maestro-Studio-style recorder that captures every studio-recordable Maestro command, with an element-detection highlight overlay for selecting elements.

**Architecture:** Two recording surfaces plus a shared pure-logic layer. `src/gestures.ts`, `src/android/adb.ts`, and `src/android/uiautomator.ts` hold pure/testable logic (no `vscode` import). `src/mirrorPanel.ts` + `media/mirror.js` implement the mirror: pointer-gesture capture, an element overlay driven by uiautomator hierarchy dumps, and a toolbar for device/app actions. `src/flowEditorProvider.ts` + `media/main.js` add a "+ Command" menu for structural commands and an optional toggle per block. `src/flowDocument.ts` gains a generic step-update helper.

**Tech Stack:** TypeScript (strict, CommonJS, compile to `out/`), VS Code Extension API (`vscode`), `js-yaml` for flow documents, `adb` shell commands for device control, Mocha (already a devDependency) for unit tests of pure modules, `node --check` for webview JS syntax.

## Global Constraints

- No new npm dependencies (mocha and js-yaml already present).
- Pure modules (`src/gestures.ts`, `src/android/adb.ts`, `src/android/uiautomator.ts`) must NOT import `vscode` — they are unit-tested in plain Node via `mocha`.
- `npm run compile` must stay green after every task.
- Webview files (`media/*.js`) are plain ES5-style IIFEs: no modules, no imports, `acquireVsCodeApi()` at the top. Gate with `node --check media/<file>.js`.
- Maestro command syntax matches docs.maestro.dev: `pressKey: "back"` (lowercase keys), `swipe: {direction: UP}`, `eraseText: N`, `assertVisible: {text: ...}`, `waitForAnimationToEnd: {timeout: N}`, `extendedWaitUntil: {visible, timeout}`, `openLink: <uri>`, `runFlow: <path>`, `copyTextFrom: {text, to}`.
- Bare commands (`back`, `hideKeyboard`, `stopApp`, `clearState`, `pasteText`, `scroll`, `toggleAirplaneMode`, `toggleDarkMode`, `killApp`) append as plain YAML strings (`- back`) so `js-yaml` dumps scalars.
- The appId for lifecycle commands (`launchApp`/`stopApp`/`killApp`/`clearState`) comes from the active flow's `appId` config.
- Element overlay payload fields are 0–1 fractions (`left/top/width/height`); the webview multiplies by 100 for CSS percentages.
- The repo has no git history yet; Task 0 initializes it. Commit after every task.

---

### Task 0: Repo setup (git, ignore rules, unit-test script)

**Files:**
- Create: `.gitignore`
- Modify: `package.json` (add `test:unit` script)
- Create: `test/unit/smoke.test.js`

**Interfaces:**
- Produces: `npm run test:unit` command that compiles then runs Mocha over `test/unit/*.test.js`; a green smoke test so the script never errors on an empty suite.

- [ ] **Step 1: Initialize git and create `.gitignore`**

```bash
cd /Users/aeediga/Downloads/flow-recorder
git init
```

Create `.gitignore`:

```gitignore
node_modules/
out/
.vscode-test/
*.vsix
```

- [ ] **Step 2: Add the `test:unit` script and a smoke test**

In `package.json`, under `scripts`, add:

```json
"test:unit": "npm run compile && mocha test/unit/*.test.js"
```

Create `test/unit/smoke.test.js`:

```js
const assert = require('assert');

describe('smoke', () => {
  it('has a working unit-test harness', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

- [ ] **Step 3: Verify and commit**

Run: `npm run test:unit`
Expected: smoke test PASSES (compile also succeeds).

```bash
git add .gitignore package.json test/unit/smoke.test.js
git commit -m "chore: init repo, unit-test harness"
```

---

### Task 1: Pure gesture classification (`src/gestures.ts`)

**Files:**
- Create: `src/gestures.ts`
- Test: `test/unit/gestures.test.js`

**Interfaces:**
- Produces:
  - `export type GestureKind = 'tap' | 'longPress' | 'swipe'`
  - `export interface Point { x: number; y: number }`
  - `export const LONG_PRESS_MS = 500`
  - `export const DOUBLE_TAP_MS = 250`
  - `export const SWIPE_THRESHOLD_PX = 40`
  - `export const GESTURE_MOVE_TOLERANCE_PX = 10`
  - `export const ERASE_MAX = 100`
  - `export function moveDistance(a: Point, b: Point): number`
  - `export function classifySwipeDirection(start: Point, end: Point): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'`
  - `export function classifyPointerGesture(start: Point, end: Point, durationMs: number): GestureKind`

- [ ] **Step 1: Write the failing test**

Create `test/unit/gestures.test.js`:

```js
const assert = require('assert');
const {
  classifyPointerGesture,
  classifySwipeDirection,
  moveDistance,
  LONG_PRESS_MS,
  SWIPE_THRESHOLD_PX
} = require('../../out/gestures');

describe('gestures', () => {
  it('classifies a quick stationary gesture as tap', () => {
    assert.strictEqual(classifyPointerGesture({ x: 0, y: 0 }, { x: 2, y: 1 }, 100), 'tap');
  });

  it('classifies a held stationary gesture as longPress', () => {
    assert.strictEqual(
      classifyPointerGesture({ x: 0, y: 0 }, { x: 2, y: 1 }, LONG_PRESS_MS + 100),
      'longPress'
    );
  });

  it('classifies movement as swipe even when quick', () => {
    assert.strictEqual(
      classifyPointerGesture({ x: 0, y: 0 }, { x: 0, y: SWIPE_THRESHOLD_PX + 20 }, 100),
      'swipe'
    );
  });

  it('classifies swipe direction by dominant axis', () => {
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: -100, y: 5 }), 'LEFT');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 100, y: 5 }), 'RIGHT');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 5, y: 100 }), 'DOWN');
    assert.strictEqual(classifySwipeDirection({ x: 0, y: 0 }, { x: 5, y: -100 }), 'UP');
  });

  it('computes euclidean distance', () => {
    assert.strictEqual(moveDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha test/unit/gestures.test.js`
Expected: FAIL — `Cannot find module '../../out/gestures'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/gestures.ts`:

```ts
export type GestureKind = 'tap' | 'longPress' | 'swipe';

export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 250;
export const SWIPE_THRESHOLD_PX = 40;
export const GESTURE_MOVE_TOLERANCE_PX = 10;
export const ERASE_MAX = 100;

export interface Point {
  x: number;
  y: number;
}

export function moveDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function classifySwipeDirection(start: Point, end: Point): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'RIGHT' : 'LEFT';
  }
  return dy > 0 ? 'DOWN' : 'UP';
}

export function classifyPointerGesture(start: Point, end: Point, durationMs: number): GestureKind {
  if (moveDistance(start, end) < GESTURE_MOVE_TOLERANCE_PX) {
    return durationMs >= LONG_PRESS_MS ? 'longPress' : 'tap';
  }
  return 'swipe';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && npx mocha test/unit/gestures.test.js`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add src/gestures.ts test/unit/gestures.test.js
git commit -m "feat: pure gesture classification"
```

---

### Task 2: adb device functions + pure helpers (`src/android/adb.ts`)

**Files:**
- Modify: `src/android/adb.ts`
- Test: `test/unit/adb.test.js`

**Interfaces:**
- Consumes: `ERASE_MAX` from `../gestures`.
- Produces (pure, tested):
  - `export function escapeInputText(text: string): string`
  - `export function keyNameToKeycode(key: string): number`
  - `export function orientationToSettings(orientation: string): string`
- Produces (device functions, consumed by `mirrorPanel.ts` in Task 5):
  - `longPress(deviceId, x, y)`, `doubleTap(deviceId, x, y)`, `inputText(deviceId, text)`, `eraseText(deviceId, count)`, `pressKey(deviceId, key)`, `back(deviceId)`, `hideKeyboard(deviceId)`, `pasteText(deviceId)`, `launchApp(deviceId, appId)`, `stopApp(deviceId, appId)`, `killApp(deviceId, appId, clearState)`, `clearState(deviceId, appId)`, `setOrientation(deviceId, orientation)`, `setClipboard(deviceId, text)`, `setAirplaneMode(deviceId, enabled)`, `setDarkMode(deviceId, enabled)`, `scroll(deviceId)`

- [ ] **Step 1: Write the failing test**

Create `test/unit/adb.test.js`:

```js
const assert = require('assert');
const {
  escapeInputText,
  keyNameToKeycode,
  orientationToSettings
} = require('../../out/android/adb');

describe('adb pure helpers', () => {
  it('escapes spaces for adb input text', () => {
    assert.strictEqual(escapeInputText('hello world'), 'hello%sworld');
    assert.strictEqual(escapeInputText('noSpaces'), 'noSpaces');
  });

  it('maps Maestro key names to Android keycodes', () => {
    assert.strictEqual(keyNameToKeycode('Home'), 3);
    assert.strictEqual(keyNameToKeycode('back'), 4);
    assert.strictEqual(keyNameToKeycode('volume up'), 24);
    assert.throws(() => keyNameToKeycode('nonsense'));
  });

  it('maps orientation to user_rotation value', () => {
    assert.strictEqual(orientationToSettings('LANDSCAPE'), '1');
    assert.strictEqual(orientationToSettings('PORTRAIT'), '0');
    assert.throws(() => orientationToSettings('SIDEWAYS'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha test/unit/adb.test.js`
Expected: FAIL — `escapeInputText` is not a function.

- [ ] **Step 3: Implement the pure helpers and device functions**

Add to the top of `src/android/adb.ts` (after the imports):

```ts
import { ERASE_MAX } from '../gestures';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeInputText(text: string): string {
  return text.replace(/ /g, '%s');
}

const KEYCODE_BY_NAME: Record<string, number> = {
  home: 3,
  back: 4,
  enter: 66,
  backspace: 67,
  'volume up': 24,
  'volume down': 25,
  power: 26,
  tab: 61,
  lock: 26
};

export function keyNameToKeycode(key: string): number {
  const code = KEYCODE_BY_NAME[key.toLowerCase()];
  if (code === undefined) {
    throw new Error(`Unsupported Maestro key: ${key}`);
  }
  return code;
}

export function orientationToSettings(orientation: string): string {
  if (orientation === 'LANDSCAPE') return '1';
  if (orientation === 'PORTRAIT') return '0';
  throw new Error(`Unsupported orientation: ${orientation}`);
}
```

Append to the end of `src/android/adb.ts`:

```ts
export async function longPress(deviceId: string, x: number, y: number): Promise<void> {
  const rx = String(Math.round(x));
  const ry = String(Math.round(y));
  await execAdb(['-s', deviceId, 'shell', 'input', 'swipe', rx, ry, rx, ry, '600']);
}

export async function doubleTap(deviceId: string, x: number, y: number): Promise<void> {
  await tap(deviceId, x, y);
  await delay(100);
  await tap(deviceId, x, y);
}

export async function inputText(deviceId: string, text: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'text', escapeInputText(text)]);
}

export async function eraseText(deviceId: string, count: number): Promise<void> {
  const n = Math.min(Math.max(1, count), ERASE_MAX);
  for (let i = 0; i < n; i++) {
    await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '67']);
  }
}

export async function pressKey(deviceId: string, key: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', String(keyNameToKeycode(key))]);
}

export async function back(deviceId: string): Promise<void> {
  await pressKey(deviceId, 'back');
}

export async function hideKeyboard(deviceId: string): Promise<void> {
  await pressKey(deviceId, 'back');
}

export async function pasteText(deviceId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '279']);
}

export async function launchApp(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1']);
}

export async function stopApp(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'am', 'force-stop', appId]);
}

export async function killApp(deviceId: string, appId: string, clearState: boolean): Promise<void> {
  await stopApp(deviceId, appId);
  if (clearState) {
    await clearState(deviceId, appId);
  }
}

export async function clearState(deviceId: string, appId: string): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'pm', 'clear', appId]);
}

export async function setOrientation(deviceId: string, orientation: string): Promise<void> {
  const rotation = orientationToSettings(orientation);
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'system', 'user_rotation', rotation]);
}

export async function setClipboard(deviceId: string, text: string): Promise<void> {
  try {
    await execAdb(['-s', deviceId, 'shell', 'cmd', 'clipboard', 'set-text', text]);
  } catch {
    // Best-effort: not every device exposes a writable clipboard service.
  }
}

export async function setAirplaneMode(deviceId: string, enabled: boolean): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'settings', 'put', 'global', 'airplane_mode_on', enabled ? '1' : '0']);
  await execAdb(['-s', deviceId, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE']);
}

export async function setDarkMode(deviceId: string, enabled: boolean): Promise<void> {
  await execAdb(['-s', deviceId, 'shell', 'cmd', 'uimode', 'night', enabled ? 'yes' : 'no']);
}

export async function scroll(deviceId: string): Promise<void> {
  const size = await getScreenSize(deviceId);
  const x = Math.round(size.width / 2);
  const yFrom = Math.round(size.height * 0.8);
  const yTo = Math.round(size.height * 0.2);
  await execAdb(['-s', deviceId, 'shell', 'input', 'swipe', String(x), String(yFrom), String(x), String(yTo), '300']);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && npx mocha test/unit/adb.test.js`
Expected: PASS (3 passing). Also run `npm run test:unit` to confirm no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/android/adb.ts test/unit/adb.test.js
git commit -m "feat: adb device functions for gesture and app control"
```

---

### Task 3: Selector + selectable-node logic (`src/android/uiautomator.ts`)

**Files:**
- Modify: `src/android/uiautomator.ts`
- Test: `test/unit/uiautomator.test.js`

**Interfaces:**
- Consumes: `UiNode` (existing).
- Produces (consumed by `mirrorPanel.ts` in Task 5):
  - `export type ElementSelector = { text?: string; id?: string; point?: string }`
  - `export function resolveElementSelector(node: UiNode | undefined, x: number, y: number, screen: { width: number; height: number }): ElementSelector`
  - `export function toMaestroStep(command: string, node: UiNode | undefined, x: number, y: number, screen: { width: number; height: number }): any`
  - `export interface SelectableUiNode extends UiNode { elementId: number }`
  - `export function filterSelectableNodes(nodes: UiNode[], screen: { width: number; height: number }): SelectableUiNode[]`

- [ ] **Step 1: Write the failing test**

Create `test/unit/uiautomator.test.js`:

```js
const assert = require('assert');
const {
  parseUiNodes,
  findSmallestNodeAtPoint,
  resolveElementSelector,
  filterSelectableNodes
} = require('../../out/android/uiautomator');

const XML = `<?xml version="1.0"?>
<hierarchy>
  <node text="Login" resource-id="" content-desc="" class="android.widget.Button" bounds="[10,20][200,90]"/>
  <node text="Email" resource-id="com.app:id/email" content-desc="" class="android.widget.EditText" bounds="[10,100][200,150]"/>
  <node text="" resource-id="" content-desc="Close" class="android.widget.ImageButton" bounds="[300,10][400,50]"/>
  <node text="" resource-id="" content-desc="" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]"/>
</hierarchy>`;

describe('uiautomator', () => {
  it('parses nodes with bounds', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(nodes.length, 4);
    assert.deepStrictEqual(nodes[0].bounds, { left: 10, top: 20, right: 200, bottom: 90 });
  });

  it('finds the smallest node containing a point', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(findSmallestNodeAtPoint(nodes, 100, 60).text, 'Login');
  });

  it('resolves selector preferring text, then content-desc, then id, then point', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.deepStrictEqual(resolveElementSelector(nodes[0], 0, 0, screen), { text: 'Login' });
    assert.deepStrictEqual(resolveElementSelector(nodes[2], 0, 0, screen), { text: 'Close' });
    assert.deepStrictEqual(resolveElementSelector(nodes[3], 0, 0, screen), { point: '0%,0%' });
  });

  it('filters to selectable nodes', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    const sel = filterSelectableNodes(nodes, screen);
    assert.strictEqual(sel.length, 3);
    assert.deepStrictEqual(sel.map((n) => n.text), ['Login', 'Email', undefined]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && npx mocha test/unit/uiautomator.test.js`
Expected: FAIL — `resolveElementSelector` is not a function.

- [ ] **Step 3: Implement**

Add to `src/android/uiautomator.ts` (keep `parseUiNodes`, `findSmallestNodeAtPoint`; the existing `toMaestroSelector` is replaced by `resolveElementSelector` + `toMaestroStep`):

```ts
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
```

**Keep** the old `toMaestroSelector` for now but rewrite it to delegate, so the compile gate stays green until the mirror panel switches over in Task 5:

```ts
export function toMaestroSelector(
  node: UiNode | undefined,
  x: number,
  y: number,
  screen: { width: number; height: number }
): any {
  return { tapOn: resolveElementSelector(node, x, y, screen) };
}
```

(Task 5 deletes this shim once `mirrorPanel.ts` no longer references it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && npx mocha test/unit/uiautomator.test.js`
Expected: PASS (4 passing). The full compile gate stays green because the `toMaestroSelector` shim still satisfies `mirrorPanel.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/android/uiautomator.ts test/unit/uiautomator.test.js
git commit -m "feat: element selector resolution and selectable-node filtering"
```

---

### Task 4: Generic step update (`src/flowDocument.ts`)

**Files:**
- Modify: `src/flowDocument.ts`

**Interfaces:**
- Produces (consumed by `flowEditorProvider.ts` in Task 7):
  - `export async function updateStep(document: vscode.TextDocument, index: number, patch: Record<string, any>): Promise<void>`

- [ ] **Step 1: Implement `updateStep`**

Add to `src/flowDocument.ts`:

```ts
export async function updateStep(
  document: vscode.TextDocument,
  index: number,
  patch: Record<string, any>
): Promise<void> {
  const parsed = parseFlowDocument(document);
  if (index < 0 || index >= parsed.steps.length) return;
  parsed.steps[index] = { ...parsed.steps[index], ...patch };
  await writeFlowDocument(document, parsed);
}
```

- [ ] **Step 2: Verify compile and regression**

Run: `npm run test:unit`
Expected: PASS. (This module imports `vscode`, so no unit test — the extension host exercises it; Task 7 wires it up.)

- [ ] **Step 3: Commit**

```bash
git add src/flowDocument.ts
git commit -m "feat: generic flow step update helper"
```

---

### Task 5: Mirror panel rewrite + extension wiring

**Files:**
- Modify: `src/mirrorPanel.ts` (full rewrite)
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes from Task 1: `classifySwipeDirection`.
- Consumes from Task 2: all new `adb` functions.
- Consumes from Task 3: `parseUiNodes`, `findSmallestNodeAtPoint`, `resolveElementSelector`, `filterSelectableNodes`, `SelectableUiNode`.
- Produces (message contract consumed by `media/mirror.js` in Task 6 — must match exactly):
  - Panel -> webview: `{ type: 'frame', data }`, `{ type: 'elements', nodes: [{ elementId, text, resourceId, contentDesc, left, top, width, height, selector }] }` (geometry fields are 0–1 fractions).
  - Webview -> panel:
    - `{ type: 'tap', xPct, yPct }`
    - `{ type: 'elementTap', elementId }`
    - `{ type: 'longPress', elementId?, xPct?, yPct? }`
    - `{ type: 'doubleTap', elementId?, xPct?, yPct? }`
    - `{ type: 'swipe', startXpct, startYpct, endXpct, endYpct }`
    - `{ type: 'inputText', text, elementId? }`
    - `{ type: 'eraseText', count }`
    - `{ type: 'pressKey', key }`
    - `{ type: 'back' }`, `{ type: 'hideKeyboard' }`, `{ type: 'pasteText' }`, `{ type: 'scroll' }`, `{ type: 'stopApp' }`, `{ type: 'killApp' }`, `{ type: 'clearState' }`, `{ type: 'toggleDarkMode' }`, `{ type: 'toggleAirplaneMode' }`
    - `{ type: 'launchApp', clearState }`
    - `{ type: 'setOrientation', orientation }`
    - `{ type: 'takeScreenshot', name }`
    - `{ type: 'setClipboard', text }`
    - `{ type: 'setAirplaneMode', enabled }`
    - `{ type: 'assertVisible', elementId }`, `{ type: 'assertNotVisible', elementId }`
    - `{ type: 'optional', value }`
  - `AndroidMirrorPanel.createOrShow(context, deviceId, flowConfig: { appId?: string }, appendStep: (step: any) => Promise<void>)`

- [ ] **Step 1: Rewrite `src/mirrorPanel.ts`**

Replace the entire file:

```ts
import * as vscode from 'vscode';
import * as adb from './android/adb';
import {
  parseUiNodes,
  findSmallestNodeAtPoint,
  resolveElementSelector,
  filterSelectableNodes,
  SelectableUiNode
} from './android/uiautomator';
import { classifySwipeDirection } from './gestures';

interface FlowConfig {
  appId?: string;
}

function elementCenter(node: { bounds: { left: number; top: number; right: number; bottom: number } }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2)
  };
}

export class AndroidMirrorPanel {
  public static current: AndroidMirrorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pollTimer: NodeJS.Timeout | undefined;
  private elementTimer: NodeJS.Timeout | undefined;
  private screenSize: { width: number; height: number } | undefined;
  private selectableNodes: SelectableUiNode[] = [];
  private dumping = false;
  private optional = false;
  private darkMode = false;
  private disposed = false;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    deviceId: string,
    flowConfig: FlowConfig,
    appendStep: (step: any) => Promise<void>
  ): Promise<void> {
    if (AndroidMirrorPanel.current) {
      AndroidMirrorPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'flowRecorder.androidMirror',
      `Android mirror - ${deviceId}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const mirror = new AndroidMirrorPanel(context, panel, deviceId, flowConfig, appendStep);
    AndroidMirrorPanel.current = mirror;
    await mirror.init();
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    private readonly deviceId: string,
    private readonly flowConfig: FlowConfig,
    private readonly appendStep: (step: any) => Promise<void>
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private async init(): Promise<void> {
    try {
      this.screenSize = await adb.getScreenSize(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not read device screen size: ${err.message}`);
    }
    this.startPolling();
    this.startElementPolling();
  }

  private startPolling(): void {
    const intervalMs = 700;
    const tick = async () => {
      if (this.disposed) return;
      try {
        const png = await adb.screenshot(this.deviceId);
        this.panel.webview.postMessage({ type: 'frame', data: png.toString('base64') });
      } catch {
        // Device briefly busy or reconnecting - keep polling.
      }
      if (!this.disposed) {
        this.pollTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private startElementPolling(): void {
    const intervalMs = 2500;
    const tick = async () => {
      if (this.disposed) return;
      await this.refreshElements();
      if (!this.disposed) {
        this.elementTimer = setTimeout(tick, intervalMs);
      }
    };
    tick();
  }

  private async refreshElements(): Promise<void> {
    if (this.dumping || !this.screenSize) return;
    this.dumping = true;
    try {
      const xml = await adb.dumpUiHierarchy(this.deviceId);
      const nodes = parseUiNodes(xml);
      this.selectableNodes = filterSelectableNodes(nodes, this.screenSize);
      const screen = this.screenSize;
      const payload = this.selectableNodes.map((n) => {
        const c = elementCenter(n);
        return {
          elementId: n.elementId,
          text: n.text,
          resourceId: n.resourceId,
          contentDesc: n.contentDesc,
          left: n.bounds.left / screen.width,
          top: n.bounds.top / screen.height,
          width: (n.bounds.right - n.bounds.left) / screen.width,
          height: (n.bounds.bottom - n.bounds.top) / screen.height,
          selector: resolveElementSelector(n, c.x, c.y, screen)
        };
      });
      this.panel.webview.postMessage({ type: 'elements', nodes: payload });
    } catch {
      // Hierarchy dump can fail transiently; keep the previous overlay.
    } finally {
      this.dumping = false;
    }
  }

  private async emit(step: any): Promise<void> {
    const stamped = this.optional ? { ...step, optional: true } : step;
    await this.appendStep(stamped);
  }

  private nodeAt(elementId: number | undefined): SelectableUiNode | undefined {
    if (elementId === undefined) return undefined;
    return this.selectableNodes[elementId];
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'optional':
        this.optional = !!msg.value;
        break;
      case 'tap':
        await this.handleRawTap(msg.xPct, msg.yPct);
        break;
      case 'elementTap':
        await this.handleElementAction(msg.elementId, 'tapOn', 'tap');
        break;
      case 'longPress':
        await this.handlePointGesture(msg, 'longPressOn', 'longPress');
        break;
      case 'doubleTap':
        await this.handlePointGesture(msg, 'doubleTapOn', 'doubleTap');
        break;
      case 'swipe':
        await this.handleSwipe(msg);
        break;
      case 'inputText':
        await this.handleInputText(msg);
        break;
      case 'eraseText':
        await this.handleEraseText(msg.count);
        break;
      case 'pressKey':
        await this.handlePressKey(msg.key);
        break;
      case 'back':
        await this.handleBack();
        break;
      case 'hideKeyboard':
        await this.handleHideKeyboard();
        break;
      case 'launchApp':
        await this.handleLaunchApp(!!msg.clearState);
        break;
      case 'stopApp':
        await this.handleStopApp();
        break;
      case 'killApp':
        await this.handleKillApp(!!msg.clearState);
        break;
      case 'clearState':
        await this.handleClearState();
        break;
      case 'setOrientation':
        await this.handleSetOrientation(msg.orientation);
        break;
      case 'takeScreenshot':
        await this.handleTakeScreenshot(msg.name);
        break;
      case 'setClipboard':
        await this.handleSetClipboard(msg.text);
        break;
      case 'pasteText':
        await this.handlePasteText();
        break;
      case 'setAirplaneMode':
        await this.handleSetAirplaneMode(!!msg.enabled);
        break;
      case 'toggleAirplaneMode':
        await this.handleToggleAirplaneMode();
        break;
      case 'toggleDarkMode':
        await this.handleToggleDarkMode();
        break;
      case 'scroll':
        await this.handleScroll();
        break;
      case 'assertVisible':
        await this.handleAssert(msg.elementId, true);
        break;
      case 'assertNotVisible':
        await this.handleAssert(msg.elementId, false);
        break;
    }
  }

  private async handleRawTap(xPct: number, yPct: number): Promise<void> {
    if (!this.screenSize) return;
    const x = xPct * this.screenSize.width;
    const y = yPct * this.screenSize.height;
    try {
      await adb.tap(this.deviceId, x, y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send tap to device: ${err.message}`);
      return;
    }
    const node = findSmallestNodeAtPoint(this.selectableNodes, x, y);
    await this.emit({ tapOn: resolveElementSelector(node, x, y, this.screenSize) });
    void this.refreshElements();
  }

  private async handleElementAction(
    elementId: number,
    commandKey: string,
    action: 'tap' | 'longPress' | 'doubleTap'
  ): Promise<void> {
    if (!this.screenSize) return;
    const node = this.nodeAt(elementId);
    if (!node) {
      vscode.window.showWarningMessage('Element no longer present - refresh and try again.');
      return;
    }
    const c = elementCenter(node);
    try {
      if (action === 'tap') await adb.tap(this.deviceId, c.x, c.y);
      else if (action === 'longPress') await adb.longPress(this.deviceId, c.x, c.y);
      else await adb.doubleTap(this.deviceId, c.x, c.y);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
      return;
    }
    await this.emit({ [commandKey]: resolveElementSelector(node, c.x, c.y, this.screenSize) });
    void this.refreshElements();
  }

  private async handlePointGesture(
    msg: any,
    commandKey: string,
    action: 'longPress' | 'doubleTap'
  ): Promise<void> {
    if (!this.screenSize) return;
    const node = this.nodeAt(msg.elementId);
    if (node) {
      const c = elementCenter(node);
      try {
        if (action === 'longPress') await adb.longPress(this.deviceId, c.x, c.y);
        else await adb.doubleTap(this.deviceId, c.x, c.y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: resolveElementSelector(node, c.x, c.y, this.screenSize) });
    } else {
      const x = msg.xPct * this.screenSize.width;
      const y = msg.yPct * this.screenSize.height;
      try {
        if (action === 'longPress') await adb.longPress(this.deviceId, x, y);
        else await adb.doubleTap(this.deviceId, x, y);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to send ${action} to device: ${err.message}`);
        return;
      }
      await this.emit({ [commandKey]: resolveElementSelector(undefined, x, y, this.screenSize) });
    }
    void this.refreshElements();
  }

  private async handleSwipe(msg: any): Promise<void> {
    if (!this.screenSize) return;
    const sx = msg.startXpct * this.screenSize.width;
    const sy = msg.startYpct * this.screenSize.height;
    const ex = msg.endXpct * this.screenSize.width;
    const ey = msg.endYpct * this.screenSize.height;
    try {
      await adb.swipe(this.deviceId, sx, sy, ex, ey);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to send swipe to device: ${err.message}`);
      return;
    }
    const direction = classifySwipeDirection({ x: sx, y: sy }, { x: ex, y: ey });
    await this.emit({ swipe: { direction } });
    void this.refreshElements();
  }

  private async handleInputText(msg: any): Promise<void> {
    if (!msg.text || !this.screenSize) return;
    const node = this.nodeAt(msg.elementId);
    try {
      if (node) {
        const c = elementCenter(node);
        await adb.tap(this.deviceId, c.x, c.y);
        await this.emit({ tapOn: resolveElementSelector(node, c.x, c.y, this.screenSize) });
      }
      await adb.inputText(this.deviceId, msg.text);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to input text: ${err.message}`);
      return;
    }
    await this.emit({ inputText: msg.text });
    void this.refreshElements();
  }

  private async handleEraseText(count: number): Promise<void> {
    try {
      await adb.eraseText(this.deviceId, count);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to erase text: ${err.message}`);
      return;
    }
    await this.emit({ eraseText: count });
  }

  private async handlePressKey(key: string): Promise<void> {
    try {
      await adb.pressKey(this.deviceId, key);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to press key: ${err.message}`);
      return;
    }
    await this.emit({ pressKey: key });
  }

  private async handleBack(): Promise<void> {
    try {
      await adb.back(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to go back: ${err.message}`);
      return;
    }
    await this.emit('back');
  }

  private async handleHideKeyboard(): Promise<void> {
    try {
      await adb.hideKeyboard(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to hide keyboard: ${err.message}`);
      return;
    }
    await this.emit('hideKeyboard');
  }

  private appId(): string | undefined {
    return this.flowConfig.appId || undefined;
  }

  private async handleLaunchApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) {
      vscode.window.showErrorMessage('No appId in the flow config - add one to launch the app.');
      return;
    }
    try {
      await adb.launchApp(this.deviceId, appId);
      if (clearState) await adb.clearState(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to launch app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { launchApp: { appId, clearState: true } } : { launchApp: { appId } });
    void this.refreshElements();
  }

  private async handleStopApp(): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.stopApp(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop app: ${err.message}`);
      return;
    }
    await this.emit('stopApp');
  }

  private async handleKillApp(clearState: boolean): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.killApp(this.deviceId, appId, clearState);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to kill app: ${err.message}`);
      return;
    }
    await this.emit(clearState ? { killApp: { clearState: true } } : 'killApp');
  }

  private async handleClearState(): Promise<void> {
    const appId = this.appId();
    if (!appId) return;
    try {
      await adb.clearState(this.deviceId, appId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to clear state: ${err.message}`);
      return;
    }
    await this.emit('clearState');
  }

  private async handleSetOrientation(orientation: string): Promise<void> {
    try {
      await adb.setOrientation(this.deviceId, orientation);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set orientation: ${err.message}`);
      return;
    }
    await this.emit({ setOrientation: orientation });
  }

  private async handleTakeScreenshot(name: string): Promise<void> {
    const clean = (name || 'step').trim().replace(/\.png$/, '');
    const fileName = `${clean}.png`;
    try {
      const png = await adb.screenshot(this.deviceId);
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        const dir = vscode.Uri.joinPath(folder.uri, 'assets');
        await vscode.workspace.fs.createDirectory(dir);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, fileName), png);
      }
    } catch (err: any) {
      vscode.window.showWarningMessage(`Could not save screenshot (${err.message}) - step still recorded.`);
    }
    await this.emit({ takeScreenshot: `assets/${fileName}` });
  }

  private async handleSetClipboard(text: string): Promise<void> {
    if (!text) return;
    await adb.setClipboard(this.deviceId, text);
    await this.emit({ setClipboard: text });
  }

  private async handlePasteText(): Promise<void> {
    try {
      await adb.pasteText(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to paste text: ${err.message}`);
      return;
    }
    await this.emit('pasteText');
  }

  private async handleSetAirplaneMode(enabled: boolean): Promise<void> {
    try {
      await adb.setAirplaneMode(this.deviceId, enabled);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to set airplane mode: ${err.message}`);
      return;
    }
    await this.emit({ setAirplaneMode: enabled });
  }

  private async handleToggleAirplaneMode(): Promise<void> {
    await this.emit('toggleAirplaneMode');
  }

  private async handleToggleDarkMode(): Promise<void> {
    this.darkMode = !this.darkMode;
    try {
      await adb.setDarkMode(this.deviceId, this.darkMode);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to toggle dark mode: ${err.message}`);
      return;
    }
    await this.emit('toggleDarkMode');
  }

  private async handleScroll(): Promise<void> {
    try {
      await adb.scroll(this.deviceId);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to scroll: ${err.message}`);
      return;
    }
    await this.emit('scroll');
    void this.refreshElements();
  }

  private async handleAssert(elementId: number, visible: boolean): Promise<void> {
    const node = this.nodeAt(elementId);
    if (!node || !this.screenSize) {
      vscode.window.showWarningMessage('Hover an element to assert it.');
      return;
    }
    const c = elementCenter(node);
    const selector = resolveElementSelector(node, c.x, c.y, this.screenSize);
    await this.emit(visible ? { assertVisible: selector } : { assertNotVisible: selector });
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mirror.js')
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mirror.css')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="status">Connecting to device...</div>
  <div id="mirror-toolbar">
    <div class="row">
      <button data-action="tap">Tap</button>
      <button data-action="longPress">Long press</button>
      <button data-action="doubleTap">Double tap</button>
      <button data-action="assertVisible">Assert visible</button>
      <button data-action="assertNotVisible">Assert not visible</button>
    </div>
    <div class="row">
      <input id="inputText" type="text" placeholder="Text to type..." />
      <button id="doInput">Input</button>
      <input id="eraseCount" type="number" value="50" min="1" max="100" />
      <button id="doErase">Erase</button>
      <button data-action="pressKey" data-key="back">Back</button>
      <button data-action="pressKey" data-key="home">Home</button>
      <button data-action="pressKey" data-key="enter">Enter</button>
      <button data-action="hideKeyboard">Hide KB</button>
    </div>
    <div class="row">
      <button data-action="setOrientation" data-orientation="LANDSCAPE">Landscape</button>
      <button data-action="setOrientation" data-orientation="PORTRAIT">Portrait</button>
      <button data-action="scroll">Scroll</button>
      <button data-action="pasteText">Paste</button>
      <label class="opt"><input id="optional" type="checkbox" /> optional</label>
    </div>
    <div class="row">
      <label class="opt">Clear state <input id="launchClear" type="checkbox" /></label>
      <button data-action="launchApp">Launch app</button>
      <button data-action="stopApp">Stop</button>
      <button data-action="killApp">Kill</button>
      <button data-action="clearState">Clear state</button>
      <button data-action="toggleDarkMode">Dark mode</button>
      <button data-action="toggleAirplaneMode">Airplane</button>
    </div>
    <div class="row">
      <input id="screenshotName" type="text" placeholder="screenshot-name" />
      <button id="doScreenshot">Screenshot</button>
    </div>
  </div>
  <div id="stage">
    <canvas id="screen"></canvas>
    <div id="overlay"></div>
    <div id="tooltip"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    this.disposed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.elementTimer) clearTimeout(this.elementTimer);
    AndroidMirrorPanel.current = undefined;
  }
}
```

- [ ] **Step 2: Update `src/extension.ts` to pass the flow config**

In `src/extension.ts`, change the import to also bring in `parseFlowDocument`:

```ts
import { appendFlowStep, parseFlowDocument } from './flowDocument';
```

And change the mirror command's tail so `createOrShow` receives the flow config:

```ts
      const config = parseFlowDocument(document).config;
      await AndroidMirrorPanel.createOrShow(context, deviceId, config, (step) => appendFlowStep(document, step));
```

- [ ] **Step 3: Remove the now-unused `toMaestroSelector` shim**

Delete the `toMaestroSelector` function from `src/android/uiautomator.ts` (the rewritten panel uses `resolveElementSelector`; the shim from Task 3 has no remaining callers).

- [ ] **Step 4: Verify compile and regression**

Run: `npm run test:unit`
Expected: PASS (compiles; confirms removing `toMaestroSelector` did not break the build).

- [ ] **Step 5: Commit**

```bash
git add src/mirrorPanel.ts src/extension.ts src/android/uiautomator.ts
git commit -m "feat: mirror panel element detection and full command handling"
```

---

### Task 6: Mirror webview (gestures, overlay, toolbar)

**Files:**
- Modify: `media/mirror.js` (full rewrite)
- Modify: `media/mirror.css` (append)

**Interfaces:**
- Consumes: the message contract from Task 5 (exact names above).
- Produces: the webview side of that contract.

- [ ] **Step 1: Rewrite `media/mirror.js`**

Replace the entire file:

```js
(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const overlay = document.getElementById('overlay');
  const tooltip = document.getElementById('tooltip');
  const img = new Image();
  let frameLoaded = false;
  let elements = [];
  let hoveredElement = null;
  let lastTapTime = 0;

  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    status.style.display = 'none';
    frameLoaded = true;
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'frame') {
      img.src = 'data:image/png;base64,' + msg.data;
    } else if (msg.type === 'elements') {
      elements = msg.nodes || [];
      renderOverlay();
    } else if (msg.type === 'status') {
      showStatus(msg.text);
    }
  });

  function rect() {
    return canvas.getBoundingClientRect();
  }

  function toPct(clientX, clientY) {
    const r = rect();
    return { xPct: (clientX - r.left) / r.width, yPct: (clientY - r.top) / r.height };
  }

  function elementAt(xPct, yPct) {
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        return e;
      }
    }
    return null;
  }

  function renderOverlay() {
    overlay.innerHTML = '';
    for (const e of elements) {
      const box = document.createElement('div');
      box.className = 'element-box';
      box.dataset.id = e.elementId;
      box.style.left = e.left * 100 + '%';
      box.style.top = e.top * 100 + '%';
      box.style.width = e.width * 100 + '%';
      box.style.height = e.height * 100 + '%';
      overlay.appendChild(box);
    }
  }

  function showStatus(text) {
    status.textContent = text;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }

  function selectorLabel(e) {
    return e.selector ? JSON.stringify(e.selector) : e.text || e.resourceId || e.contentDesc || '';
  }

  function updateHover(e) {
    hoveredElement = e;
    for (const el of overlay.children) {
      el.classList.toggle('hover', el.dataset.id === String(e && e.elementId));
    }
    if (e) {
      tooltip.textContent = selectorLabel(e);
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  }

  let gesture = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!frameLoaded) return;
    const p = toPct(e.clientX, e.clientY);
    gesture = { start: p, last: p, held: false, moved: false, startTime: Date.now() };
    gesture.holdTimer = setTimeout(() => { gesture.held = true; }, 500);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toPct(e.clientX, e.clientY);
    if (gesture) {
      const dx = Math.abs(p.xPct - gesture.start.xPct) * rect().width;
      const dy = Math.abs(p.yPct - gesture.start.yPct) * rect().height;
      if (Math.hypot(dx, dy) > 40) {
        gesture.moved = true;
        clearTimeout(gesture.holdTimer);
      }
      gesture.last = p;
    }
    updateHover(elementAt(p.xPct, p.yPct));
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!gesture) return;
    clearTimeout(gesture.holdTimer);
    const now = Date.now();
    const duration = now - gesture.startTime;
    const p = gesture.last;
    const el = elementAt(p.xPct, p.yPct);
    if (gesture.moved) {
      vscode.postMessage({
        type: 'swipe',
        startXpct: gesture.start.xPct,
        startYpct: gesture.start.yPct,
        endXpct: p.xPct,
        endYpct: p.yPct
      });
    } else if (gesture.held) {
      vscode.postMessage({
        type: 'longPress',
        elementId: el ? el.elementId : undefined,
        xPct: p.xPct,
        yPct: p.yPct
      });
    } else if (now - lastTapTime < 250) {
      vscode.postMessage({
        type: 'doubleTap',
        elementId: el ? el.elementId : undefined,
        xPct: p.xPct,
        yPct: p.yPct
      });
    } else if (el) {
      vscode.postMessage({ type: 'elementTap', elementId: el.elementId });
    } else {
      vscode.postMessage({ type: 'tap', xPct: p.xPct, yPct: p.yPct });
    }
    lastTapTime = now;
    gesture = null;
    showTapDot(p);
  });

  function showTapDot(p) {
    const r = rect();
    const dot = document.createElement('div');
    dot.className = 'tap-dot';
    dot.style.left = r.left + p.xPct * r.width + 'px';
    dot.style.top = r.top + p.yPct * r.height + 'px';
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 300);
  }

  const optionalBox = document.getElementById('optional');
  optionalBox.addEventListener('change', () => {
    vscode.postMessage({ type: 'optional', value: optionalBox.checked });
  });

  const inputField = document.getElementById('inputText');
  function doInput() {
    const text = inputField.value;
    if (!text) return;
    vscode.postMessage({ type: 'inputText', text, elementId: hoveredElement && hoveredElement.elementId });
    inputField.value = '';
  }
  document.getElementById('doInput').addEventListener('click', doInput);
  inputField.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInput(); });

  document.getElementById('doErase').addEventListener('click', () => {
    const count = parseInt(document.getElementById('eraseCount').value, 10) || 50;
    vscode.postMessage({ type: 'eraseText', count });
  });

  document.getElementById('doScreenshot').addEventListener('click', () => {
    const name = document.getElementById('screenshotName').value.trim();
    vscode.postMessage({ type: 'takeScreenshot', name });
    document.getElementById('screenshotName').value = '';
  });

  const launchClear = document.getElementById('launchClear');

  const singleActions = {
    tap: () => {
      if (hoveredElement) vscode.postMessage({ type: 'elementTap', elementId: hoveredElement.elementId });
      else showStatus('Hover an element to tap it');
    },
    longPress: () => vscode.postMessage({ type: 'longPress', elementId: hoveredElement && hoveredElement.elementId }),
    doubleTap: () => vscode.postMessage({ type: 'doubleTap', elementId: hoveredElement && hoveredElement.elementId }),
    assertVisible: () => vscode.postMessage({ type: 'assertVisible', elementId: hoveredElement && hoveredElement.elementId }),
    assertNotVisible: () => vscode.postMessage({ type: 'assertNotVisible', elementId: hoveredElement && hoveredElement.elementId }),
    back: () => vscode.postMessage({ type: 'back' }),
    hideKeyboard: () => vscode.postMessage({ type: 'hideKeyboard' }),
    pasteText: () => vscode.postMessage({ type: 'pasteText' }),
    scroll: () => vscode.postMessage({ type: 'scroll' }),
    stopApp: () => vscode.postMessage({ type: 'stopApp' }),
    killApp: () => vscode.postMessage({ type: 'killApp' }),
    clearState: () => vscode.postMessage({ type: 'clearState' }),
    toggleDarkMode: () => vscode.postMessage({ type: 'toggleDarkMode' }),
    toggleAirplaneMode: () => vscode.postMessage({ type: 'toggleAirplaneMode' })
  };

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (singleActions[action]) {
        singleActions[action]();
        return;
      }
      if (action === 'pressKey') {
        vscode.postMessage({ type: 'pressKey', key: btn.dataset.key });
      } else if (action === 'setOrientation') {
        vscode.postMessage({ type: 'setOrientation', orientation: btn.dataset.orientation });
      } else if (action === 'launchApp') {
        vscode.postMessage({ type: 'launchApp', clearState: launchClear.checked });
      }
    });
  });
})();
```

- [ ] **Step 2: Update `media/mirror.css`**

Append to the file:

```css
#stage {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}

#overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.element-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(56, 138, 221, 0);
  transition: border-color 0.08s ease, background-color 0.08s ease;
}

.element-box.hover {
  border-color: #388add;
  background: rgba(56, 138, 221, 0.12);
}

#tooltip {
  position: absolute;
  top: 8px;
  left: 8px;
  display: none;
  background: var(--vscode-editorWidget-background, #252526);
  color: var(--vscode-foreground);
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 3px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  max-width: 80%;
  word-break: break-all;
  z-index: 10;
}

#tooltip.show {
  display: block;
}

#mirror-toolbar {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--vscode-panel-border, #444);
}

#mirror-toolbar .row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

#mirror-toolbar input[type="text"],
#mirror-toolbar input[type="number"] {
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, #444);
  padding: 3px 6px;
  font-size: 12px;
  width: auto;
}

#mirror-toolbar input#inputText {
  width: 160px;
}

#mirror-toolbar input#eraseCount {
  width: 56px;
}

#mirror-toolbar button {
  font-size: 12px;
  padding: 3px 8px;
}

#mirror-toolbar .opt {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
```

- [ ] **Step 3: Syntax-check and cross-check the contract**

Run: `node --check media/mirror.js`
Expected: no output, exit 0.

Cross-check every message name in `mirror.js` against the Task 5 contract: `swipe`, `longPress`, `doubleTap`, `elementTap`, `tap`, `optional`, `inputText`, `eraseText`, `takeScreenshot`, `back`, `hideKeyboard`, `pasteText`, `scroll`, `stopApp`, `killApp`, `clearState`, `toggleDarkMode`, `toggleAirplaneMode`, `pressKey`, `setOrientation`, `launchApp`, `assertVisible`, `assertNotVisible`.

- [ ] **Step 4: Commit**

```bash
git add media/mirror.js media/mirror.css
git commit -m "feat: mirror webview gestures, element overlay, and toolbar"
```

---

### Task 7: Editor "+ Command" menu and optional toggle

**Files:**
- Modify: `src/flowEditorProvider.ts`
- Modify: `media/main.js`
- Modify: `media/main.css`

**Interfaces:**
- Consumes: `appendFlowStep` (existing) and `updateStep` from Task 4.
- Produces (webview -> provider messages): `{ type: 'addCommand', command: { type, args } }`, `{ type: 'setOptional', index, optional }`.
- Locked `command.args` shapes per `command.type`:
  - `assertVisible` / `assertNotVisible`: `{ selector }`
  - `waitForAnimationToEnd`: `{ timeout }`
  - `extendedWaitUntil`: `{ selector, timeout }`
  - `openLink`: `{ uri }`
  - `runFlow`: `{ path }`
  - `copyTextFrom`: `{ selector, toVar }`

- [ ] **Step 1: Add command builder + handlers to `src/flowEditorProvider.ts`**

Add `updateStep` to the existing import:

```ts
import { parseFlowDocument, appendFlowStep, deleteFlowStep, updateStep } from './flowDocument';
```

Add a module-level builder function before the class:

```ts
function buildCommandStep(command: { type: string; args: Record<string, any> }): any {
  const positiveNumber = (v: any, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  switch (command.type) {
    case 'assertVisible':
      return { assertVisible: { text: command.args.selector } };
    case 'assertNotVisible':
      return { assertNotVisible: { text: command.args.selector } };
    case 'waitForAnimationToEnd':
      return { waitForAnimationToEnd: { timeout: positiveNumber(command.args.timeout, 5000) } };
    case 'extendedWaitUntil':
      return {
        extendedWaitUntil: {
          visible: command.args.selector,
          timeout: positiveNumber(command.args.timeout, 120000)
        }
      };
    case 'openLink':
      return { openLink: command.args.uri };
    case 'runFlow':
      return { runFlow: command.args.path };
    case 'copyTextFrom':
      return { copyTextFrom: { text: command.args.selector, to: command.args.toVar } };
    default:
      return undefined;
  }
}
```

Add two cases to the `onDidReceiveMessage` switch (next to the existing `deleteStep`):

```ts
        case 'addCommand': {
          const step = buildCommandStep(message.command);
          if (step) await appendFlowStep(document, step);
          break;
        }

        case 'setOptional':
          await updateStep(document, message.index, { optional: message.optional });
          break;
```

Add the "+ Command" button and form to `getHtml()` — inside the existing `#toolbar` div, after the `addScreenshot` button:

```html
    <button id="addCommandBtn">+ Command</button>
```

And immediately after the existing `#apiForm` div, add:

```html
  <div id="commandForm" class="hidden">
    <div class="form-row">
      <select id="commandType">
        <option value="assertVisible">assertVisible</option>
        <option value="assertNotVisible">assertNotVisible</option>
        <option value="waitForAnimationToEnd">waitForAnimationToEnd</option>
        <option value="extendedWaitUntil">extendedWaitUntil</option>
        <option value="openLink">openLink</option>
        <option value="runFlow">runFlow</option>
        <option value="copyTextFrom">copyTextFrom</option>
      </select>
    </div>
    <div id="commandFields"></div>
    <div class="form-row form-actions">
      <button id="commandCancel" class="secondary">Cancel</button>
      <button id="commandSubmit">Add</button>
    </div>
  </div>
```

- [ ] **Step 2: Update `media/main.js`**

Append the command-menu logic before the closing `})();`:

```js
  const commandForm = document.getElementById('commandForm');
  const commandType = document.getElementById('commandType');
  const commandFields = document.getElementById('commandFields');
  const commandSubmit = document.getElementById('commandSubmit');

  const FIELD_SPECS = {
    assertVisible: [{ id: 'selector', label: 'Text or selector', type: 'text' }],
    assertNotVisible: [{ id: 'selector', label: 'Text or selector', type: 'text' }],
    waitForAnimationToEnd: [{ id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 5000 }],
    extendedWaitUntil: [
      { id: 'selector', label: 'Visible text', type: 'text' },
      { id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 120000 }
    ],
    openLink: [{ id: 'uri', label: 'Link / URI', type: 'text' }],
    runFlow: [{ id: 'path', label: 'Flow file path', type: 'text' }],
    copyTextFrom: [
      { id: 'selector', label: 'Element text', type: 'text' },
      { id: 'toVar', label: 'Variable name', type: 'text' }
    ]
  };

  function renderCommandFields() {
    commandFields.innerHTML = '';
    const specs = FIELD_SPECS[commandType.value] || [];
    specs.forEach((spec) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.textContent = spec.label;
      const input = document.createElement('input');
      input.type = spec.type || 'text';
      input.id = 'cmd-' + spec.id;
      input.value = spec.value !== undefined ? spec.value : '';
      row.appendChild(label);
      row.appendChild(input);
      commandFields.appendChild(row);
    });
  }

  document.getElementById('addCommandBtn').addEventListener('click', () => {
    commandForm.classList.remove('hidden');
    renderCommandFields();
    commandType.focus();
  });

  document.getElementById('commandCancel').addEventListener('click', () => {
    commandForm.classList.add('hidden');
  });

  commandType.addEventListener('change', renderCommandFields);

  commandSubmit.addEventListener('click', () => {
    const args = {};
    const specs = FIELD_SPECS[commandType.value] || [];
    specs.forEach((spec) => {
      args[spec.id] = document.getElementById('cmd-' + spec.id).value;
    });
    vscode.postMessage({
      type: 'addCommand',
      command: { type: commandType.value, args }
    });
    commandForm.classList.add('hidden');
  });
```

Then update the `render(doc)` function so every block card carries an optional checkbox. Inside the `steps.forEach((step, index) => { ... })` block, before `card.appendChild(body);`, insert:

```js
      const optWrap = document.createElement('label');
      optWrap.className = 'opt-toggle';
      const optBox = document.createElement('input');
      optBox.type = 'checkbox';
      optBox.checked = !!step.optional;
      optBox.onchange = () => vscode.postMessage({ type: 'setOptional', index, optional: optBox.checked });
      optWrap.appendChild(optBox);
      optWrap.appendChild(document.createTextNode(' optional'));
      card.appendChild(optWrap);
```

- [ ] **Step 3: Update `media/main.css`**

Append:

```css
.opt-toggle {
  position: absolute;
  top: 6px;
  right: 26px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #bbb);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

#commandForm input {
  flex: 1;
  min-width: 0;
}
```

`.block-card` already sets `position: relative` (needed for the absolutely-positioned `.opt-toggle`), so no change is required there.

- [ ] **Step 4: Verify compile, syntax, and contract**

Run: `npm run test:unit && node --check media/main.js`
Expected: PASS + exit 0.

Cross-check the editor messages: `addCommand`, `setOptional` present in both `media/main.js` and `flowEditorProvider.ts`; `args` keys match the Task Interfaces table.

- [ ] **Step 5: Commit**

```bash
git add src/flowEditorProvider.ts media/main.js media/main.css
git commit -m "feat: editor command menu and per-step optional toggle"
```

---

### Task 8: README update and full manual verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README Android mirror section**

In `README.md`, replace the "What's real vs. what's next" section's Android paragraph with a summary of the new capabilities: element highlighting on load, gesture recording (tap / long press / double tap / swipe), toolbar actions (text input, erase, keys, orientation, lifecycle, clipboard, network, dark mode, screenshot, scroll, asserts), and the editor "+ Command" menu. Note that manual on-device verification is still required for the device-facing pieces.

- [ ] **Step 2: Run the full automated gate**

Run: `npm run test:unit && node --check media/mirror.js && node --check media/main.js`
Expected: all PASS.

- [ ] **Step 3: Manual verification checklist (on the emulator, from the user's terminal — the sandbox blocks GUI/adb)**

1. Start adb + emulator: `adb start-server && adb devices` (a `device` row required).
2. Launch: `code --extensionDevelopmentPath=/Users/aeediga/Downloads/flow-recorder /Users/aeediga/Downloads/flow-recorder/examples/example.flow.yaml`
3. Command Palette → **Flow Recorder: Start Android Mirror**. Verify:
   - The device screen appears and **highlight boxes overlay selectable elements** within ~2.5s.
   - **Hover** an element → box brightens + tooltip shows the selector.
   - **Click** an element → records `tapOn: {text|id}` and taps the device.
   - **Click empty space** → records `tapOn: {point: "x%,y%"}`.
   - **Hold** → `longPressOn`; **two quick taps** → `doubleTapOn`; **drag** → `swipe: {direction}`.
   - Toolbar: **Input** types into the hovered field and records `tapOn` + `inputText`; **Erase** records `eraseText`; Back/Home/Enter record `pressKey`; Landscape/Portrait record `setOrientation`; Launch/Stop/Kill/Clear state; Dark mode; Airplane; Screenshot (saves PNG to `assets/`); Scroll; Assert visible/not visible on hovered element.
   - The **optional** checkbox stamps new steps with `optional: true`.
4. Editor: reopen the flow — click **+ Command**, pick each type, verify the YAML appended is correct (inspect via "Reopen Editor With... > Text Editor"). Toggle **optional** on a block and confirm it round-trips.
5. Confirm `npm run test:unit` still green after any edits.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update Android mirror capabilities"
```
