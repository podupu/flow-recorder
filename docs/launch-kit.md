# Flow Recorder Launch Kit

This document is a reusable starting point for announcing Flow Recorder. Keep claims tied to behavior that can be demonstrated in the repository.

## One-line description

Flow Recorder is an open-source Maestro Studio alternative inside VS Code: mirror a device, inspect selectors, record readable YAML, replay on the live app, and diagnose broken selectors before a run fails.

## Short announcement

Maestro users: Flow Recorder brings device mirroring and tap-to-record flow authoring into VS Code. It works with Android devices/emulators and iOS Simulators, writes ordinary Maestro YAML, supports live replay without relaunching, and can diagnose selectors that no longer match the current screen.

Install the VSIX from the GitHub release, open a `*.flow.yaml` file, and run **Flow Recorder: Start Device Mirror**. Feedback from real apps and device setups is especially welcome.

Repository: https://github.com/podupu/flow-recorder

## Demonstration sequence

1. Open an existing `*.flow.yaml` file.
2. Start the device mirror.
3. Show an element outline and its resolved selector.
4. Enable recording and tap a control.
5. Show the generated YAML in the editor.
6. Change or break a selector and run **Diagnose Broken Selectors**.
7. Use **Replay on live app** to demonstrate continuing from the current screen.

## Distribution sequence

### Owned

- GitHub README and release notes
- A short demo GIF or video in the repository
- A changelog entry for each user-visible release
- A roadmap issue with requested device and Maestro versions

### Borrowed

- Ask Maestro practitioners for feedback on the demo, not just stars.
- Offer a focused Android or iOS compatibility test issue for contributors.
- Submit only after the install path and README are proven on a clean machine.

### Rented

- Share one concrete workflow per post: selector diagnosis, live replay, or VS Code testing integration.
- Answer existing Maestro and mobile-testing questions with reproducible examples.
- Avoid generic launch spam, unsupported competitor claims, and automated posting.

## Measures

Track GitHub stars, forks, clones, release downloads, first issue reports, successful VSIX activation, and repeat contributors. The strongest signal is a user who installs the extension, records a flow, and reports a useful device result.
