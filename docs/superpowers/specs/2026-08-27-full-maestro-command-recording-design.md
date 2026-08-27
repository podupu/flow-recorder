# Design: Full Maestro Command Recording with Element Highlighting

Date: 2026-08-27
Status: Approved-in-principle (scope + interaction model confirmed by user)

## Goal

Turn the Flow Recorder VS Code extension's Android mirror from a tap-only recorder
into a Maestro-Studio-style recorder that can produce every Maestro command that fits
a visual recording model. The mirror detects and highlights UI elements so the user
can see and select them before acting, exactly like Maestro Studio.

Command vocabulary is grounded in the official docs
(`https://docs.maestro.dev/reference/commands-available.md`).

## Scope

### A. Canvas gestures — captured automatically via pointer tracking

| Command | Capture | Output step |
|---|---|---|
| `tapOn` | pointer down+up, no movement (existing) | `tapOn: {text\|id\|point}` |
| `longPressOn` | pointer down, held >= 500ms, released with < 10px movement | `longPressOn: {text\|id\|point}` |
| `doubleTapOn` | two taps within 250ms | `doubleTapOn: {text\|id\|point}` |
| `swipe` | pointer down, movement >= threshold, up; dominant axis wins | `swipe: {direction: UP\|DOWN\|LEFT\|RIGHT}` |
| `inputText` | type box + "Input" button; injects via adb | `inputText: <text>` |
| `eraseText` | form: char count (default 50, max 100) | `eraseText: N` |

### B. Mirror toolbar — device / app actions

| Command | Form / behavior | Output step |
|---|---|---|
| `pressKey` | Back / Home / Enter / Backspace / Vol Up / Vol Down | `pressKey: "back"` |
| `back` | one-click | `back` |
| `hideKeyboard` | one-click | `hideKeyboard` |
| `launchApp` | appId (defaults to flow config) + clearState checkbox | `launchApp: {appId, clearState?}` |
| `stopApp` | one-click | `stopApp` |
| `killApp` | one-click (+ clearState option) | `killApp: {clearState?}` |
| `clearState` | one-click | `clearState` |
| `setOrientation` | Landscape / Portrait | `setOrientation: LANDSCAPE` |
| `takeScreenshot` | name field; best-effort save of real frame to `assets/` | `takeScreenshot: <name>` |
| `setClipboard` | text field (best-effort live set) | `setClipboard: <text>` |
| `pasteText` | one-click | `pasteText` |
| `setAirplaneMode` / `toggleAirplaneMode` | on/off | `setAirplaneMode: true` |
| `toggleDarkMode` | one-click | `toggleDarkMode` |
| `scroll` | one-click (vertical swipe) | `scroll` |
| `assertVisible` / `assertNotVisible` | act on hovered element (see Interaction model) | `assertVisible: {text: <sel>}` |

> Note: `assertVisible` / `assertNotVisible` are also available from the editor's
> "+ Command" menu (Section C) for hand-typed selectors. The mirror buttons target
> the element currently under the pointer, so the two surfaces don't conflict.

### C. Editor toolbar — structural commands (from a "+ Command" menu)

| Command | Form | Output step |
|---|---|---|
| `assertVisible` | text selector | `assertVisible: {text: <sel>}` |
| `assertNotVisible` | text selector | `assertNotVisible: {text: <sel>}` |
| `waitForAnimationToEnd` | timeout ms (default 5000) | `waitForAnimationToEnd: {timeout: N}` |
| `extendedWaitUntil` | visible text + timeout ms (default 120000) | `extendedWaitUntil: {visible: <sel>, timeout: N}` |
| `openLink` | URI | `openLink: <uri>` |
| `runFlow` | file path | `runFlow: <path>` |
| `copyTextFrom` | selector + `to:` var name | `copyTextFrom: {text: <sel>, to: <var>}` |

### Deferred (not studio-recording style)

`repeat` / `retry` (need a nested block editor), `assertTrue` / `evalScript` /
`runScript` (JS authoring), `assertScreenshot` (needs baseline images),
`scrollUntilVisible`, `setPermissions`, `setLocation` / `travel`, `addMedia`,
`clearKeychain` (iOS-only), `setDarkMode` / `assertDarkMode` / `assertLightMode`
(covered by `toggleDarkMode`; add later if wanted), `startRecording` /
`stopRecording` (video pipeline), AI commands `assertWithAI` /
`assertNoDefectsWithAI` / `extractTextWithAI` (need credentials).

## Element detection & highlight layer

The mirror overlays clickable highlight boxes on selectable UI elements.

**Pipeline** (in `mirrorPanel.ts` + `android/uiautomator.ts`):

1. Call `adb.dumpUiHierarchy(deviceId)`; parse with existing `parseUiNodes`.
2. Filter to selectable nodes via new `filterSelectableNodes(nodes, screenSize)`:
   has `text` / `resource-id` / `content-desc`; bounds valid; not a full-screen
   container (area < ~90% of screen). Non-empty but whitespace-only text counts.
3. Send `{type: 'elements', nodes: [...]}` to the webview. Each node carries its
   `elementId` (index), the raw fields, percentage bounds, and the selector Maestro
   would record for it (`{text}` preferred, then `{id}`, then `{contentDesc}`).

**Refresh cadence**: on panel init, after every recorded action, and on a ~2.5s idle
poll. Skip a dump while one is in flight. A dump failure keeps the previous overlay.

**Overlay rendering** (in `media/mirror.js` + `.css`): absolutely-positioned divs
over the canvas wrapper, positioned by percentage so they track the scaled canvas.
Hover brightens the box and shows a tooltip with the element's selector text.
Interaction is tap-first per user decision (Maestro Studio style).

## Interaction model

- **Hover** an element → highlight + tooltip (what would be recorded).
- **Click** a highlighted element → immediately records `tapOn: <selector>` and
  performs the real tap at the element's center.
- **Click** empty canvas → raw coordinate tap (point fallback), records
  `tapOn: {point: "x%,y%"}`.
- **Canvas drag** → swipe (`swipe: {direction}`) once the movement threshold is met.
- **Toolbar gesture buttons** (Long press / Double tap / Assert visible / Assert not
  visible / Input text) act on the element currently under the pointer (hover
  target). If none, show status "Hover an element first" and emit nothing. Raw
  point gestures remain available by dragging on empty canvas.
- **inputText**: if a text-field element is hovered, emits `tapOn: <field>` then
  `inputText: <text>`; otherwise just `inputText: <text>`.
- **Swipe** is never element-bound (direction-based), matching the flows' usage.

## Message protocol

**Mirror webview → panel** (`mirrorPanel.ts` handlers):

```
{tap, xPct, yPct}                      # raw canvas tap
{elementTap, elementId}                # tap on highlighted element
{gesture, type: longPress|doubleTap, elementId?}   # toolbar gesture on hovered element
{swipe, startXpct, startYpct, endXpct, endYpct}
{inputText, text, elementId?}
{eraseText, count}
{pressKey, key}
{back}  {hideKeyboard}  {pasteText}  {scroll}  {clearState}  {stopApp}
{launchApp, appId, clearState}  {killApp, clearState}
{setOrientation, orientation}  {toggleDarkMode}
{setAirplaneMode, enabled}  {toggleAirplaneMode}
{takeScreenshot, name}  {setClipboard, text}
{assertVisible, selector, elementId?}  {assertNotVisible, selector, elementId?}
{optional, value}                       # stamp flag for subsequent steps
```

**Panel → mirror webview**:

```
{frame, data}                    # existing
{elements, nodes}                # highlight overlay
{status, text}                   # transient status/toast
```

**Editor webview → provider** (`flowEditorProvider.ts` handlers):

```
{ready}  {addApiBlock, payload}  {addScreenshotBlock}  {deleteStep, index}   # existing
{addCommand, command: {type, args}}   # one handler for all Section C commands
{setOptional, index, optional}
```

## Code changes

### New: `src/gestures.ts` (pure, no vscode import)

- `classifyPointerGesture(start, end, durationMs)` -> `'tap' | 'longPress' | 'doubleTap' | 'swipe'`
- `classifySwipeDirection(dx, dy)` -> `'UP' | 'DOWN' | 'LEFT' | 'RIGHT'`
- Constants: `LONG_PRESS_MS = 500`, `DOUBLE_TAP_MS = 250`, `SWIPE_THRESHOLD_PX = 40`,
  `GESTURE_MOVE_TOLERANCE_PX = 10`, `ERASE_MAX = 100`.

### `src/android/adb.ts` — new functions

| Function | Mechanism |
|---|---|
| `longPress(id, x, y)` | `input swipe x y x y 600` |
| `doubleTap(id, x, y)` | two `input tap` with ~100ms gap |
| `inputText(id, text)` | `input text <escaped>` (space -> `%s`, shell-escaped) |
| `eraseText(id, count)` | `input keyevent 67` x count (KEYCODE_DEL) |
| `pressKey(id, key)` | key name -> keycode map (home 3, back 4, enter 66, backspace 67, vol up 24, vol down 25) |
| `back(id)` | `input keyevent 4` |
| `hideKeyboard(id)` | `input keyevent 4` (back) |
| `launchApp(id, appId)` | `monkey -p <appId> -c android.intent.category.LAUNCHER 1` |
| `stopApp(id, appId)` | `am force-stop <appId>` |
| `killApp(id, appId)` | `am force-stop` + `pm clear <appId>` |
| `clearState(id, appId)` | `pm clear <appId>` |
| `setOrientation(id, o)` | `settings put system accelerometer_rotation 0` + `user_rotation 0|1` |
| `setClipboard(id, text)` | best-effort `cmd clipboard`; failure still records command |
| `setAirplaneMode(id, on)` | `settings put global airplane_mode_on` + `am broadcast AIRPLANE_MODE` |
| `toggleDarkMode(id)` | `cmd uimode night yes|no` (toggle tracked in panel) |
| `scroll(id)` | `input swipe` bottom-center -> top-center (~80% height, 300ms) |

The appId used by lifecycle commands comes from the active flow's `appId` config
(`flowDocument.parseFlowDocument`), passed to `AndroidMirrorPanel.createOrShow`.

### `src/android/uiautomator.ts`

- Refactor `toMaestroSelector(node, x, y, screen)` into
  `resolveElementSelector(node, x, y, screen)` returning the inner
  `{text} | {id} | {point}` object; callers wrap it with the command key
  (`tapOn`, `longPressOn`, `doubleTapOn`, `assertVisible`, ...).
- Add `filterSelectableNodes(nodes, screenSize)`.

### `src/mirrorPanel.ts`

- Element dump loop (init, after actions, 2.5s idle poll) -> `elements` message.
- New message handlers for all Section A/B gestures and actions; element-aware
  resolution (elementId -> node -> `resolveElementSelector`).
- `optional` stamp flag applied to every appended step.
- `appendStep` callbacks now take the raw step; selector wrapping happens here.

### `src/flowDocument.ts`

- Add `updateStep(document, index, patch)` (used by `setOptional`).
- `appendFlowStep` unchanged; callers include `optional` in the step object.

### `src/flowEditorProvider.ts`

- Handle `addCommand` (one dispatcher building the YAML per Section C) and
  `setOptional`.
- Webview HTML: add the "+ Command" dropdown + forms.

### Media

- `media/mirror.js`: pointer-based gesture detection (replaces `click`),
  element overlay + hover/tooltip, tap-first click handling, toolbar (keys,
  orientation, lifecycle, clipboard, network, screenshot, optional checkbox).
- `media/mirror.css`: overlay boxes, tooltip, toolbar layout.
- `media/main.js`: "+ Command" menu + per-type forms, optional checkbox per block,
  `setOptional` messages.
- `media/main.css`: command forms, optional toggle styles.

## Optional toggle

- Every block card in the editor gets an **optional** checkbox -> `setOptional`.
- The mirror has an **optional** checkbox that stamps newly recorded steps with
  `optional: true`.

## Error handling

- Every adb call that can fail (tap/long-press/swipe/inject/key/orientation/
  lifecycle) shows an error message and never loses prior recorded state (same
  pattern as today's tap handler).
- Hierarchy dump failures keep the previous overlay and never break a gesture.
- Device disconnect mid-session: screenshot poll already tolerates it; element
  dump stops, overlay clears, a status message surfaces.
- Text injection is shell-escaped to avoid command injection.

## Verification

- **Unit tests** (new `test/unit/*.test.ts`, run via `npm run compile && mocha
  out/test/unit/*.test.js`): `gestures.ts` classification, `filterSelectableNodes`,
  adb text escaping, swipe direction. These modules avoid importing `vscode`.
- **Extension-host driver**: existing `test/suite/index.js` still compiles and
  dispatches the mirror command (runs only in a VS Code extension host).
- **Manual on emulator** (user environment, since the sandbox blocks GUI/adb):
  highlight overlay appears on load and updates after taps; click element records
  `tapOn: <selector>`; long-press/double-tap/swipe/text/keys/orientation produce
  correct YAML; "+ Command" forms append correct steps; optional toggles round-trip;
  YAML inspected via "Reopen Editor With... > Text Editor".
