# ADR-0017: The frontend owns every user-facing string

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** `ltk-manager`, `ltk-manager-core`, and the frontend under `src/`
- **Related:** ADR-0010, ADR-0016, ADR-0018, and the research note that weighed the candidates,
  `docs/research/i18n-frontend-solution.md`

## Context and problem statement

A sentence a user reads is written in three places today. Components hold their own English,
about 750 distinct literals across 190 files. Hooks such as `useLaunchErrorToast` match on a
`kind` the backend sends and write English for each variant. And the backend writes English into
`message`, `title`, `description` and `summary` fields that cross IPC as `String`, from
`AppError`'s `Display` through every rule's `title()` to every diagnostics check's label.

That spread costs before any second language is asked for. Copy cannot be reviewed against
`docs/ux/` in one place. A plural is hand-rolled at 66 sites. A backend sentence cannot change
without a Rust release, and a test of a Rust type asserts on prose. The team's stated priority is
to move user-facing strings out of components and out of the Rust backend, behind one i18n layer,
in English only, on a migrate-on-touch policy.

## Decision drivers

- One place for every sentence, so copy is reviewed where the sentences sit together.
- An unknown message or a missing parameter is a compile error, not a runtime string.
- A new backend variant is a frontend compile error, so the two sides cannot drift.
- The smallest build change: no Babel or SWC transform, no runtime library, no provider.
- Migration on touch, with a check a reviewer can apply and CI can enforce on changed files.

## Considered options

1. **The frontend owns every string, compiled by Paraglide.** Messages are JSON per module,
   compiled by `paraglideVitePlugin` into typed functions that components call directly. The
   backend sends a code and typed fields, never a sentence.
2. **The frontend owns every string, loaded by i18next.** The same catalog shape, typed by a
   generated `.d.ts`, with `<Trans>` for rich text.
3. **Each side owns its own.** The frontend adopts an i18n library, the backend keeps writing
   English into `message` fields, and the frontend draws them as they arrive.

## Decision

**The frontend owns every user-facing string.** The backend sends codes, ids and typed fields,
`Display` is for logs, and a `String` a user reads is a defect in a type that crosses IPC.
`AppError` becomes an enum tagged on `code`. Prose from outside the app, such as a crate's error
text, travels as a `detail` field and is drawn as data, never as the headline.

Paraglide compiles the catalog. The tool and its reasons are in
`docs/research/i18n-frontend-solution.md`, section 12. How a domain id such as a `RuleId` keys its
copy is a decision of its own and gets its own record.

## Consequences

- **Positive:** every sentence sits in `messages/en/`, reviewable against `docs/ux/` in one diff.
  An unknown key, a missing input and a new `AppError` variant are each a `tsc` failure. The
  build gains one Vite plugin and nothing at runtime. A second language changes the catalog
  layout not at all.
- **Negative:** every backend prose field is a migration, rule by rule and check by check, and
  until a field is migrated the frontend still draws its English. A component's copy is no longer
  read in the component, so a reviewer opens the JSON diff beside it. The compiler's output is a
  generated folder every build step has to produce first (ADR-0018). Paraglide is a
  company-backed project with one dominant author, accepted for the type safety it returns.
- **Revisit when:** a second language is offered, which needs a translator workflow and a
  locale-switching strategy this decision left out, or when runtime catalog loading is wanted,
  which is i18next's shape and not Paraglide's.

## Pros and cons of the options

### Option 1: the frontend owns every string, compiled by Paraglide (chosen)

- Good: message keys and input names are compile-time facts, the build change is one plugin, and
  the message model is MessageFormat 2's, which the platform standardised.
- Bad: no first-party lint for a stray literal, so a third-party ESLint rule carries the policy.
  Rich text is a six-month-old adapter. One dominant author.

### Option 2: the frontend owns every string, loaded by i18next

- Good: the widest ecosystem, two long-standing maintainers, and a `<Trans>` that is years old.
- Bad: parameter typing holds only when an options object is passed and only from a
  literal-typed catalog that a separate CLI generates. That CLI is one person's work, so the bus
  factor it was meant to answer comes back without the type safety.

### Option 3: each side owns its own

- Good: no Rust change, and the frontend migration starts at once.
- Bad: the backend keeps two shapes for one thing, since `LauncherError` and `PatcherError`
  already cross as tagged enums the frontend translates. Copy stays in two languages' worth of
  source, a plural stays hand-rolled wherever Rust wrote it, and every backend sentence still
  costs a release to change.
