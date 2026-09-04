# ADR-0013: A rule subscribes to the pass instead of reading its files

- **Status:** Proposed
- **Date:** 2026-09-01
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-1, FR-2, FR-4, FR-7), and the spec section that states the rule:
  `docs/design/problems-pass.md` [section 4](../design/problems-pass.md#s4) and
  [section 5](../design/problems-pass.md#s5)

## Context and problem statement

`trait Rule` owns its read: `check(&ProjectFiles, &mut Report)` opens whatever files it wants
through `FileHandle` and fans out through `Budget::map` on its own. Its doc comment accepted
the cost - two rules over one `.bin` parse it twice - "until a second bin rule exists to
measure it against". Three bin readers now exist: `bin_property_type`, `bin_resolver_key_loss`
and `BankUnits::of`, the last called independently by both audio rules. One check parses every
bin of a mod up to four times and runs five `Budget::map` fan-outs against one memory
allowance.

The next consumer is the streaming reader in `ltk_meta` 0.8.1. With each rule owning its read,
adopting it is three separate migrations, each of which has to remember that
`BinStream::mount` refuses a `PTCH` and fall back on its own.

Two things are fixed. The repair cannot share a read-only pass: `fix` needs an owned tree, runs
later, and re-derives from the disk. And the trait is crate-internal - `ltk-manager-core` is
the only implementor and the only caller - so its shape costs one PR to change.

## Decision drivers

- Each file read and each bin parsed once per run, whatever the number of rules.
- A rule stays a self-contained module that knows its format and nothing about the others.
- One place for the read's failure modes: unreadable, unparseable, cancelled.
- Streaming lands behind one function, not three.
- The migration lands rule by rule with the existing tests unchanged.

## Considered options

1. **Memoise the parse.** Keep `check` as it is and cache `FileHandle::bin()` per run, so the
   second rule's parse is a lookup.
2. **Additive `subscribe` beside `check`.** Both defaulted to no-op; a rule moves when it
   chooses.
3. **Replace `check` with `subscribe`.** One method. A `Pass::after` hatch runs an unmigrated
   check body after the pass, so every rule moves mechanically in one PR with no behaviour
   change, and the hatch is deleted once no rule uses it.

## Decision

**`Rule::check` is replaced by `Rule::subscribe(&self, pass: &mut Pass<'_>)`, and a rule
performs no IO of its own during a check.** The pass performs every read, parses each bin
once, walks it once, and hands each subscriber the part it asked for. Unmigrated rules run
their old body through `Pass::after` until they are moved.

The rule is stated in `docs/design/problems-pass.md` [section 4.1](../design/problems-pass.md#s4.1).

## Consequences

- **Positive:** the read, the parse, the walk, the reservation and the failure reporting each
  have one home. Five copies of "the check was cancelled" become one. A rule declares depth,
  so the shallow rule stops paying for a deep walk it never needed. Streaming becomes a single
  swap of the bin source.
- **Negative:** a rule can no longer read a file it did not subscribe to, and a check that
  needs to decide what to read from what it has read cannot - `audio/bank-version`'s
  fall-back to the whole file survives only because the pass allows a `head` subscriber to
  read the rest itself under a declared weight. The trait break touches all five rules in
  one PR, and the `after` hatch is a second mechanism in the engine for as long as any rule
  stays on it. Everything a subscription closure captures must be `Send + Sync`, which the
  old `check` did not require of a rule's locals.
- **Revisit when:** a rule needs a read the four subscription kinds cannot express, and the
  answer is not a fifth kind. That is the signal the seam is in the wrong place, not that a
  rule should open files again.

## Pros and cons of the options

### Option 1: memoise the parse

- Good: no trait change; the second parse becomes a hash lookup; every rule untouched.
- Bad: a cache of parsed bins is exactly the memory the budget exists to bound, and evicting
  under the budget means the cache misses exactly when it would have paid. Five fan-outs
  still contend for one allowance in sequence. The walk is still run three times, the two
  identical walkers stay, and streaming is still three migrations. It fixes the number the
  handoff measured and none of the structure that produced it.

### Option 2: additive `subscribe` beside `check`

- Good: non-bin rules compile untouched until they choose to move. No PR touches five files.
- Bad: a rule can implement neither method and compile. The engine runs two mechanisms and
  has to define what happens when a rule implements both. Nothing forces the migration to
  finish, so the tree keeps two ways to read a file indefinitely - the state this decision
  exists to end. It was tempting because the handoff suggested it, and it loses because the
  trait is crate-internal and the cost of the break is one mechanical PR.

### Option 3: replace `check` with `subscribe` (chosen)

- Good: one seam, one mechanism, a compile error for a rule that reads outside it. The
  `after` hatch makes the first PR a pure move with zero behaviour change and a diff a
  reviewer can check line by line. Deleting the hatch is the visible end of the migration.
- Bad: the trait break, the `Send + Sync` requirement on closures, and the hatch's temporary
  second mechanism, all named above.
