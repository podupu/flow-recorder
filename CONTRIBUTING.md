# Contributing to Flow Recorder

Flow Recorder is an open-source Maestro authoring and debugging tool for VS Code. Contributions that improve device coverage, selector quality, installation, accessibility, and documentation are especially useful.

## Before opening an issue

Please search existing issues first. For device problems, include:

- operating system and version
- VS Code version
- Flow Recorder version
- Maestro version
- Android device/emulator or iOS Simulator model and runtime
- the exact command or action that failed
- relevant logs with secrets, tokens, and app data removed

A minimal reproducible flow is better than a large application project. Never commit credentials, screenshots containing private data, or device identifiers that should remain private.

## Development setup

```bash
npm install
npm run compile
npm run test:unit
npm run package:vsix
```

Install the local package with **Extensions: Install from VSIX...**. After changing extension code, reload the Extension Development Host or reinstall the VSIX.

The package command must include runtime dependencies. Do not add `--no-dependencies`; the extension needs packages such as `js-yaml` after installation.

## Pull requests

Keep changes focused and explain the user-visible behavior. Add or update a unit test for behavior changes. For UI changes, include a screenshot or a short recording when practical. Confirm that `npm run test:unit` and `npm run package:vsix` pass before requesting review.

## Areas where help is welcome

- Android versions and real-device coverage
- iOS Simulator and idb compatibility
- selector resolution and accessibility-tree edge cases
- Maestro command coverage
- VS Code testing and custom-editor UX
- onboarding docs, examples, and translations
