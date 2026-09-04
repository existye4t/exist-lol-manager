# ADR-0021: A visitor instance is made per bin and folded in file order

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-4, FR-8), ADR-0013, ADR-0020, toolkit ADR-0013 and `value-walk.md`
  W8 in `LeagueToolkit/league-toolkit`, and the spec sections that state the rule:
  `docs/design/problems-pass.md` [section 5.3](../design/problems-pass.md#s5.3),
  [section 6.1](../design/problems-pass.md#s6.1) and [section 7](../design/problems-pass.md#s7)

## Context and problem statement

The pass runs the bin round over the budget's workers, one bin per job, and drives every
subscribed visitor through one walk of each bin. The first draft of the visitor was `&self` on
every worker, with whatever it accumulated across nodes behind a `Mutex` or an atomic, and a
fact's collector took the same shape.

The toolkit's `Visitor` is `&mut self`. Its walk over one object is sequential by contract, and
its own guidance for a sweep is one visitor instance per worker, reduced at the end. A `&self`
visitor adapted to it would wrap every callback in a lock or hand each worker a `&mut` wrapper
over shared `&self` state, and either way the accumulating rule pays a lock per node.

Where the time goes is settled by the toolkit's corpus measurement: the per-object walk is
microseconds, and decompression and I/O dominate. Parallelism across files is what a sweep
needs, and parallelism inside one walk is not on offer.

## Decision drivers

- No lock on the per-node path.
- The same `Run` over any number of workers (FR-8).
- A fact's collector shared by every rule that demands it, computed once (FR-4).
- One shape for a rule's visitor and a fact's collector.

## Considered options

1. **`&self` visitors on every worker.** Shared state behind a lock, taken per node.
2. **One instance per bin, folded in file order.** The rule's shared state stays behind its
   `&self`; the instance is made on the worker, walks one bin, and hands back what it kept.
3. **One instance per worker.** Made once per worker thread, walks every bin that worker takes,
   folded at the end of the round.

## Decision

**Option 2. A rule's `BinVisitor::begin` makes one instance per bin on the worker, the instance
walks that bin `&mut self`, and `end` hands back its sink and folds anything the rule keeps
across bins into the rule.** The rule is `docs/design/problems-pass.md`
[section 5.3](../design/problems-pass.md#s5.3); what a fact's collector does with it is
[section 7](../design/problems-pass.md#s7).

The pass merges sinks in file order, so a run over eight workers reports what a run over one
reports. A fact's collector folds under its own lock once per bin.

## Consequences

- **Positive:** nothing is locked while a node is visited, a rule's visitor is an ordinary
  struct with a `Vec` of findings, and determinism comes from the merge order rather than from
  every rule being careful. A repair verifying one tree in memory and the pass walking a project
  use the same instance type.
- **Negative:** a rule that wants to see every bin before deciding anything keeps that state
  behind its own lock and folds into it once per bin, which is the one lock left. An instance
  per bin is an allocation per bin, tens of thousands on a large project, which is nothing next
  to the parse and is not zero.
- **Revisit when:** a rule needs state that must be visible across bins during the round rather
  than at finish. That is the case for option 3, and its cost is a fold that no longer runs in
  file order.

## Pros and cons of the options

### Option 1: `&self` on every worker

- Good: one visitor value for the whole run, no fold.
- Bad: a lock per node on every accumulating rule, on the path that runs millions of times per
  project, and a determinism that depends on every rule ordering its own inserts.

### Option 3: one instance per worker

- Good: the fewest instances, and a fold once per worker.
- Bad: an instance's findings span the bins its worker happened to take, so merging them into
  file order means tagging every finding with its file, which is what the sink per bin already
  is. The fold order follows the scheduler.
