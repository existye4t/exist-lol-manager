# ADR-0019: A domain id is its own message key

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** none (the catalog under `messages/` and `src/i18n/`)
- **Related:** ADR-0010, ADR-0016, ADR-0017

## Context and problem statement

ADR-0017 makes the backend send codes and ids where it used to send sentences: the `code` tag on
an `AppError`, the `kind` of a `LauncherError` or `PatcherError`, an `OverlayErrorCategory`, and
in later steps a `RuleId`, a `Check.id` and a `VerdictKind`. Each of those ids now needs copy in
the catalog, and the catalog needs a key for it.

The catalog's own keys are slot names, `library_empty_title`, in snake_case on the domain's words.
An id does not fit that shape: `RIOT_CLIENT_NOT_FOUND` is upper case, `bin/property-type` has a
slash, `eula_not_accepted` is Riot's spelling. Translating an id into a slot name means a second
name for one thing, and a table somewhere that maps the two.

## Decision drivers

- One name per id, so a reader who has the wire value can find the copy by searching for it.
- No mapping table to keep in step with the backend's enum.
- A missing id is caught by `tsc`, the way a missing slot is.
- The ids are already frozen: ADR-0010 and ADR-0016 promise that a `RuleId` never changes.

## Considered options

1. **The id is the key.** `error.<CODE>.<role>`, `launcher.<KIND>.<role>`,
   `rule.<RuleId>.<role>`, called in the bracket form, `m["error.LEAGUE_NOT_FOUND.title"]()`.
2. **A slot name per id.** `error_league_not_found_title`, with the mapping written into the
   describer's `match` arms.
3. **A slot name per id, looked up by a table.** `errorTitles[code]()`, one table per id kind.

## Decision

**A domain id is its own message key, verbatim, under a prefix that names the id's kind.** The
prefix is the wire's own noun, `error`, `launcher`, `patcher`, `workshop`, `rule`, `check`,
`verdict`, and the suffix is the role from the slot-name set, `title`, `description`. An id that
carries a sub-id nests it, `error.OVERLAY.GAME_DIR.title`, `launcher.REFUSED.eula_not_accepted.title`.
A describer in `src/i18n/` matches on the id exhaustively and calls the key in bracket form, so a
new variant fails `tsc` in the describer and a missing key fails it at the call.

Copy that belongs to a kind as a whole rather than to one id keeps a slot name,
`launcher_launch_failed_title`, and an id whose copy is that same sentence calls the slot rather
than a second key with the same words.

## Consequences

- **Positive:** the wire value is the search string. `RIOT_CLIENT_NOT_FOUND` finds the Rust
  variant, the binding, the describer arm and the JSON line. No table is kept in step with the
  backend, because the describer's `match` is that table and `.exhaustive()` checks it.
- **Negative:** the bracket form is longer than a dot access, and the compiler flattens each key
  to a numbered identifier that nobody types. A key holds an upper-case id in a catalog that is
  otherwise snake_case, which reads as two conventions until the prefix is known.
- **Revisit when:** an id stops being frozen. The key would then rename with it, and every
  translation of it would be lost, which is the cost ADR-0016 already accepted for stored settings.

## Pros and cons of the options

### Option 1: the id is the key (chosen)

- Good: one name, no mapping, and the frozen-id promise carries over to the copy.
- Bad: bracket form, and a mixed-case catalog.

### Option 2: a slot name per id, mapped in the describer

- Good: a uniform snake_case catalog.
- Bad: every arm of every describer is a rename, and a reader with the wire value in hand has to
  read the describer to find the copy.

### Option 3: a slot name per id, looked up by a table

- Good: the mapping is data.
- Bad: the table is a second list of the enum's variants, and it is the list that drifts. It was
  tempting because it is shorter than a `match`, and it loses because `.exhaustive()` cannot check
  it.
