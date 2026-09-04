# PRD-001: One pass of the problems engine over a project

- **Status:** Draft
- **Created:** 2026-09-01
- **Crates:** `ltk-manager-core` (module `problems`)
- **Tracking:** none yet
- **Spec:** `docs/design/problems-pass.md`

## <a id="s1"></a>1. Problem

A check of one mod runs five rules in sequence, and each rule reads the mod's files on its
own. Three of the five read bins. On a mod that trips both audio rules, every bin of the mod
is parsed four times in one check - `bin/property-type` once with a full recursive walk,
`bin/resolver-key-loss` once shallowly, and `BankUnits::of` once from each audio rule, each
call site carrying its own comment that it is "every bin of the mod, parsed a second time"
and neither aware of the other. Two of those walks are the same code, written twice.

Each rule also fans out through `Budget::map` on its own, so one check makes five fan-outs
against one memory allowance in sequence, and the sweep over a library of mods multiplies
that by the library.

The trait's own documentation named the trigger for revisiting this: two rules over one bin
parse it twice, "which is the cost of keeping a rule self-contained and is worth paying until
a second bin rule exists to measure it against". There are three.

The cost of leaving it is not only time. The next piece of work on this module is adopting
`ltk_meta`'s streaming reader, and with each rule owning its read that is three separate
migrations, each of which must remember on its own that the streaming reader refuses a `PTCH`
and that no test in the tree would notice if it forgot.

## <a id="s2"></a>2. Objective

A check reads each file once and parses each bin once, whatever the number of rules, and a
rule declares what it reads instead of reading it - so that adding a rule costs the run only
what that rule does per node, and adopting the streaming reader is one change.

## <a id="s3"></a>3. Consumers and stories

- As the **problems panel** (`analyze` from `src-tauri/src/commands/problems.rs`), I want a
  check of one project to cost one read of it, so that the panel answers as fast as the
  largest rule rather than the sum of them.
- As the **library health sweep** (`mods/health/sweep.rs`, under `Budget::sweep()` at a
  quarter of a repair's allowance), I want every rule of every mod in flight to spend that
  allowance once per file, so that the sweep runs with the library open rather than paging.
- As the **archive repair** (`mods/archive/repair.rs`), which runs a check, a repair and a
  verification over one mod in staging, I want the check and the verification each to be one
  pass, so that a repair of a large mod is not three full parses of it.
- As the **author of the next rule**, I want to say "every node of every bin" or "the first 16
  bytes of every bank" and receive exactly that, so that a new rule is its predicate and its
  wording, and nothing about IO, budgets or cancellation.
- As the **streaming migration** (Phase 3 in the release handoff), I want the bin read to be
  one function, so that swapping the eager parse for `BinStream` is one change with the
  `PTCH` fallback beside it.
- As the **author of a rule that checks a file by what a bin says about it** - a texture
  against the format its bin declares, a file against whether any bin names it - I want to
  read the bins first and then only the files they point me at, so that the rule costs what
  it checks and not every file of its kind.
- As the **project editor**, checking a project when it is tested or packed, I want every
  cross-file and cross-bin reference rule the engine has, so that the author sees what their
  users' panel would show and more.
- As the **library health check**, I want only the rules a user who did not make the mod can
  act on, so that the panel is not bloated with an author's findings.
- As the **settings page**, I want one list of rules per audience, each rule toggleable
  unless it guards the game, and the engine to honour the same answers, so that what the user
  sees is what runs.

## <a id="s4"></a>4. Requirements

### Functional

- **FR-1:** A check SHALL read each file of the project at most once and parse each bin at
  most once, whatever the number of rules that read it.
- **FR-2:** A rule SHALL declare what it reads - which file kinds, how many bytes, and at
  what depth of a bin - and SHALL perform no IO of its own during a check.
- **FR-3:** A rule that needs only a bin's top-level objects SHALL be served without a
  recursive walk of those objects on its behalf.
- **FR-4:** Derived data that more than one rule reads SHALL be computed at most once per
  check.
- **FR-5:** The set of nodes one bin reader is shown SHALL NOT depend on what any other
  reader chose to skip.
- **FR-6:** The text of a node's address SHALL be built only for a node a reader reports on.
- **FR-7:** A file that cannot be read or parsed, and a file the run is cancelled before
  reaching, SHALL be reported under every rule that asked for it, at that file's site, and
  SHALL NOT stop the check of any other file.
- **FR-8:** A check over any number of workers SHALL produce the same `Run` as a check over
  one.
- **FR-9:** `Rule::fix` SHALL keep its signature and its behaviour: an owned tree, changes
  re-derived from the file on disk, a write through `FixRun`.
- **FR-10:** The read of a bin SHALL go through one function, so that a streaming source
  replaces the eager parse without any rule changing.
- **FR-11:** The memory reserved for one file in flight SHALL be reserved once, at the
  largest of what its readers declared, and SHALL cover the largest read any of them may
  make.
- **FR-12:** Derived data SHALL be computable over a project outside a check, for a repair
  that reads the mod as it is now.
- **FR-13:** A rule SHALL be movable onto the new seam one at a time, and an unmoved rule
  SHALL behave exactly as it did.
- **FR-14:** A rule SHALL be able to select which files of a kind it reads from derived data
  over the bins, and a file it did not select SHALL NOT be read on its behalf nor reported
  as a failure. Where that derived data is incomplete, every file of the kind SHALL be read.
- **FR-15:** A run SHALL serve one audience - the library or the project editor - and SHALL
  run only the rules that declare they serve it. A rule that does not serve the run's
  audience SHALL NOT appear in the run.
- **FR-16:** A user SHALL be able to turn a rule off per audience, except a rule that declares
  itself required for that audience, which SHALL run regardless. A rule's id SHALL be stable
  across releases, and an id in the user's settings that no rule carries SHALL be dropped
  rather than rejected.
- **FR-17:** Data maintained outside a check - the game's file index today, the game's and
  the project's data indexes later - SHALL be handed to the check, never built by it, and a
  rule that needs one the machine does not hold SHALL report itself dormant.

### Non-functional

- No new workspace dependency.
- No `unwrap` or `expect` in the engine; a panic is a bug and says what and with what.
- Every existing rule test keeps its assertions on the `Run` unchanged.

## <a id="s5"></a>5. Constraints from the game

- A `Struct` and an `Embedded` value each carry a class hash of their own, so a rule keyed on
  a class must be shown nested nodes as well as top-level objects. (`ltk_meta` value model;
  what `bin_property_type`'s walk descends for.)
- A `PTCH` is a bin: it carries objects the game loads, so a bin rule that skipped it would
  miss content. (`FileHandle::bin` widened to `BinFile` on the 0.8 migration.)
- `ltk_meta` 0.8.1's `Kind::is_primitive` is true of `String`, `Hash` and `WadChunkLink`
  (`property/kind.rs`). A container of those holds no node.
- `ltk_meta` 0.8.1's `BinStream::mount` refuses a `PTCH` with `Error::UnexpectedBinKind`
  (`stream/prop.rs`), and there is no streaming reader for `BinOverride`.
- A parsed bin is several times its size on disk. `BIN_EXPANSION = 8` is the manager's
  deliberately generous estimate, and it bounds a check by bytes rather than threads
  (`problems/budget.rs`).
- The `BankUnit` class's `bankPath` list is the only plaintext copy of a bank's name once a
  WAD has been unpacked by hash, so the audio rules' shared data must come from a walk of
  every bin (`problems/bank_units.rs`).

## <a id="s6"></a>6. Failure modes

Ranked by what they cost. Each says what the design owes it.

1. **A reader silently stops seeing nodes it saw before.** A shared prune tuned to one reader
   starves another, or a streaming source drops `PTCH` objects. No existing test fails, and the
   badge reads `healthy` for a mod that crashes. The design owes: per-reader pruning (FR-5), the
   `PTCH` fallback inside the one bin function (FR-10), and a test for each.
2. **A partial run reads as a clean one.** A cancelled or unreadable file that nobody reports
   against is a mod with a finding nobody saw. The design owes: one failure per subscribing rule
   per file, spelled by the engine (FR-7).
3. **The machine pages.** A reader that reads more than it declared, or a reservation taken
   once per reader instead of once per file. The design owes: the largest declared read is the
   reservation, taken once (FR-11).
4. **The run is not reproducible.** Findings in worker order rather than file order, or a fact
   assembled in a different order on a different day. The design owes: results merged in file
   order, readers called in registration order (FR-8).
5. **A failure is drawn twice or not at all.** The engine and a rule both reporting one bad
   file, or the engine reporting once for a file three rules wanted. The design owes: the
   engine reports, once per rule, and a rule never spells a read failure.

## <a id="s7"></a>7. Out of scope

- **The repair.** `fix` does not join the pass. Its needs - an owned tree, a later run, a
  re-derive from disk - are not a read-only pass's to serve. It gains the walk for
  verification and facts on demand, and nothing else changes.
- **Streaming.** The pass is designed so the streaming reader drops in behind one function.
  Adopting it, re-measuring `BIN_EXPANSION`, and the `PTCH` fallback are the Phase 3 work,
  not this.
- **Visiting `PTCH` patch records.** Outside every rule today; a type mismatch inside a patch
  value is invisible to `bin/property-type` before and after this work.
- **Parallelism across rules or across mods.** The outer fan-out over mods and its constants
  are untouched. What changes is that each mod is one pass instead of five.
- **Caching between runs.** A fact is computed once per pass and never kept. What outlives
  a run is an index, and building one is not this work.
- **Incremental runs.** The editor checks the whole project when it is tested or packed. A
  check that re-reads only what changed is a later design.
- **Rules that depend on other rules' findings.** A rule that should stay quiet where another
  fired, or whose severity depends on another's result, has no channel. A shared condition
  is derived data (FR-4).
- **A generic parsed-format round.** Bins are the one format the engine parses once for
  every rule. A second format with two readers gets a round of its own when it exists.
- **Catching a panic in a rule.** A panic in a check body propagates today and still does.

## <a id="s8"></a>8. Acceptance

- [ ] **AC-1:** A counting file source shows each file opened once and each bin parsed once
      under all five rules.
- [ ] **AC-2:** Every rule's existing tests pass with their assertions unchanged after the
      rule is moved onto the pass.
- [ ] **AC-3:** A two-visitor fixture where one visitor declines a subtree and the other
      enters it shows the second called on every node inside.
- [ ] **AC-4:** A fixture with one unreadable bin under three bin readers yields three
      failures at that file, and a cancel after the first file yields a failure per unreached
      file per reader.
- [ ] **AC-5:** The same fixture under one worker and eight workers produces byte-identical
      serialised `Run`s.
- [ ] **AC-6:** `BankUnits::of` and the duplicate walker in `bank_units.rs` are deleted; the
      "parsed a second time" comments have nothing to describe.
- [ ] **AC-7:** `Pass::after` has no caller and is deleted.
- [ ] **AC-8:** A subscription selected by a fact over a fixture where the fact names one of
      three files opens one file and reports nothing for the other two; the same fixture with
      one unparseable bin opens all three.
- [ ] **AC-9:** A rule serving only the editor is absent from a library run; a rule disabled
      for the library is absent there and present in an editor run; a required rule disabled
      in settings runs and reports.
