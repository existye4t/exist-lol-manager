# ADR-0015: The pass reads bins before files, and a bin fact may select which files are read

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-1, FR-4, FR-14), ADR-0013, and the spec sections that state the
  rule: `docs/design/problems-pass.md` [section 4](../design/problems-pass.md#s4),
  [section 5.1](../design/problems-pass.md#s5.1) and [section 7](../design/problems-pass.md#s7)

## Context and problem statement

The pass has two rounds - one `Budget::map` over files that are not bins, one over bins - so
that a dozen 16-byte header reads never queue behind a 40 MB bin's reservation. The first
draft ran files first, on no stronger ground than that headers are cheap and the old rules
read them first.

The next rules do not fit that order. Several planned checks read a file according to what
the bin that names it says: which format a texture is declared as, which files a bank unit
asks for, whether a path a bin references is one the mod or the game holds. Under files-first
those checks can only meet at finish, after every candidate file has been read regardless,
and a check that needs to decide _which_ files to read, or whether to read any, from what
the bins say cannot be expressed at all. Every file-to-bin dependency runs the same way:
the bin is the index and the file is what it points at. No planned rule runs the other way,
needing a file's bytes while walking a bin.

Facts are assembled at the end of the bin round. Whatever runs after that round can read
them; whatever runs before cannot. The order of the rounds is therefore the order in which
facts become usable, and that is the question this record settles.

## Decision drivers

- A file checked by what a bin says about it (FR-14).
- Each file read at most once and each bin parsed at most once, whatever the rule (FR-1).
- The file round's plan - which files, what shape, what weight - known before it starts, so
  the budget's reservation is not data-dependent.
- Header reads still never queue behind a bin's reservation.
- A bin that failed to parse never hides a file from a rule.

## Considered options

1. **Keep files first; join at finish.** Read every file the rule might want, build the fact,
   and let finish pair them.
2. **Bins first, then files, with a selection.** Swap the rounds. A file subscription may
   attach a predicate over a demanded fact, judged per file between the rounds; a declined
   file is not read for that subscriber.
3. **Keep files first; add a third round.** A "dependent reads" round after the bins for
   subscriptions that name a fact.

## Decision

**The bin round runs before the file round, and a file subscription may be selected by a bin
fact.** The selection picks files and nothing else: shape and weight stay per subscription.
When the fact's coverage is incomplete the selection is ignored and every file is read. A
fact is available to every round after the one that assembles it, and at finish.

The rule is stated in `docs/design/problems-pass.md` [section 4](../design/problems-pass.md#s4)
and [section 5.1](../design/problems-pass.md#s5.1); the availability rule is
[section 7](../design/problems-pass.md#s7).

## Consequences

- **Positive:** a rule that reads files according to bins says so in its subscription and
  reads only those files. Every file-round plan is fixed before the round starts, because
  selection runs on the calling thread between the rounds. The two-round structure and its
  reason survive untouched; only the order changed, and no current rule notices, because none
  joins the two rounds.
- **Negative:** the swap forecloses the reverse dependency. A bin subscriber can never see a
  file-round result, and a rule that would need file bytes while walking a bin has to collect
  both sides and join them at finish, or wait for a third round that this record does not
  add. The selection is one more thing a `FileRead` can carry, and its incomplete-coverage
  fallback means a project with one bad bin reads more files than the rule asked for, which is
  slower and correct rather than fast and wrong.
- **Revisit when:** a rule needs a file's bytes during the bin round and cannot join at
  finish. That is option 3, appended after the file round, not a second swap.

## Pros and cons of the options

### Option 1: keep files first; join at finish

- Good: no change to the draft. Works whenever the file read is cheap and unconditional.
- Bad: every candidate file is read whether or not any bin names it, so a rule that wants
  "only the textures a bin declares as cubemaps" pays for every texture. A rule that should
  read a file whole only when a bin says so cannot say so. It was tempting because the first
  five rules happen to fit it, and it loses because the next five do not.

### Option 2: bins first, then files, with a selection (chosen)

- Good: one swap, one predicate, and the availability of a fact becomes an ordering rule
  instead of a scope rule. The budget's premise for each round is unchanged.
- Bad: the reverse dependency is gone, and the selection's fallback on incomplete coverage is
  a policy the pass has to own. Both named above.

### Option 3: keep files first; add a third round

- Good: keeps the draft's order and adds only what the dependent rules need.
- Bad: it is option 2 with an extra `Budget::map` and an extra kind of subscription, and the
  first round it keeps serves no rule that could not equally run in the third. Two rounds of
  header reads is a structure with nothing to say for it except that the draft had files
  first.
