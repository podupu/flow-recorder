# Changelog

All notable changes to Flow Recorder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
