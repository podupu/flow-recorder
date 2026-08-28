# Phase 2 — iOS Mirroring — Design

**Date:** 2026-08-27
**Status:** Approved, in implementation

## Goal

Mirror an iOS Simulator in the Flow Recorder panel with the same capabilities as the Android
mirror: live screen, element outlines on hover, tap/long-press/swipe recording into Maestro
steps, and the device nav bar.

## Verified capability (measured on this machine, Xcode 26.6, idb installed)

| Operation | Command | Warm timing |
|---|---|---|
| Screenshot | `xcrun simctl io <udid> screenshot <file>` | ~205 ms |
| Screenshot (alt) | `idb screenshot --udid <udid> <file>` | ~230 ms |
| Hierarchy | `idb ui describe-all --udid <udid>` | ~190 ms |
| Point query | `idb ui describe-point --udid <udid> X Y` | ~148 ms |
| Tap / swipe / text / button / key | `idb ui …` | ✓ |

For comparison, `adb exec-out screencap` on the Android emulator measures **1334–2857 ms**, so
iOS mirroring is *faster* than the existing Android path. `idb ui describe-all` also has no
equivalent of the UiAutomation contention that breaks Android element detection.

**`simctl` cannot inject input** — it does screenshots only. `idb` is required for taps and
hierarchy. Screenshots use `simctl` (marginally faster, always present with Xcode); everything
else uses `idb`. Without `idb` the mirror degrades to view-only with a named, actionable
reason, matching how the Android hierarchy failure is reported.

## Three structural differences from Android

### 1. Two coordinate systems

The screenshot is **1206×2622 pixels**; hierarchy frames and `idb ui tap` are **402×874
points** (3× scale). Android used device pixels for both.

Resolution: normalise everything to 0–1 fractions against the **points** size, which the
webview already uses for overlays and taps. The points size comes from the `Application`
element's frame in `describe-all`, not from the screenshot. Taps convert fraction → points.

### 2. Flat hierarchy, no parent links

`describe-all` returns a flat array. Each entry has `frame {x,y,width,height}`, `AXLabel`,
`AXUniqueId`, `AXValue`, `type`, `role`, `enabled`, `title`, `help`.

There is no parent chain, so Android's `nearestLabeledAncestor` walk has no iOS counterpart.
Hit-testing keeps the smallest-area rule; an unlabeled element simply yields a point selector.

### 3. Selector mapping

| Maestro selector | Android source | iOS source |
|---|---|---|
| `text` | `text` / `content-desc` | `AXLabel`, then `title` |
| `id` | `resource-id` | `AXUniqueId` |
| `point` | fallback | fallback |

## Architecture

Extract the device operations behind an interface so one panel serves both platforms.

```
DeviceDriver (interface)
├── AndroidDriver   adb           (existing behaviour, unchanged)
└── IosDriver       simctl + idb  (new)

MirrorPanel — was AndroidMirrorPanel; platform-agnostic
```

```ts
interface DeviceDriver {
  readonly platform: 'Android' | 'iOS';
  readonly deviceId: string;
  screenSize(): Promise<{ width: number; height: number }>;  // the tap coordinate space
  screenshot(): Promise<Buffer>;
  elements(): Promise<DeviceElement[]>;                       // already normalised
  tap(x, y): Promise<void>;
  longPress(x, y): Promise<void>;
  doubleTap(x, y): Promise<void>;
  swipe(x1, y1, x2, y2, ms): Promise<void>;
  inputText(text): Promise<void>;
  pressKey(key): Promise<void>;
  navAction(action): Promise<void>;
  keyboardRegion(): Promise<Rect | null>;
}
```

`DeviceElement` is the shape the webview already consumes (`elementId`, `text`, `resourceId`,
`className`, 0–1 geometry, `selector`, `selectable`), so **the webview needs no changes**.
Each driver owns its own coordinate conversion, which is where the pixel/point difference is
absorbed — the panel never sees it.

### Why this refactor

The alternative was a parallel iOS panel, duplicating ~700 lines of gesture, overlay, context
menu and nav logic. Every fix made so far — the keyboard mask, the tooltip pointer-events bug,
the zoom control, the flow-retarget fix — would then need doing twice and would drift.

## Nav bar mapping

| Button | Android | iOS |
|---|---|---|
| Back | `keyevent 4` | no system back — swipe from left edge |
| Home | `keyevent 3` | `idb ui button HOME` |
| Recents | `keyevent 187` | `idb ui button HOME` twice (app switcher) |
| Reload | re-poll | re-poll |

Recording follows the existing policy: Back and Home record steps, Recents and Reload do not.
On iOS, Back records `back`, which Maestro maps to the platform gesture.

## Keyboard

Android reads the IME region from `dumpsys input_method`. iOS exposes the keyboard *in the
hierarchy* as elements of type `Key` within a `Keyboard` container, so the region is derived
from those frames instead. The existing mask and tap-suppression behaviour is unchanged —
only the source of the rectangle differs.

## Error handling

- `idb` missing → view-only mirror with an actionable banner naming the install command
- No booted simulator → device picker lists bootable ones and offers to boot
- `describe-all` fails → same `HierarchyUnavailableError` path as Android
- Physical iOS devices → detected and reported as unsupported, not silently hidden

## Testing

Pure and testable without a simulator:

- `parseIosElements` — flat array → normalised elements, points→fraction conversion,
  label/id/point selector precedence, malformed entries skipped
- `iosKeyboardRegion` — derive the keyboard rect from `Key`/`Keyboard` elements
- `iosNavAction` — nav action → idb command mapping and recorded step

Driver plumbing is verified live against the booted simulator.

## Scope

**In:** iOS Simulators, all mirror features at parity with Android.
**Out:** physical iOS devices (needs idb companion pairing plus a signed WebDriverAgent).
