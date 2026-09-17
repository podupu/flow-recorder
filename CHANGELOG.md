# Changelog

All notable changes to Flow Recorder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - 2026-09-17

### Changed

- Device interactions no longer append flow steps by default. Use the explicit Start/Stop
  recording control to enable or disable recording; new mirrors start with recording off.

## [0.1.2] - 2026-09-17

### Fixed

- Use idb's guest accessibility bridge when the host API returns zero-sized elements or a
  translation failure on iOS 27. Reuse the working backend for subsequent reads.
- Stop automatically pressing Home when accessibility is unavailable.
- Explain the required idb client/companion upgrade when the guest bridge is unavailable.

## [0.1.1] - 2026-09-17

### Fixed

- Wait for iOS Simulator boot completion before opening the mirror.
- Retry unavailable accessibility bounds automatically and load screenshots independently.
- Show capture failures and clear stale element targets when detection fails.

### Added

- Keyboard-accessible element picker and actions, with Escape and focus restoration.
- Accessible status messages, responsive controls and reduced-motion support.

## [0.1.0] - 2026-08-27

First public release.

### Added

- **Device mirror** for Android (adb) and iOS Simulators (simctl + idb), with a
  live screen, element outlines on hover, and a zoomable view.
- **Recording** of taps, long presses, double taps and swipes as official
  Maestro steps, written into whichever `.flow.yaml` is open.
- **Element inspection** — hover any element to see its resolved selector,
  preferring `text`, then `id`, then a percentage `point`.
- **Right-click command menu** for gestures, text input, app lifecycle,
  device settings and screenshots.
- **Device nav bar** with Back, Home, Recents and Reload.
- **Test explorer integration** — every `.flow.yaml` appears in the Testing
  view with a gutter play button; the Debug profile retains run artifacts.
- **Environments** — named variable sets in `maestro-env.json`, switched from
  the status bar and injected as `maestro test -e KEY=VALUE`.
- **Clickable paths** — `runFlow`, `runScript` and `takeScreenshot` values open
  the file they reference.
- **Correct schema** — bundles the official Maestro Flow schema, overriding the
  SchemaStore collision that otherwise validates flows against Estuary Flow.
- **Diagnose broken selectors** — checks a flow's selectors against the live
  screen and reports which no longer match.

### Notes

- The mirror suppresses element resolution over the soft keyboard. On Android
  the IME is a separate window absent from the hierarchy; taps there type on
  the device but are not recorded, since no honest selector exists.
- `setOrientation` and airplane mode are Android-only; iOS reports them as
  unsupported rather than failing silently.
