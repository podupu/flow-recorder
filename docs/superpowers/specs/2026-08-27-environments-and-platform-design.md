# Environment & Platform Switching — Design

**Date:** 2026-08-27
**Status:** Implemented

## Problem

Flows hardcode environment-specific values — `http.get('https://staging.api.portal.myconneqt.com/api')`
is baked into the YAML. Running the same flow against staging, prod, or test means editing the
file. There is also no way to say "run this on iOS instead of Android".

## What Maestro actually supports

Verified against the official docs, not assumed:

| Mechanism | Syntax | Source |
|---|---|---|
| Per-run variables | `maestro test -e KEY=VALUE flow.yaml` | [parameters-and-constants](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants) |
| In-flow constants | `env:` block below `appId:` | same |
| Subflow arguments | `runFlow: { file:, env: }` | same |
| Reference | `${VAR}`, default `${VAR \|\| "guest"}` | same |
| Platform condition | `when: platform: Android \| iOS \| Web` | [conditions](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/conditions) |
| Platform variable | `${MAESTRO_PLATFORM}` | same |
| CLI platform | `maestro test -p <platform>` | `maestro test --help` (v2.1.0) |
| Tag filters | `--include-tags`, `--exclude-tags` (comma-separated) | `maestro test --help` (v2.1.0) |

`config.yaml` has **no** `env` property, so it is not a place to store environments.
Maestro Studio has an Environments feature (named variable sets + tag filters), but its
storage format is undocumented — so we define our own.

**`-e` is the mechanism.** Everything below exists to build those flags.

## Prior art in VS Code

| Extension | Storage | Switch UI |
|---|---|---|
| REST Client | `rest-client.environmentVariables` in settings.json, with `$shared` | Status bar + palette + `Cmd+Alt+E` |
| Thunder Client | Files (collections/env) | Sidebar "Env" tab |
| Python | n/a | Status bar interpreter picker |
| Kubernetes | kubeconfig | Status bar context picker |

The status-bar picker is the dominant idiom for "active X" and is what we adopt.
`$shared` is borrowed from REST Client — it is a real ergonomic win and costs little.

We diverge from REST Client on storage: a committed `maestro-env.json` rather than
settings.json, because a test repo benefits from environments being shared via git, readable
by CI, and usable outside VS Code. The tradeoff is that secrets must not be committed — use
`$shared`/env vars for non-secret config and keep credentials out of the file.

## Design

### Storage — `maestro-env.json` at the workspace root

```json
{
  "environments": {
    "$shared": { "APP_ID": "com.conneqthealth.conneqt" },
    "staging": { "BASE_URL": "https://staging.api.portal.myconneqt.com" },
    "prod":    { "BASE_URL": "https://api.portal.myconneqt.com" },
    "test": {
      "variables": { "BASE_URL": "https://test.api.portal.myconneqt.com" },
      "includeTags": ["smoke"],
      "excludeTags": ["slow"]
    }
  }
}
```

Two accepted forms: shorthand (name → variables) and long form (`variables` +
`includeTags`/`excludeTags`). `$shared` merges into every environment; an environment's own
value wins on conflict. Values may be string/number/boolean and are coerced to strings, since
`-e` values are text. A nested object is an error rather than a silent `[object Object]`.

### UI — two status-bar items, visible only for `.flow.yaml`

- `$(server-environment) staging` → click to switch (`Cmd+Alt+E`)
- `$(device-mobile) Android` → click to switch platform

Selecting **None** still applies `$shared`, matching REST Client.

### Applying — `Flow Recorder: Run Flow` (`Cmd+Alt+R`)

Builds argv and runs it in a terminal:

```
maestro test -p android -e APP_ID=... -e BASE_URL=https://staging... flow.yaml
```

The flow path is always last. Args are built as an **array**, never a shell string, so a value
containing spaces or quotes cannot break the command; quoting happens only at the terminal
boundary.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/environments.ts` | Pure: parse the file, merge `$shared`, build argv | nothing |
| `src/envStatusBar.ts` | Status bar, pickers, run command, file watcher | vscode, environments |

The split keeps every decision that can be wrong — merge precedence, coercion, argument
order — testable without a VS Code host.

## Error handling

- Malformed JSON → one reported error, no throw; the picker still opens
- Bad value → that key is skipped, others still load, a warning names the key
- A selected environment that disappears from the file → selection cleared, so stale values
  are never silently injected
- File watcher reloads on create/change/delete
- No file → the picker offers to create one from a template
- `maestro` resolved from `~/.maestro/bin` when not on the GUI `PATH`

## Testing

`test/unit/environments.test.js` — 22 tests covering both file forms, coercion, nested-object
rejection, malformed JSON, `$shared` merge and override, argv construction, tag filters,
platform casing, values containing spaces, and flow-path ordering.

## Known limitations

- **The mirror stays Android-only.** The platform switch affects `maestro test -p` and
  `when: platform:` guards, not mirroring, which is adb-based. Selecting iOS says so.
- **Secrets.** `maestro-env.json` is intended to be committed; credentials do not belong in it.
- **Recorded API steps still inline their URL.** A follow-up could emit
  `http.get(BASE_URL + '/api')` so recordings are environment-aware by construction.
