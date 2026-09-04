# ADR-0016: A rule declares its audiences and whether each may turn it off

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-15, FR-16), ADR-0009, ADR-0013, and the spec sections that state
  the rule: `docs/design/problems-pass.md` [section 4.1](../design/problems-pass.md#s4.1) and
  [section 4.2](../design/problems-pass.md#s4.2)

## Context and problem statement

`rules::all()` is one hard-coded list, and every caller runs all of it. Two callers are
arriving with different needs. The library runs a health check when a mod is installed or
swept, for a user who did not make the mod and should see only what would break their game.
The project editor runs a check when a project is tested or packed, for the mod's author,
who wants every cross-file and cross-bin reference check the engine can give. Running the
editor's checks on the library would bloat the user's panel with findings they cannot act on;
running only the library's checks in the editor would hide from the author what the panel
would later show their users.

The settings page needs, for each of those two contexts, a list of the rules that run there,
each one toggleable unless it must not be. A rule whose finding crashes the game is not a
preference.

Three shapes of rule selection are possible: on the rule, in the registry, or in the caller.
Whichever is chosen also decides what a run reports about a rule that did not run.

## Decision drivers

- One registry and one order, so `RuleId` stays unique and `Run` stays deterministic.
- The engine and the settings page read the same answer about which rules exist for whom
  and which are locked; neither carries a list the other can drift from.
- A user who turns a rule off sees that they did, and cannot turn off one that guards the
  game.
- A rule is a self-contained module; adding one is adding one file.

## Considered options

1. **On the rule.** `Rule::serves(audience)` and `Rule::toggle(audience)`; `analyze` takes an
   `Audience` and filters `rules::all()` against it and the config's disabled set.
2. **Two registries.** `rules::library()` and `rules::editor()`, each a hand-kept list, with
   lockedness a third list in the settings code.
3. **In the caller.** `analyze` takes the rule list; each caller assembles its own.

## Decision

**A rule declares the audiences it serves and, per audience, whether a user may turn it off.**
`analyze` takes the run's `Audience`; a rule is kept when it serves that audience and is not
disabled for it in `Config`, or is `Required` there. A rule the run does not keep never
subscribes and is absent from `Run::rules`.

The rule is stated in `docs/design/problems-pass.md`
[section 4.2](../design/problems-pass.md#s4.2); the trait shape is
[section 4.1](../design/problems-pass.md#s4.1).

## Consequences

- **Positive:** the rule knows who it is for, next to its title and severity. The settings
  page renders its lists by asking every rule, and the engine enforces the same answers. A
  new rule that serves both audiences is one file with two lines more than today. A run over
  eight workers and a run over one still list the same rules in the same order.
- **Negative:** `RuleId` becomes a persisted key: a rename silently re-enables the rule for
  every user who turned it off, so ids are frozen forever and a rule that must be renamed
  keeps its old id. A run no longer lists a rule that was turned off, so a `Run` alone
  cannot tell "passed" from "not run"; that distinction lives on the settings page, and a
  reader of a serialised `Run` has to know it. The worst case - every rule off, and an
  empty `Run` reading as healthy - is closed by not making the run at all
  (`docs/design/problems-pass.md` [section 4.2](../design/problems-pass.md#s4.2)); the
  partial case is accepted. `Required` puts a judgement on the rule author - which findings
  break the game - that used to be nobody's.
- **Revisit when:** a third audience appears, or an audience needs a rule order of its own.
  The first is a variant; the second is what would justify option 2.

## Pros and cons of the options

### Option 1: on the rule (chosen)

- Good: one registry, no parallel lists, the UI cannot drift from the engine, a rule stays
  one file.
- Bad: the trait grows two methods, and a rule author now decides audience and lockedness
  for a rule that used to just run.

### Option 2: two registries

- Good: no trait change; the lists are visible in one place.
- Bad: three hand-kept lists - two audiences and one locked set - that a new rule must be
  added to by hand, with nothing failing when one is forgotten. A rule in both lists is
  registered twice, and its position in each is a second order to keep deterministic. It was
  tempting because it is the smallest diff, and it loses because the lists are exactly what
  drift.

### Option 3: in the caller

- Good: the engine knows nothing of audiences and is simplest.
- Bad: the settings page, the library sweep, the archive repair and the editor each assemble
  a list, and the toggle logic and the locked set are reimplemented at every call site or
  hoisted into a helper that is option 1 without the trait. The engine cannot enforce that a
  required rule ran.
