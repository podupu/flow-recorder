# Open-Source Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Flow Recorder easier to install, understand, contribute to, and share as an open-source Maestro Studio alternative.

**Architecture:** Keep the product behavior unchanged. Improve the release boundary with a reproducible VSIX script and CI smoke check, then add public documentation and contribution entry points around the existing extension.

**Tech Stack:** Node.js, npm, TypeScript, VS Code `vsce`, GitHub Actions, Markdown.

**Spec:** User request to grow Flow Recorder among Maestro testing and open-source communities.

## Global Constraints

- Runtime dependencies must be included in every VSIX.
- Existing user changes must remain untouched.
- Public claims must describe behavior already present in the repository.
- External publishing is not automated from this workspace.

### Task 1: Release Reliability

- Add `npm run package:vsix` using `vsce package` without `--no-dependencies`.
- Add CI that compiles, runs unit tests, packages, checks `js-yaml`, and checks source exclusion.

### Task 2: Adoption Documentation

- Lead the README with the open-source Maestro Studio alternative positioning.
- Add a 60-second install flow and explicit warning against `--no-dependencies`.

### Task 3: Contribution Funnel

- Add contributor setup and expectations.
- Add bug and feature templates with device-focused reproduction fields.
- Add launch copy and a channel-aware distribution checklist.

### Verification

Run `npm install`, `npm run compile`, `npm run test:unit`, `npm run package:vsix`, and install the resulting VSIX locally.
