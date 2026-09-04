# Proposal: the problems pass

Written 2026-09-01 against `ltk-manager` `main` at `d8dd548` and `ltk_meta` 0.8.1. Nothing
here is in either repo. Everything under `docs/` beside this file is written in the form the
`write-prd`, `write-spec` and `write-adr` skills produce, so it can be copied into
`ltk-manager` as it stands once reviewed. `ltk-manager` has no `docs/design/` or `docs/prd/`
yet, and its ADRs carry a one-line `Status: accepted (date)` header rather than the template's
bullet header - either is a five-minute reconcile at landing time.

```
fixer-engine
|-- proposal.md                       this file: what is where, the rule sketches, migration order
|-- docs
|   |-- prd
|   |   |-- 001-problems-one-pass.md  why, for whom, FR-1 to FR-13, failure modes ranked
|   |-- design
|   |   |-- problems-pass.md          the surface: Pass, subscriptions, the walk, facts, failures
|   |-- adr
|       |-- 0013-a-rule-subscribes-to-the-pass-instead-of-reading-its-files.md
|       |-- 0014-the-pass-hands-a-visitor-one-object-at-a-time.md
```

The spec is the document to review first. The ADRs record the two decisions that had real
alternatives (the trait break, and object-at-a-time as the streaming seam); everything smaller
is a row in the spec's rules table, D1 to D17.

## The design in one paragraph

A rule no longer reads files. It implements `subscribe(&self, pass)` and asks for one of four
things: the first N bytes of every file of a kind, every such file whole, every top-level
object of every bin, or every node of every bin through one shared walk. The engine runs two
`Budget::map` fan-outs - headers, then bins - reads each file once at the widest shape anyone
asked for, reserves its weight once, parses each bin once, walks it once driving every visitor
at the same time with per-visitor pruning, and reports every unreadable, unparseable or
unreached file under every rule that asked for it. Shared derived data (`BankUnits`) is a
`Fact`: a collector that rides the walk, assembled once, redeemed at finish through a token
that proves it was demanded. The repair is untouched and gains the walk for its verification.
The bin read is one function so the streaming reader drops in behind it with the `PTCH`
fallback beside it.

## What each rule looks like afterwards

Sketches, not code. They show the seam holds for all five without a special case.

**`tex/block-alignment`** - one header read, findings at finish.

```rust
fn subscribe(&self, pass: &mut Pass<'_>) {
    let headers = pass
        .files(WorkshopFileKind::Texture)
        .head(HEADER_BYTES)
        .collect(|head| read_header(head.bytes()).map(|tex| Ragged::of(&tex)));
    pass.finish(move |finish| {
        for (handle, ragged) in finish.take(headers) {
            if let Some(ragged) = ragged {
                finish.problem(Severity::Fatal, Site::file(handle.layer(), handle.path()), ragged.detail());
            }
        }
    });
}
```

**`audio/bank-id`** - one header read plus the `BankUnits` fact.

```rust
fn subscribe(&self, pass: &mut Pass<'_>) {
    let ids = pass.files(WorkshopFileKind::WwiseBank).head(HEADER_BYTES).collect(bank_id_of);
    let units = pass.demand::<BankUnits>();
    pass.finish(move |finish| {
        let units = finish.fact(units);
        for (handle, id) in finish.take(ids) {
            if id == Some(0) {
                finish.problem(Severity::Info, Site::file(handle.layer(), handle.path()), detail(&handle, units));
            }
        }
    });
}
```

The "only parse the bins once a hash-named chunk turns up" branch is gone: the walk runs for
`bin/property-type` regardless, and the collector costs one compare per node (D9).

**`audio/bank-version`** - a header read that may fall back to the whole file.

```rust
fn subscribe(&self, pass: &mut Pass<'_>) {
    let rejected = pass
        .files(WorkshopFileKind::WwiseBank)
        .head(HEAD_BYTES)
        .weighing(Weight::Whole)          // the fallback reads the rest itself
        .collect(rejection_of);            // takes &Head, may call head.handle().bytes()
    let units = pass.demand::<BankUnits>();
    let game = pass.project().game();
    pass.finish(move |finish| { /* as today, over finish.take(rejected) and finish.fact(units) */ });
}
```

`fix` calls `ProjectFiles::fact::<BankUnits>()` where it called `BankUnits::of`.

**`bin/resolver-key-loss`** - shallow, per object, with its own read of the game's copy.

```rust
fn subscribe(&self, pass: &mut Pass<'_>) {
    let Some(game) = pass.project().game() else { return };   // dormant; nothing to read
    let losses = pass
        .bins()
        .weighing(Weight::Bins(2))                             // the game's copy beside it
        .collect(move |objects| losses_in(objects, game));     // objects.each(|object| ...)
    pass.finish(move |finish| { /* report each Loss at Site::node(...) */ });
}
```

No recursive walk runs on its behalf (FR-3).

**`bin/property-type`** - the deep visitor; findings straight out of the walk.

```rust
fn subscribe(&self, pass: &mut Pass<'_>) {
    let lens = /* tables, schema, names - as today */;
    if lens.is_empty() { return; }
    pass.bins().visit(TypeVisitor { lens, build: pass.project().build() });
}

impl BinVisitor for TypeVisitor<'_> {
    // default `enters`: Struct, Embedded, and non-primitive containers - what `descends` is today
    fn node(&self, node: &Node<'_>, sink: &mut Sink<'_>) {
        for (field, value) in node.properties() {
            let lookup = Lookup::of(self.lens, node.class(), *field, value);
            if let Some((table_build, migration)) = lookup.hit {
                let address = node.address_of(*field, &self.lens);   // Lens: Namer
                sink.problem(severity(self.build, table_build), Some(NodeAddress { entry: node.entry(), path: address.hashes, label: address.label() }), /* detail */);
            }
        }
    }
}
```

`fix` keeps `repair`/`repair_into`/`repair_map`/`repair_container` as they are, with the
trail's `Key` step owning its subscript, and replaces `check_bin` with the visitor run through
`walk` over the owned tree. `Lens` implements `Namer`: `stable` answers from the migration
table's row name, `readable` and `key` from `BinNames`.

**`BankUnits`** - a fact.

```rust
#[derive(Default)]
pub struct BankUnitCollector { asked: Mutex<HashMap<WadHash, String>> }

impl BinVisitor for BankUnitCollector {
    fn node(&self, node: &Node<'_>, _: &mut Sink<'_>) {
        if node.class() == BANK_UNIT && let Some(paths) = node.properties().get(&BANK_PATH) {
            self.asked.lock().extend(strings_in(paths).map(|p| (WadHash::hash_str(p), p.to_owned())));
        }
    }
}

impl Fact for BankUnits {
    type Collector = BankUnitCollector;
    fn assemble(collector: BankUnitCollector, coverage: Coverage) -> Self {
        Self { asked: collector.asked.into_inner(), complete: coverage.complete }
    }
}
```

`bank_units::walk`, `descend` and `descend_container` are deleted.

## States and edge cases the spec settles

Spec section 8 has the full table. The ones worth a reviewer's eye:

- **Two visitors disagree on pruning** - the walk enters what any wants; each is called only
  beneath what it accepted (D7). This is the regression no current test would catch.
- **Two head sizes, or a head beside a whole, on one kind** - one read at the widest; each
  sees its prefix (D3). Weight is the largest declared, once (D5).
- **A header rule needs the whole file after all** - it reads it itself, having declared
  `Weight::Whole` (D4). The rule owns the second read; the pass owns the reservation.
- **Cancel mid-run** - between files, as today. Every unreached file is a failure under every
  subscriber; a fact becomes incomplete and `BankUnits::asks_for` answers yes to everything.
- **One bad bin, three bin rules** - three failures, one per rule, spelled by the pass (D11).
  The panel draws what it draws today.
- **A rule subscribes to nothing** - still listed in `Run::rules`. A dormant rule still
  subscribes; its findings are still muted by the panel, unchanged.
- **A fact nobody demanded** - unrepresentable: `Finish::fact` needs a `Demanded<F>` that only
  `Pass::demand` issues (D15).
- **A `PTCH`** - its objects are visited like a `PROP`'s; its patch records are not (D17).
  When streaming lands, `BinSource::open` falls back to the eager parse for it, in one place.
- **A streaming source fails partway through a bin** - objects before the failure were visited;
  the file is then a failure under every subscriber; facts incomplete.
- **A panic in a visitor** - propagates and fails the run, as a panic in `check` does now.
  Deliberately not changed; noted in PRD section 7.

## Rust API techniques used, and where

- **Builder for subscriptions** (`pass.files(kind).head(n).weighing(w).collect(f)`) rather than
  a five-argument method; each step `#[must_use]`.
- **Typed tokens** (`Collected<R>`, `Demanded<F>`) so a result is redeemed once by the rule
  that asked, and an undemanded fact is a compile error rather than an `Option`.
- **Internal iteration** (`Objects::each`) so a streaming source can lend one object out of a
  reused buffer - a lending `Iterator` is not expressible on stable.
- **Per-visitor active set** carried down the recursion, so N visitors share one walk without
  sharing a prune.
- **A `Namer` trait with defaulted methods** so the walk holds no rule's names and the address
  renderer is the same code on the check and the repair.
- **`dyn BinVisitor`** in the plan (the engine holds `Vec<Box<dyn Rule>>` already, and a run
  has a handful of visitors), generic closures at the subscription call (hot per-file
  callbacks, monomorphised).

## Migration order

Each step is one PR and leaves the tree green with every rule test's assertions unchanged.

1. **The seam.** `Pass`, `Files`/`Bins` builders, `Collected`/`Finish`, `Sink`, the file and bin
   rounds, `Pass::after`. Replace `Rule::check` with `subscribe`; move all five check bodies
   into `pass.after(...)` verbatim. Zero behaviour change; the diff is a mechanical move.
2. **`tex/block-alignment`, `audio/bank-id`** onto `head` + `finish`. Proves the file round,
   `take`'s failure fan-out and determinism. `audio/bank-id` also demands the `BankUnits` fact,
   so the fact machinery lands here with the collector riding an otherwise empty bin round.
3. **The walk and `bin/property-type`'s check** onto `nodes`. Trail, `Namer`, `Address`,
   per-visitor pruning, the address-parity test against the repair's trail, and `fix`'s
   verification through `walk`. The `PTCH` fixture lands here.
4. **`audio/bank-version`** onto `head` with `Weight::Whole`, and both audio `fix` bodies onto
   `ProjectFiles::fact`. Delete `BankUnits::of` and the duplicate walker.
5. **`bin/resolver-key-loss`** onto `objects`. Delete `Pass::after`. Record the before/after
   measurement in the spec's appendix A.
6. **Later, Phase 3:** `BinSource::Stream`, the `PTCH` fallback, re-measure `Weight::Bin`.

Step 2 before step 3 because the file round is the smaller surface and settles `Collected`,
`Finish` and failure reporting before the walk depends on them. Step 5 last because it is the
cheapest rule and the one whose current behaviour is easiest to preserve on the hatch.

## What this deliberately does not do

- Touch `fix`'s signature or semantics (ADR-0005, 0006, 0011 all untouched).
- Design streaming in. It designs the one function streaming replaces.
- Visit `PTCH` patch records.
- Parallelise across rules, or change the outer fan-out over mods.
- Cache anything between runs.
- Catch panics in rules.

## Open questions for review

1. **Failure rows per rule or per file.** D11 keeps today's output (one row per subscribing
   rule). If the panel would rather draw one row per file, that is a `Report` change with a
   UX consequence, and it should be decided as one rather than fall out of the engine.
2. **`BankUnits` collection cost on a mod with no audio.** D9 computes it whenever an audio
   rule subscribes, which is every run. The cost is one compare per node. If that is ever
   measurable, the alternative is a class-interest hint on the collector that the streaming
   source can honour by not materialising uninterested objects - noted in ADR-0014's revisit.
3. **Whether `Weight::Bins(u32)` is the right shape** for `bin/resolver-key-loss`'s "the game's
   copy beside it", or whether that rule should subscribe to the game's copy through the pass
   too. The game's copy is not a project file, so it is outside the pass by definition today;
   a `GameContent` read inside a subscription closure is what the rule does now, under its own
   declared weight.
4. **Housekeeping the handoff flagged, not done here:** `specs/017-bin-object-link/issues/002`
   still says `Status: Blocked` and is not; `docs/design/bin-streaming.md` section 12 in
   league-toolkit misattributes what resolves the `M` inference problem. Both wait for a yes.
