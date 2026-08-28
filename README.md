# Flow Recorder

**Record [Maestro](https://maestro.dev) mobile tests by tapping a mirrored device — without leaving your editor.**

Your device appears in a VS Code panel. Hover to see what each element resolves to, click to
record a step. The flow is written as ordinary YAML you can read, edit and commit.

Works with **Android** devices and emulators, and **iOS Simulators**.

---

## Why

Maestro Studio already lets you author flows — in a separate window, away from the file you
are editing and the rest of your project. Flow Recorder puts that loop inside the editor, and
adds the part that actually costs time once a suite exists: finding out **which selector
broke** when the UI changed.

## What it does

### Mirror a device and record by tapping

Open a flow, run **Flow Recorder: Start Device Mirror**, and pick a device. Android
devices, Android emulators and iOS Simulators all appear in one list — a shut-down simulator
is booted for you.

Hover an element to see its outline and the selector it resolves to. Tap, long-press,
double-tap and swipe are recorded as official Maestro steps, appended to whichever flow you
are looking at.

### Find broken selectors before a run fails

**Flow Recorder: Diagnose Broken Selectors** checks every selector in the open flow against
what is on screen right now, and reports the ones that no longer match — with a suggested
replacement where there is an obvious one.

```
tapOn selector no longer matches: text: Sign in.  Did you mean text: Sign In?
```

Selectors containing `${VARIABLES}` are reported as skipped rather than broken, because they
resolve at run time and cannot be judged statically. A false break is worse than no report.

### Run flows, and single steps, from the Testing view

Every flow appears in VS Code's Testing sidebar, and **every step gets its own play button in
the gutter** — hover a line and run from there. After a run, each step shows its state:
passed, failed, or never reached.

Two ways to run a step, because they answer different questions:

- **Run** invokes real `maestro`. This is the authoritative check, but `maestro` cannot
  continue from the app's current screen - verified by opening a settings screen and running a
  single `assertVisible` against it: Maestro's own failure screenshot showed the home screen.
  There is no CLI flag to avoid this. So a mid-flow Run writes a temporary flow with the setup
  prefix (`launchApp`, `clearState`) plus that step onward, and runs that.
- **Replay on live app** drives the mirrored device directly - the same taps and assertions
  the mirror already performs - so it genuinely continues from wherever the app is, and never
  invokes `maestro`. It is not a substitute for Run: `${variables}`, `runFlow`, `runScript` and
  `evalScript` need Maestro's own engine and are skipped, reported by name rather than guessed
  at. Use it to iterate on a single interaction without the app resetting each time; use Run to
  confirm the flow actually passes.

  Replay prefers the device an open mirror is already attached to; if none is open, it prompts
  you to pick one, the same as taking a screenshot from the editor does.

The **Debug** profile runs with `--debug-output` so screenshots, hierarchy dumps and logs
survive a failure.

> Maestro has no debug-adapter protocol, so this does not step through a flow. "Debug" means
> the artifacts are kept.

> Per-step states are reconstructed, not live. Maestro reports one result per flow — its JUnit
> report has a single `<testcase>`, and its piped output is a one-line summary, because the
> per-step view is TTY-only. Flow Recorder reads the failure message, marks the step it names
> as failed, everything before it as passed, and everything after as not reached.

### Switch environments without editing flows

Define named variable sets in `maestro-env.json`:

```json
{
  "environments": {
    "$shared": { "SHOW_LOGS": "true" },
    "staging":  { "BASE_URL": "https://staging.api.example.com" },
    "prod":     { "BASE_URL": "https://api.example.com" }
  }
}
```

Pick one from the status bar and it is injected as `maestro test -e KEY=VALUE`. Reference the
values in flows as `${BASE_URL}`. `$shared` applies to every environment, including "None".

> Keep credentials out of this file — it is meant to be committed. Pass secrets via `-e` from
> your shell or CI instead.

### Smaller things that add up

- **Clickable paths** — `runFlow`, `runScript` and `takeScreenshot` values open the file they
  point at.
- **The right schema.** SchemaStore maps `*.flow.yaml` to *both* Maestro Flow and Estuary Flow
  Catalog, and Estuary usually wins — producing `Incorrect type. Expected "Estuary Flow
  Catalog"` on a perfectly valid flow. This bundles the official Maestro schema and points the
  YAML language server at it, restoring correct validation and command autocomplete.
- **API steps as real commands.** Recording an API call emits `evalScript` + `assertTrue`, or
  `runScript` for anything with headers or a body — not an invented `apiRequest:` block.

### Which files count as flows

By default, Maestro's own convention — the same set the official schema uses:

```
**/*.flow.yaml        **/*.flow.yml
**/.maestro/**/*.yaml **/.maestro/**/*.yml
```

So a plain `login.yaml` inside `.maestro/` is recognised. If your project keeps flows
elsewhere, set `flowRecorder.flowPatterns`:

```json
"flowRecorder.flowPatterns": ["e2e-tests/**/*.yaml"]
```

Custom patterns replace the defaults rather than adding to them. Matching every `*.yaml` is
possible but not recommended — `docker-compose.yaml`, CI workflows and k8s manifests would
gain Flow Recorder commands and show up in the Testing view.

## Starting the mirror

Open a flow file, then open the Command Palette and run **Flow Recorder: Start Device Mirror**.

| | Command Palette |
|---|---|
| **macOS** | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> |
| **Windows / Linux** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> |

You can also **right-click inside the flow** and choose *Start Device Mirror*, which skips the
palette entirely.

The picker lists every mirrorable target at once — connected Android devices, running Android
emulators, and iOS Simulators:

```
Android
  emulator-5554                    emulator · running
  Pixel_9                          emulator · will boot
iOS Simulators · running
  iPhone 17 Pro                    iOS 26.5 · booted
iOS Simulators · iOS 26.5
  iPhone 17 Pro Max                will boot
iOS Simulators · iOS 18.5
  iPhone 15                        will boot
```

Running devices come first, then simulators grouped by OS version, **newest first**. Anything
marked **will boot** is started for you — including stopped Android emulators — so you do not
need to launch anything beforehand.

### Android

Flow Recorder finds anything `adb` can see, so a USB device with debugging enabled works the
same as an emulator.

Check what is connected:

```bash
adb devices
```

List the emulators you have, then start one:

```bash
emulator -list-avds
```

```bash
emulator -avd Pixel_9
```

On Windows the emulator lives under `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe`, and
`adb.exe` under `%LOCALAPPDATA%\Android\Sdk\platform-tools\`. Add both to `PATH`, or launch
the emulator from Android Studio's **Device Manager**.

> `adb` must be on your `PATH` — Flow Recorder shells out to it. If the picker reports adb is
> unavailable, that is why.

### iOS Simulator

**macOS only.** iOS Simulators do not exist on Windows or Linux, so on those platforms the
picker shows Android targets only.

See what is running:

```bash
xcrun simctl list devices booted
```

Boot one by name, or let the picker do it for you:

```bash
xcrun simctl boot "iPhone 17 Pro"
```

Install your app on it, since a fresh simulator has nothing to mirror but the home screen:

```bash
xcrun simctl install booted /path/to/YourApp.app
```

iOS element detection and input need `idb` in addition to Xcode:

```bash
brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb
```

Without `idb` the picker will tell you rather than opening a mirror whose taps silently do
nothing.

### Show every element at once

Hovering shows one element at a time. Click the eye icon in the nav bar (or the keyboard
shortcut, if you've bound one) to switch to Maestro Studio's inspector view instead: every
element with real bounds on screen outlined and numbered simultaneously - images, headings and
unlabeled containers included, not only the elements you could tap - numbered top-to-bottom then
left-to-right the way you would actually read the screen, not the order the hierarchy happens
to report them in, which can jump around unpredictably. Hovering still highlights the element
you are about to interact with, in a different colour, on top of the full inspector.

### When part of a screen has no elements

Some apps hide whole regions from accessibility. Those areas detect nothing at all - not
unlabelled elements, but no elements - and from inside the mirror that is indistinguishable from
element detection being broken. The mirror now says which it is looking at:

> 2 areas of this screen report no accessibility elements (16%, 31%). Steps there can only be
> recorded as coordinates.

This is a finding about the app, not about the recorder, and it cannot be worked around here:
Maestro reads the same accessibility tree at replay time, so a step targeting text in one of
those bands would fail even if the recorder guessed the text from the screenshot.

The usual cause in SwiftUI is `.accessibilityHidden(true)` on a container, or an ancestor with
`.accessibilityElement(children: .ignore)` that supplies no label of its own. Interactive
controls inside such a container often still appear, which is why a screen can show buttons and
fields normally while its heading and body text are missing entirely. Fixing it in the app makes
the text targetable, and fixes VoiceOver at the same time.

The note is informational and styled separately from the warning banner used for genuine
detection failures - the two have fixes in different codebases.

### The nav bar

The bar under the mirror matches the platform, because the two do not have the same buttons:

| | Buttons |
|---|---|
| **Android** | Back · Home · Recents · Reload |
| **iOS** | Home · App Switcher · Lock · Reload |

iOS has no system Back or Recents key, so the bar does not pretend otherwise. **To go back on
iOS, swipe from the left edge of the mirror** — the same gesture you would use on the device.
App Switcher double-presses Home, and Lock uses the side button.

Where a step is recorded, it is identical across platforms: Maestro maps `back` and `pressKey`
onto each platform's own behaviour.

Recording follows the same rule everywhere: Back, Home and Lock write a step; App Switcher,
Recents and Reload drive the device or panel without recording, since Maestro has no
equivalent command.

### Keyboard shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Command Palette | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> |
| Switch environment | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> |
| Run the flow | Play button in the editor gutter, or the Testing sidebar | same |

## Requirements

| For | You need |
|---|---|
| Android | `adb` on your `PATH` ([platform-tools](https://developer.android.com/tools/releases/platform-tools)) |
| iOS Simulator | Xcode, plus [`idb`](https://fbidb.io) for element detection and input |
| Running flows | [Maestro](https://maestro.dev/docs/getting-started/installing-maestro) |
| Schema + autocomplete | [YAML by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) |

## Known limits

Stated plainly, because discovering them yourself is worse:

- **Android keyboard taps are not recorded.** The IME is a separate window that
  `uiautomator dump` does not include, so no honest selector exists for a key. Taps still type
  on the device; use **Input text** to record typing, which is how Maestro represents it.
- **`uiautomator dump` fails while another tool holds UiAutomation.** Android allows only
  one UiAutomation client at a time. A leftover Maestro or Appium driver can hold it - Flow
  Recorder detects this and **Reload force-stops the leaked driver automatically**, before it
  does anything else. It can also be Flow Recorder colliding with *itself*: the mirror's poll,
  Replay, and Diagnose Broken Selectors each read the hierarchy independently, and without
  serialising them the same "another app holds UiAutomation" error appeared with no leaked
  driver in sight. All three now share one queue per device, so only one dump runs at a time.
- **iOS: simulators only.** Physical devices need `idb` companion pairing and a signed
  WebDriverAgent.
- **Orientation and airplane mode are Android-only.** iOS reports them as unsupported rather
  than failing quietly.
- **An unlabelled iOS text field falls back to its placeholder.** UIKit surfaces an empty
  field's placeholder in `AXValue`, not `AXLabel`, unless the app sets an explicit
  accessibility label - so a signup form's "First Name", "Email Address" and so on are read
  from there. Scoped to text fields only, since a slider or switch's value ("50%", "1") is not
  a name.
- **A sleeping iOS Simulator has nothing to mirror.** It reports a zero-size screen rather
  than an error, so the mirror presses Home to wake it and retries, then explains the state if
  that does not help. A *locked* simulator is different: it has a real lock screen, which the
  mirror shows faithfully — swipe up in the mirror to unlock it, as you would on the device.

## Telemetry

Off by default. If you enable `flowRecorder.telemetry.enabled`, three anonymous counts are
sent — mirror opened, step recorded, flow run — and nothing else. No file contents, selectors,
device ids, paths or typed text. VS Code's own telemetry setting must also be on.

## Contributing

Issues and PRs welcome at [github.com/podupu/flow-recorder](https://github.com/podupu/flow-recorder).

```bash
npm install
npm run compile
npm run test:unit
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

## Licence

MIT — see [LICENSE](LICENSE).
