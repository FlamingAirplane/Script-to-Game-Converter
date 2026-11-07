# Contributing to Narrative Bridge

Thanks for helping. Bug reports, sample scripts that convert badly, and pull requests are all welcome.

## Reporting a problem

Open an issue with the **Bug report** form. The most useful thing you can attach is the smallest script that shows
the problem: a few lines of Fountain or plain text is often enough. Please don't attach scripts you aren't free to
share. For a security problem, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Setting up

You need Node.js 22.13 or later.

```bash
npm install
npm run dev        # the app at http://localhost:5173
```

## Checks to run before a pull request

```bash
npm run typecheck
npm test               # unit tests (tests/pipeline.test.ts)
npm run test:unreal    # the Unreal C++ compiles (needs clang)
npm run test:e2e       # the writer file in WebKit and Chromium (needs Playwright browsers)
```

CI runs all of these, plus accessibility, sideways-scrolling, offline and design-editor checks
(see `.github/workflows/ci.yml`). If you change the Unity export and have Unity installed, also run
`npm run test:unity`; the Unity workflow on GitHub only runs when the repository has a Unity licence secret.

## How the code is laid out

- `src/core`: everything that doesn't need a browser: parsers (`parsing/`), the story model (`isr.ts`), Ink
  generation (`inkgen.ts`), checks (`analyzer.ts`, `validate.ts`) and the exports (`export/`). The command-line tool
  uses the same code.
- `src/ui`: the React app.
- `tests/pipeline.test.ts`: unit tests; `tests/e2e`: browser tests.

The README's "Repository layout" section has more.

## Conventions

- Same input, same output: conversion and exports are deterministic, so tests can compare them exactly.
- Nothing a writer typed is dropped silently. If something can't be converted, keep it (as a note or comment) and
  say so in Diagnostics.
- Write interface text and diagnostics for screenwriters, not programmers: plain words, no internal codes.
- Add a test for each bug fixed, and a line to the "Unreleased" part of `CHANGELOG.md` for anything a user would notice.

## Licence

By contributing you agree that your contribution is released under the project's [MIT licence](LICENSE).
