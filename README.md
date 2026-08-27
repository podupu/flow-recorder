# Flow Recorder (scaffold)

A starting point for a Maestro Studio-style recorder built as a VS Code
custom editor, instead of a standalone app. `.flow.yaml` files stay real,
editable YAML on disk; opening one shows a visual block list (screenshot
blocks, API blocks) instead of raw text.

## What's here

- `src/extension.ts` - activates the extension, registers the custom editor.
- `src/flowEditorProvider.ts` - the core piece. Implements VS Code's
  `CustomTextEditorProvider`: keeps the on-disk YAML as the source of truth,
  renders a webview, and syncs edits both ways.
- `src/recorder.ts` - the "recording engine". `runApiRequest` is fully real
  (plain `fetch`). `captureScreenshotStub` is a **stub** - see the comment
  in that file for how to wire it to a real device via the Maestro CLI,
  ADB, or idb.
- `media/main.js` / `media/main.css` - the webview UI: renders blocks,
  handles the "+ API block" / "+ Screenshot block" buttons.
- `examples/example.flow.yaml` - a sample flow mixing a UI step, a
  screenshot, an API call, and an assertion.

## Run it

```bash
npm install
npm run compile
```

Then press `F5` in VS Code (with this folder open) to launch an Extension
Development Host window. In that window, open
`examples/example.flow.yaml` - it should open in the visual editor instead
of as plain text. Try the toolbar buttons; new steps get appended to the
real YAML file, which you can also inspect by right-clicking the tab and
choosing "Reopen Editor With..." -> "Text Editor".

## Android device mirror (Phase 1)

There's now a real, working Android recording path: **Flow Recorder: Start
Android Mirror** (Command Palette).

**Prerequisites**

- `adb` installed and on your `PATH` (comes with Android SDK
  platform-tools, or `brew install android-platform-tools` on macOS).
- Either a running Android emulator, or a real device connected over USB
  with USB debugging enabled and authorized.
- A `.flow.yaml` file open and active in the editor - the mirror always
  records into whichever flow is currently open.

**Usage**

1. Open a `.flow.yaml` file (e.g. `examples/example.flow.yaml`).
2. Run **Flow Recorder: Start Android Mirror** from the Command Palette.
   If more than one device is connected you'll be asked which one to use.
3. A panel opens beside your editor showing the device's screen (polled
   screenshots, refreshed roughly every 700ms).
4. Click anywhere on the mirrored screen. This taps the real device at
   that point, dumps the current UI hierarchy, and appends a step to your
   flow - preferring a readable selector (`tapOn: { text: ... }` /
   `id: ...`) and falling back to a percentage coordinate
   (`tapOn: { point: "42%,63%" }`) when no labeled element is found.

**What's real vs. what's next**

- The mirror shows the real device screen with **highlight boxes drawn
  over selectable elements** on load; hovering a box brightens it and
  shows its selector in a tooltip. Recording a gesture is as easy as
  interacting with the mirrored screen: **tap** (the hovered element's
  selector, or `point: "x%,y%"` for empty space), **long press**,
  **double tap**, and **swipe**.
- The mirror toolbar drives device actions from the editor: **text
  input** and **erase**; keys (Back/Home/Enter, hide keyboard);
  **orientation** (landscape/portrait); **app lifecycle** (launch/stop/
  kill, clear state); **clipboard** (set/paste); **network** (airplane
  mode); **dark mode**; **screenshot** (saves a PNG to `assets/`);
  **scroll**; and **asserts** (visible/not visible on the hovered
  element). An "optional" checkbox stamps new steps with
  `optional: true`.
- The editor toolbar has a **+ Command** menu that appends typed Maestro
  commands (`assertVisible`, `assertNotVisible`, `waitForAnimationToEnd`,
  `extendedWaitUntil`, `openLink`, `runFlow`, `copyTextFrom`), and each
  block's "optional" toggle round-trips with the YAML on disk.
- These device-facing pieces are implemented and compile clean, but they
  still need **manual on-device verification** against a real
  emulator/device before they're relied on in a recording.
- The live view uses **polled screenshots**, not real-time video. This was
  the deliberate, verified-reliable choice for this pass - it doesn't
  depend on any binary wire protocol, so there's nothing that can silently
  be wrong in a way I can't check from here.
- **Real-time video mirroring (scrcpy + WebCodecs)** is the natural next
  upgrade (see the architecture notes from the earlier research), but
  scrcpy's server communicates over a raw socket protocol that genuinely
  needs a physical device/emulator to iterate against and confirm byte-for-
  byte - not something to hand you as "done" without that loop. Once
  you've confirmed the screenshot-based flow works against your own
  device, that's the natural next thing to build, with you able to test
  each step directly.
- `captureScreenshotStub` in `src/recorder.ts` (the older, generic
  "Screenshot block" button in the base editor toolbar) is now superseded
  by the real Android mirror above for Android; it's still a placeholder
  for a future iOS path.

## Natural next steps

- Swap polled screenshots for scrcpy + WebCodecs video once verified
  against real hardware (biggest UX upgrade).
- Replace the `prompt()`-based API block form with a proper inline form
  (method dropdown, URL field, header/body editors) in `media/main.js`.
- Add reordering (drag-and-drop) of steps in the webview.
- Add a "run flow" command that replays all steps (API calls for real,
  UI steps via adb, once you're happy with the recording format).
- Build the iOS equivalent of the mirror panel (WebDriverAgent + MJPEG for
  simulators; see the architecture research for the real-device path).
