# ADR-0018: Generated message modules are not committed

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** none (the frontend build under `src/`)
- **Related:** ADR-0017

## Context and problem statement

Paraglide compiles `messages/en/*.json` into `src/paraglide/`: one ES module per message, a
runtime, a registry and an index, every file under `/* eslint-disable */`. Everything that reads
the frontend needs that folder to exist. `tsc` reads its JSDoc types, Vite bundles it and Vitest
imports it.

The repository already commits one generated file, `src/routeTree.gen.ts`, so the precedent points
at committing this one too. That is one file, though. The compiled catalog is one file per
message, on the order of a thousand once the migration is through, each rewritten whenever its
message changes.

## Decision drivers

- A fresh clone builds, type-checks and tests with the commands it has today.
- A copy change is reviewed once, in the JSON, not twice.
- No edit-then-regenerate step a commit can forget, and no CI check for staleness.

## Considered options

1. **Do not commit.** Every step that needs the output produces it: the Vite plugin in
   `pnpm dev`, `pnpm build` and Vitest, and `pnpm generate:messages` ahead of `tsc`.
2. **Commit, like `routeTree.gen.ts`.** The output is checked in and CI verifies it is fresh, the
   way `public/third-party-licenses.json` is verified.

## Decision

**The compiled catalog is not committed.** `src/paraglide/` is in the root `.gitignore`,
`.prettierignore` and the ESLint `ignores`. `pnpm typecheck` and `pnpm build` run
`pnpm generate:messages` first, and `pnpm dev` and `pnpm test` compile through the Vite plugin.
`project.inlang/paraglide.config.ts` holds the output directory and the locale strategy for the CLI
and the plugin alike, so no command names them twice.

## Consequences

- **Positive:** a message edit is one diff in one file. There is no stale-output state and no
  check for it. The compile is fast enough that no command grew noticeably.
- **Negative:** a bare `tsc` fails on a fresh clone until one compile has run, and an editor's
  TypeScript server sees no `m` until then. Two tools compiling into the same folder at once, such
  as `pnpm dev` beside `vitest --watch`, rewrite each other's output. The Vite plugin's development
  build emits one module per locale where the CLI emits one per message, and both export the same
  `m`, so the difference shows only in the folder listing.
- **Revisit when:** the compile becomes slow enough to notice in `pnpm typecheck`, or a tool that
  cannot run the plugin needs the output.

## Pros and cons of the options

### Option 1: do not commit (chosen)

- Good: no duplicate diffs, no staleness and one source of truth.
- Bad: every entry point has to compile first, and the editor needs one compile after a clone.

### Option 2: commit

- Good: `tsc` and an editor work from a bare clone, as with `routeTree.gen.ts`.
- Bad: a thousand generated files in review, a regenerate step every commit can forget, and a CI
  check to catch it. `routeTree.gen.ts` is committed because it is one file, and this is the case
  that makes the precedent stop.
