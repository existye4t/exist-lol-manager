# The problems pass: one traversal of a project for every rule

- **Status:** Proposed
- **Crate:** `ltk-manager-core`, module `problems`
- **PRD:** `docs/prd/001-problems-one-pass.md`
- **ADRs:** ADR-0013, ADR-0015, ADR-0016, ADR-0020, ADR-0021
- **Toolkit:** `ltk_meta::walk`, specified in
  [`value-walk.md`](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md), cited here by section

## <a id="s1"></a>1. Summary

A run of the problems engine reads a project's files once. Each rule declares what it needs
from those files - the first bytes of every texture, every object of every bin, every node of
every bin - and the engine performs the reads, parses each bin once, walks it once, and hands
every subscriber the part it asked for. A rule never opens a file during a check. Bins are
read first, so that what a bin says can decide which other files are read at all.

A run serves one audience - the library's health check or the project editor's - and runs the
rules that serve it, minus the ones the user turned off. A rule is independent of every other:
what it shares with another rule is a fact, never a finding.

Today each rule owns its read. Five rules run in sequence, each fanning out over the project on
its own, and one mod that trips both audio rules parses every bin four times. `Rule::check`
documented that cost as acceptable "until a second bin rule exists to measure it against"; there
are now three. This document states the engine that replaces it.

What the pass owns: which files are read, how much of each, how many times, under what memory
reservation, in what order, and what happens when a read fails or a run is cancelled. What a
rule owns: what it reads from the bytes or the objects it is handed, what it reports, and its
repair. The repair is untouched by this document except where [section 9](#s9) says otherwise.

What this document does not design, and the rule it leaves in its place:

- **Incremental runs.** The pass reads every file of the project it is given, every run. An
  editor checks in full when a project is tested or packed. A run that re-checks only what
  changed is a later design; what this one promises it is that the walk and the bin source are
  usable on their own ([section 6.4](#s6.4), [section 10](#s10)).
- **A generic parsed-format round.** Bins are the one format the pass parses. A second format
  with two readers gets a round of its own, written by hand as the bin round was (D27).
- **Rules that read other rules' findings.** A rule that should stay quiet where another fired
  has no channel and gets none; a shared condition is a fact (D25).
- **`PTCH` patch records** (D17).

## <a id="s2"></a>2. Vocabulary

- **Run.** One pass of every rule over one project, producing a `Run`. Unchanged.
- **Audience.** Who a run is for: the **library**, whose health check runs when a mod is
  installed or swept, or the **editor**, whose check runs when a project is tested or packed. A
  rule names the audiences it serves; a run names the one it is for.
- **Pass.** The engine's single traversal of a project's files during a run. It has two
  **rounds** - the **bin round** over every bin, then the **file round** over every file that
  is not a bin - with **selection** between them, where a bin fact decides which files the file
  round reads, followed by **finish**, where each rule turns what was collected into findings.
- **Subscription.** One read a rule asks the pass for. There are four kinds: `head` and `whole`
  in the file round, `objects` and `nodes` in the bin round. A rule makes its subscriptions in
  `Rule::subscribe`, and makes none anywhere else.
- **Selection.** A predicate a file-round subscription attaches, judged per file against a fact
  once the bin round is over. A file it declines is not read for that subscriber.
- **Read shape.** How much of a file a subscription needs - the first N bytes or the whole file.
  Where several subscriptions name one file, **the widest read wins** and each subscriber sees
  the prefix it asked for.
- **Weight.** The bytes a subscription charges the budget while one of its files is in flight.
  The pass reserves the largest weight among a file's subscribers, once.
- **Object.** A top-level entry of a bin: a path hash, a class hash and its properties. The unit
  the bin round hands out.
- **Node.** The toolkit's word, defined in [`value-walk.md` section 2](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s2): a
  top-level object, or a `Struct` or `Embedded` value beneath one whose class hash is not 0.
  What a visitor is called on.
- **Visitor.** A `nodes` subscriber: a rule's `ltk_meta::walk::Visitor`, written once against
  the tree traits and run over either tree. One instance per bin, folded at the bin's end.
- **Walk.** `ltk_meta::walk`, the one traversal the bin round makes through each object. The
  pass drives every subscribed visitor through it at once, and writes no traversal of its own.
- **Trail.** The toolkit's `Trail`: the steps from an object down to the node the walk stands
  on, as hashes, indices and the tree's own keys, with the class of each field's node beside
  them. **Address** is the trail rendered to text, which happens only for a node a visitor
  reports on.
- **Fact.** Data derived from every bin that more than one rule reads, such as which files the
  mod's bank units ask for. Computed once per pass, in the bin round, when any rule demands it.
  No rule owns a fact: it is implemented on its own type, and turning a rule off cannot take
  it away from another.
- **Index.** Data about the game or the project that is maintained outside the pass and handed
  to it: the game's file index today, the game's and the project's data indexes later. A rule
  reads an index; it never builds one, and the pass never computes one.
- **Sink.** Where a subscriber reports during a round. Scoped to one rule and one file, so a
  report names neither.
- **Collected.** A typed token for the per-file results of one subscription, redeemed at finish.
- **Coverage.** Whether every file a fact or a subscription asked for was read. A cancelled or
  unreadable file breaks it. A file a selection declined does not.

Words this module does not use: _visitor_ for anything but a `nodes` subscriber, _node_ for
anything the toolkit's walk does not call one, _check_ for what a rule does during a pass (a
rule subscribes; the pass checks), _cache_ for a fact (a fact is computed once and never kept
between runs), _fact_ for an index (an index outlives a run; a fact does not), _disabled_ for a
rule of the wrong audience (it does not apply; nobody turned it off).

## <a id="s3"></a>3. Evidence

Read off the code at the commit this document was written against, not timed.

| What                                                | Today   | Under the pass |
| --------------------------------------------------- | ------- | -------------- |
| Parses of one bin, worst case, in one check         | 4       | 1              |
| Full recursive walks of one bin                     | up to 3 | 1              |
| `Budget::map` fan-outs per check                    | 5       | 2              |
| Hand-written recursive walkers in the tree          | 2       | 0              |
| Places the "check was cancelled" failure is spelled | 5       | 1              |

The four parses are `bin_property_type` (deep), `bin_resolver_key_loss` (top-level only),
and `BankUnits::of` once from each audio rule, each call site unaware of the other. Both audio
rules guard the call behind "only once something was found", so the worst case is conditional;
the best case is still two parses.

`bank_units` and `bin_property_type` each hold a visitor over `ltk_meta::walk`
([section 6](#s6)). Only one of them renders an address.

## <a id="s4"></a>4. The run

`analyze`, `analyze_within` and `analyze_archive` each gain an `Audience` parameter and keep
the rest of their signatures. Inside, `ProjectFiles::checked` becomes:

```
checked(project, audience, config)
|-- rules::all(), keeping each rule that serves the audience and is not disabled for it
|-- for each kept rule, in rules::all() order
|   |-- info + dormant, as today
|   |-- rule.subscribe(&mut Pass::for_rule(project, rule.id()))
|-- bin round:  one Budget::map over every bin, if anything subscribed to bins
|-- assemble every demanded fact from its collector and the bin round's coverage
|-- selection: each selected file subscription's predicate, per file, on the calling thread
|-- file round: one Budget::map over every selected non-bin file any subscription named
|-- finish: each rule's finish closure, in rule order, on the calling thread
|-- sort, catalogue objects, build Run - as today
```

A rule's `subscribe` runs on the calling thread and performs no IO. Everything a subscription
closure captures must be `Send + Sync`, because the rounds run it on the budget's workers. A
rule with no subscriptions is still listed in `Run::rules`; it does its work at finish, from
`Finish::project` and the indexes, which is the path for a rule about the project rather than
about any file's bytes (D29).

The two rounds are separate `Budget::map` calls rather than one, because the file round is
headers and the bin round is parses: mixing them in one work list would let a dozen 16-byte
header reads park behind a 40 MB bin's reservation for nothing. Each is one fan-out where
there were five. Bins go first because a file subscription may be selected by a bin fact
([section 5.1](#s5.1)), and a fact is available to every round after the one that assembles it
([section 7](#s7)). Nothing runs the other way: a bin subscriber never depends on file data,
and a comparison of a file against what a bin says about it is made at finish from both
collections (D21).

### <a id="s4.1"></a>4.1 The trait

```rust
pub trait Rule: Send + Sync {
    fn id(&self) -> RuleId;
    fn title(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn unfixable_description(&self) -> &'static str { "" }
    fn severity(&self) -> Option<Severity>;
    fn info(&self) -> RuleInfo { /* unchanged */ }
    fn dormant(&self, project: &ProjectFiles) -> Option<Dormancy> { None }

    /// Whether this rule runs for `audience`.
    fn serves(&self, audience: Audience) -> bool;

    /// Whether a user may turn this rule off for `audience`.
    ///
    /// Asked only for an audience the rule serves. `Required` is for a rule
    /// whose finding breaks the game: the settings page shows it locked, and
    /// a run ignores a disable that names it.
    fn toggle(&self, audience: Audience) -> Toggle { Toggle::Optional }

    /// Declare every read this rule needs, and what to do with what comes back.
    ///
    /// Runs once per run, before any file is opened. It performs no IO of its
    /// own: a rule that needs bytes asks the pass for them here.
    fn subscribe(&self, pass: &mut Pass<'_>);

    fn fix(&self, problems: &[&Problem], run: &mut FixRun<'_>) -> Result<Applied, FixError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Audience {
    /// The health check of an installed mod, and the library sweep.
    Library,
    /// The check of a project when it is tested or packed.
    Editor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toggle {
    /// The user may turn it off.
    Optional,
    /// It always runs; a disable naming it is ignored.
    Required,
}
```

`check` is gone. The decision, and the additive alternative it beat, is ADR-0013. `serves` and
`toggle`, and the settings page they exist for, are ADR-0016. A rule that needs an index the
run was not given - the game's, for a rule that compares against the game's copy - answers
`dormant` with what it waits for, the way a rule that needs the hashtables does (ADR-0009).

### <a id="s4.2"></a>4.2 Rule selection

`rules::all()` stays the one registry and the one order. A run keeps a rule when both hold:

- the rule **serves the run's audience** (`Rule::serves`), and
- the rule is **not disabled** for that audience in `Config`, or is `Toggle::Required` for it,
  in which case the disable is ignored and the rule runs.

A rule the run does not keep never subscribes and is absent from `Run::rules`. The inventory
of every rule, with its audiences and which can be turned off, is the settings page's to show;
a run lists what ran. `Config` holds one set of disabled `RuleId`s per audience:

```rust
impl Config {
    /// The rules the user turned off for `audience`. A required rule listed here is ignored.
    #[must_use]
    pub fn disabled_rules(&self, audience: Audience) -> &BTreeSet<RuleId>;
}
```

Two rules follow from persisting a toggle by id. A `RuleId` is **stable forever**: renaming
one silently turns a rule back on for every user who turned it off (D24). An id in the config
that no rule carries is dropped on the next save, never an error, so removing a rule breaks
nobody's settings. A toggle takes effect on the next run; nothing changes the kept set under a
run in progress, and cancellation stays the only mid-run control (D30).

A run whose kept set is empty is not made. `rules::kept(audience, config)` answers what a run
would keep, and a caller with nothing to run does not call `analyze`: the panel shows nothing
and records nothing, as if no check was asked for, rather than a `Run` with no rules that
would read as healthy (D33). A run with some rules turned off lists the ones that ran, and
which were turned off is the settings page's to show.

## <a id="s5"></a>5. Subscriptions

`Pass<'p>` is handed to one rule at a time and already knows which rule it is serving, so no
subscription names a `RuleId`. Every method that registers a read returns the token a rule
needs to get the result back, and a token that is dropped unredeemed is a compile-time
`#[must_use]` warning.

```rust
pub struct Pass<'p> { /* project, rule, and the plan being built */ }

impl<'p> Pass<'p> {
    /// The project this pass reads, for a rule deciding what to subscribe to.
    #[must_use]
    pub fn project(&self) -> &'p ProjectFiles;

    /// The game's index, when the run was given one.
    ///
    /// `None` on a machine with no game content. A rule that needs it says
    /// so from `Rule::dormant`, not here.
    #[must_use]
    pub fn game(&self) -> Option<&'p dyn GameContent>;

    /// Every file of `kind`, in the file round.
    #[must_use]
    pub fn files(&mut self, kind: WorkshopFileKind) -> Files<'_, 'p>;

    /// Every bin of every layer, override bins included, in the bin round.
    #[must_use]
    pub fn bins(&mut self) -> Bins<'_, 'p>;

    /// A fact computed once in the bin round, whichever rules demand it.
    #[must_use]
    pub fn demand<F: Fact>(&mut self) -> Demanded<F>;

    /// What this rule does with what the pass collected for it.
    ///
    /// Runs after both rounds, in rule order, on the calling thread. A rule
    /// whose findings come straight out of a visitor needs none.
    pub fn finish(&mut self, finish: impl FnOnce(&mut Finish<'_>) + Send + 'p);

    /// A check body that reads the project itself, run after both rounds.
    ///
    /// The migration hatch: a rule moved here does exactly what it did under
    /// `Rule::check`, and pays exactly what it paid. Deleted once no rule
    /// uses it.
    pub fn after(&mut self, check: impl FnOnce(&ProjectFiles, &mut Report) + Send + 'p);
}
```

### <a id="s5.1"></a>5.1 The file round: `head` and `whole`

```rust
pub struct Files<'a, 'p> { /* pass, kind */ }

impl<'a, 'p> Files<'a, 'p> {
    /// The first `bytes` of each file. A shorter file answers with what it has.
    #[must_use]
    pub fn head(self, bytes: usize) -> FileRead<'a, 'p>;

    /// Each file, whole.
    #[must_use]
    pub fn whole(self) -> FileRead<'a, 'p>;
}

pub struct FileRead<'a, 'p> { /* pass, kind, shape, weight */ }

impl<'a, 'p> FileRead<'a, 'p> {
    /// What one file costs the budget while it is read. Defaults to the bytes
    /// the shape reads; a subscriber that may read further on its own says so.
    #[must_use]
    pub fn weighing(self, weight: Weight) -> Self;

    /// Only the files `select` answers yes to, judged against `F` once the
    /// bin round is over.
    ///
    /// Runs on the calling thread, once per file of the kind, between the
    /// rounds. A file it declines is not read for this subscriber and is not
    /// a failure. When `F` is incomplete the selection is ignored and every
    /// file is read, so a bin that failed to parse never hides a file.
    #[must_use]
    pub fn selected_by<F: Fact>(
        self,
        fact: Demanded<F>,
        select: impl Fn(&F, FileHandle<'_>) -> bool + Send + 'p,
    ) -> Self;

    /// Read each file, keeping `R` for finish.
    ///
    /// `read` runs on a worker, once per file, with the bytes the shape asked
    /// for. An `Err` is a failure of this rule at that file, reported by the
    /// pass; the closure never reports anything itself.
    pub fn collect<R>(
        self,
        read: impl Fn(&Head<'_>) -> Result<R, String> + Send + Sync + 'p,
    ) -> Collected<R>
    where
        R: Send + 'p;
}

pub struct Head<'f> { /* handle, bytes */ }

impl<'f> Head<'f> {
    #[must_use] pub fn handle(&self) -> FileHandle<'f>;
    /// The bytes read: the prefix asked for, or the whole file under `whole`.
    #[must_use] pub fn bytes(&self) -> &[u8];
}
```

A `head` closure that finds it needs the rest of the file - `audio/bank-version` when the chunk
list runs past the prefix - calls `handle().bytes()` itself. That is the rule's own read and its
own cost, which is why the subscription declares `Weight::Whole` up front: **a subscription
declares the largest read it may make**, never the smallest. A closure's own read is permitted
only under a declared weight, and only for the file it was handed or the game's copy of it. It
is the migration form of a lookup that belongs to an index: when the second rule that compares
a file against the game's copy lands, that read becomes a subscription over the game's index
and the closure stops opening anything (D31).

Two subscriptions on one kind with two head sizes read the file once at the larger size, and
each sees its own prefix. A `whole` beside a `head` reads the whole file once; the head sees its
prefix. What a file costs the budget is the largest weight among its subscribers.

A selection picks files and nothing else: the shape and the weight are the subscription's, so
the file round's plan is known before it starts, and the widest-read rule stays per
subscription rather than per file (D19). A rule that needs two shapes for two sets of files
makes two subscriptions with two selections. Where one subscription of a kind is selected and
another is not, a file the selection declined is still read for the other, at that other's
shape. A file no subscriber selected is not opened.

### <a id="s5.2"></a>5.2 The bin round: `objects`

```rust
pub struct Bins<'a, 'p> { /* pass */ }

impl<'a, 'p> Bins<'a, 'p> {
    /// What one bin costs the budget while parsed. Defaults to `Weight::Bin`.
    #[must_use]
    pub fn weighing(self, weight: Weight) -> Self;

    /// Each bin's top-level objects, one at a time, keeping what `read`
    /// collects for finish.
    ///
    /// The shallow subscription: a visitor pruned at the root. Nothing beneath
    /// an object is walked on this subscriber's behalf, so a rule that reads
    /// one map's length off one class pays for that and no more (FR-3).
    pub fn collect<O: ObjectRead + 'p>(self, read: O) -> Collected<O::Kept>;

    /// Every node of every bin, through the shared walk.
    pub fn visit(self, visitor: impl BinVisitor + 'p);
}

/// What a shallow subscriber reads off one top-level object, over either tree.
pub trait ObjectRead: Send + Sync {
    /// What one bin keeps for finish.
    type Kept: Default + Send;

    /// Called once per top-level object of a bin, in file order, with its
    /// root node. `object.inner()` is the node's properties, undecoded until
    /// read.
    ///
    /// # Errors
    ///
    /// Over a view, a header that does not decode. The pass reports it as a
    /// failure of this rule at the file's site.
    fn object<'a, V: TreeValue<'a>>(
        &self,
        object: &Node<'_, 'a, V>,
        kept: &mut Self::Kept,
    ) -> Result<(), ltk_meta::Error>;
}
```

`collect` is one `BinVisitor` written once: its instance calls `object` at every root and
answers `Visit::Skip`, and the walk touches nothing beneath. It is internal iteration rather
than an `Iterator`, because a streaming source lends each object out of a buffer it reuses for
the next one (D14).

An `objects` subscriber sees a `BinFile` of either kind as objects and never asks which. A
`PTCH` contributes the objects it carries; its patch records are not objects and are outside
the pass, as they are outside every rule today.

A bin subscriber sees bins and facts, never a file-round result: the file round has not run
yet. A rule that checks a bin against a file it names - the format a bin declares for a
texture against the texture's header - collects both sides and joins them at finish (D21). A
rule that checks bins against each other - a link in one bin to an entry no bin defines -
collects both sides in the one bin round and diffs them at finish; there is no second bin
round, because a second round is the second parse this document exists to remove (D32).

### <a id="s5.3"></a>5.3 The bin round: `nodes` and the visitor

```rust
/// A rule's bin visitor. One instance per bin, made on the worker, folded at
/// the bin's end.
pub trait BinVisitor: Send + Sync {
    /// The walk-local state for one bin.
    type Walk<'r, 'f>: Walk<'f> + Send
    where
        Self: 'r;

    /// One instance for one bin, on the worker. The sink is the instance's for
    /// the bin.
    fn begin<'r, 'f>(&'r self, sink: Sink<'f>) -> Self::Walk<'r, 'f>;
}

/// One instance's walk over one bin, over either tree.
pub trait Walk<'f>:
    for<'a> Visitor<'a, ValueView<'a>, Error = ltk_meta::Error>
    + for<'a> Visitor<'a, &'a PropertyValueEnum, Error = ltk_meta::Error>
{
    /// After the bin: the sink back, and anything the rule keeps across bins
    /// folded into the rule.
    fn end(self: Box<Self>) -> Sink<'f>;
}
```

The callbacks are the toolkit's ([`value-walk.md` section 5](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s5)): `enter_node`
and `exit_node` around every node, `enter_property` for every property, leaves included, and
`exit_property` after each one descended. `Visit::Skip` from `enter_property` is the prune. A
rule writes one generic implementation, `impl<'a, V: TreeValue<'a>> Visitor<'a, V> for Check<'_>`,
which satisfies both bounds of `Walk`, and never names `ValueView` or `PropertyValueEnum`
(ADR-0020). The node is `ltk_meta::walk::Node`: `object_hash()` is the entry, `class_hash()`
the class, `inner()` the properties, `trail()` where it is, `is_root()` whether it is the
object itself.

An instance runs on one worker, `&mut self`, for one bin. The rule's shared state stays behind
the rule's `&self`. What an instance accumulates is its own, and the pass folds instances in
file order (ADR-0021, FR-8). A fact's collector accumulates the same way and folds under its
own lock once per bin ([section 7](#s7)).

### <a id="s5.4"></a>5.4 Weight

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Weight {
    /// The bytes the read shape asks for. The default for `head` and `whole`.
    Read,
    /// The whole file, for a `head` subscriber that may fall back to it.
    Whole,
    /// The file's size times `BIN_EXPANSION`. The default for bins.
    Bin,
    /// `Bin`, `times` over: a bin subscriber that parses a second bin of the
    /// same shape beside it, such as the game's copy.
    Bins(u32),
}
```

The pass reserves, for one file, the largest weight among its subscribers - so three rules over
one bin reserve the bin's expansion once, where today they reserved it three times in three
passes. `BIN_EXPANSION` keeps its value and its premise until a streaming source moves the
premise ([section 10](#s10)).

### <a id="s5.5"></a>5.5 Collected results and finish

```rust
/// The per-file results of one subscription, redeemable once at finish.
#[must_use = "a collected read is only reachable through Finish::take"]
pub struct Collected<R> { /* index into the plan, PhantomData<R> */ }

pub struct Finish<'f> { /* project, results, facts, report */ }

impl<'f> Finish<'f> {
    #[must_use] pub fn project(&self) -> &'f ProjectFiles;

    /// The successful reads of one subscription, in file order.
    ///
    /// A file the read failed on, and a file the run was cancelled before
    /// reaching, are reported under this rule at that file's site before
    /// this returns. A rule never sees them and never spells the message.
    pub fn take<R>(&mut self, collected: Collected<R>) -> Vec<(FileHandle<'f>, R)>;

    /// A fact this rule demanded.
    #[must_use] pub fn fact<F: Fact>(&self, demanded: Demanded<F>) -> &F;

    /// Report one finding.
    pub fn problem(&mut self, severity: Severity, site: Site, detail: Detail);
    /// Report a failure the reads did not already cover.
    pub fn failure(&mut self, site: Option<Site>, message: impl Into<String>);
}
```

`Collected<R>` is `Send`, not `Clone`, and consumed by `take`: a subscription's results are
read once, by the rule that made it, in its own finish. `Demanded<F>` is `Copy` and
zero-sized; it exists so that `Finish::fact` cannot be asked for a fact no rule demanded, which
is how "the fact is absent" stops being a state.

**What a rule keeps until finish is not budgeted.** `Weight` covers the bytes of one file in
flight; an `R` per file and a fact's collector live for the whole run outside the reservation.
The contract is that they are small: an `R` is what a rule needs to phrase a finding - a hash,
a count, an offset - and never a copy of the bytes or the tree it was read from. A rule that
needs the tree at finish is a rule that does its work in the closure instead (D26).

A finding names one site. A finding about several files - two layers holding one path, a
file and the bin that names it - is reported at the one the game would load, which is the
highest-priority layer's copy, and names the others in its `Detail`. `Site` does not grow a
set (D28).

### <a id="s5.6"></a>5.6 The sink

```rust
pub struct Sink<'s> { /* rule, handle, buffered problems and failures */ }

impl<'s> Sink<'s> {
    #[must_use] pub fn handle(&self) -> FileHandle<'s>;
    /// One finding at a node of this file, or at the file when `node` is `None`.
    pub fn problem(&mut self, severity: Severity, node: Option<NodeAddress>, detail: Detail);
    /// This rule could not finish this file.
    pub fn failure(&mut self, message: impl Into<String>);
}
```

One sink per rule per file, filled on the worker and merged into the report in file order
once the round is over. A visitor never holds a `Report` and never names a layer or a path.

## <a id="s6"></a>6. The walk

The walk is `ltk_meta::walk` ([`value-walk.md` section 5](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s5)): one read-only,
pre-order traversal per object, driven by one `Visitor`, over the owned tree and the streaming
view alike. The manager writes no traversal of its own. What it adds is `problems::walk`: the
fan-out that drives every subscribed visitor through one walk, the address a finding names a
node by, and the shape questions the tree traits leave to the tree.

### <a id="s6.1"></a>6.1 Fan-out

`Fan` is one `ltk_meta::walk::Visitor` holding every subscribed rule's instance for the bin
([section 5.3](#s5.3)) and an active-set stack. For every bin, for every top-level object in
file order:

1. At the root every instance is **active**. `enter_node` reaches each active instance.
2. `enter_property(field, value)` asks each active instance. The instances answering
   `Visit::Continue` are the active set beneath that property, pushed on the stack. `Fan`
   answers `Continue` where that set is non-empty and `Skip` where it is empty, so the walk
   enters a value when any active instance wants it. Whether the value can hold a node at all
   is the tree's answer, asked before any instance (W1, W7).
3. Beneath the property, `enter_node`, `enter_property` and the exits reach the active set and
   no other instance.
4. `exit_property` pops the set. The exits are symmetric for exactly this (W8).
5. An instance answering `Visit::Stop` or `Visit::Abort` leaves every set for the rest of the
   bin. The walk goes on for the others.

**Pruning is per visitor and narrows monotonically.** An instance that declined a value is not
called on any node beneath it. An instance that accepted it is called on every node beneath it
that it also accepts on the way down. Two instances never share a prune: the walk enters what
any active instance wants, and calls each only where that instance wanted to be. The active set
is a small set of instance indices carried down the recursion, not a second walk (D7).

This is what keeps a shared walk from silently starving one visitor by a prune tuned to another
(FR-5). The walk enters a `Struct` or `Embedded` whose class is not 0, and a container, option
or map whose item kind is a node kind, and nothing else (W1, W2). A visitor that reads strings
reads them as properties of the node it is on. A container of leaves is never entered, and a
visitor that wanted to be called per string item would not be a node visitor.

### <a id="s6.2"></a>6.2 The tree and the trail

A visitor is written against `TreeValue` and `TreeNode` ([`value-walk.md` section 3](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s3))
and runs over `ValueView` in the pass and over `&PropertyValueEnum` when a repair verifies its
work (ADR-0020). `walk::Declared` extends `TreeValue` with what a header declares and the tree
traits leave to the tree: the item kind of a container or an optional, the key and value kinds
of a map, and the class a `Struct` or `Embedded` carries. A rule about a property's declared
type asks it, and the answer is read off the header over either tree (D35).

The trail is the toolkit's `Trail` ([`value-walk.md` section 5.2](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s5.2)): hashes,
indices and the tree's own key values, with the class of every field's node beside the steps
(W4). A step costs a push and a map key is borrowed, so descending a map of ten thousand
entries allocates nothing. Text is made only by `Address::of`, which a visitor calls only for a
node it reports on (FR-6, D8).

### <a id="s6.3"></a>6.3 Address and names

```rust
/// Plaintext for the hashes an address carries. The shape
/// `ltk_meta::path::FieldNames` takes (league-toolkit #219).
pub trait FieldNames {
    /// The plaintext of `field`, given the class of the node it was read on.
    fn field(&self, field: BinHash, class: Option<BinHash>) -> Option<Cow<'_, str>>;
    /// The plaintext behind a `Hash`-kind map key. Read for the named form only.
    fn hash(&self, hash: BinHash) -> Option<Cow<'_, str>> { None }
}

/// Names nothing: every hash renders as hex.
impl FieldNames for () {}

/// The path to one node, written out in the two forms a row and a repair each need.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Address { /* hashes, named, resolved */ }

impl Address {
    /// The address of `field` on the node `trail` stands on, whose class is `class`.
    pub fn of<'a, V: TreeValue<'a>>(trail: &Trail<V>, field: BinHash, class: BinHash, names: &dyn FieldNames) -> Self;
    pub fn push_field(&mut self, field: BinHash, class: BinHash, names: &dyn FieldNames);
    pub fn push_index(&mut self, index: usize);
    pub fn push_key<'a>(&mut self, key: impl TreeValue<'a>, names: &dyn FieldNames);
    /// What the file holds. A repair matches on this and no table moves it.
    pub fn hashes(&self) -> &str;
    pub fn into_hashes(self) -> String;
    /// The same path for reading, every hash a table spells spelled.
    pub fn named(&self) -> &str;
    /// `named` where a table named anything, else `None`.
    pub fn label(&self) -> Option<String>;
}
```

The grammar of both forms is the toolkit's hash form ([`value-walk.md` section 4.2](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s4.2)):
`.` between fields, `[i]` for an index, `{key}` for a map entry, every hash as lowercase
zero-padded hex with no `0x`, a string key as a JSON string, an integer in decimal, `{}` for a
`None` key and `{?}` for a key that does not decode. `hashes` is the toolkit's `Trail`
rendering with the field appended, so the address a finding records is the address the
toolkit's `ValuePath` writes for the same position (D34). `named` spells every hash a
`FieldNames` can, and a `Hash` key as the JSON string of its name. A field is named with the
class the walk saw it on, the concrete class as the file states it (W17).

`bin_property_type`'s `Lens` implements `FieldNames` over the mimir tables first and its own
tables second, keyed by class, and a name from either lands in `named` and never in `hashes`.
The rule's tables ship with the build. A rule that names through the mimir tables alone
implements it over `BinNames`, keyed by field. `NodeAddress::path` is `hashes` and
`NodeAddress::label` is `Address::label`.

The repair keeps a trail of its own for the mutable walk (D12), holding a copy of each map key
because it holds the map through a `&mut`, and renders it through the same `Address`. The hash
form the check records and the hash form the repair matches on are built by one function.

### <a id="s6.4"></a>6.4 Outside the pass

```rust
/// Walk a bin of either kind: a `PROP`'s objects, or the objects a `PTCH` carries.
pub fn bin<'a, W>(bin: &'a BinFile, visitor: &mut W) -> Result<WalkOutcome, W::Error>
where
    W: Visitor<'a, &'a PropertyValueEnum>;
```

`Bin::walk` for a `PROP`, `BinOverride::walk` for a `PTCH`, which visits the objects the
patch carries and no patch record (W12, D17). A repair's verification, and a fact computed
outside a check (FR-12), read through `FileHandle::bin` and walk through this.

## <a id="s7"></a>7. Facts

```rust
/// Data every bin contributes to, that more than one rule reads.
pub trait Fact: Sized + Send + Sync + 'static {
    /// What rides the walk collecting it. Its instance for a bin accumulates
    /// on the worker and folds into it at the bin's end, under its own lock,
    /// once per bin rather than once per node (ADR-0021).
    type Collector: BinVisitor + Default + 'static;

    /// The fact, once the bin round is over.
    fn assemble(collector: Self::Collector, coverage: Coverage) -> Self;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Coverage {
    /// Whether every bin was parsed and walked to the end.
    pub complete: bool,
}

/// A fact demanded at subscribe time, redeemable at finish.
#[derive(Debug, Clone, Copy)]
pub struct Demanded<F>(PhantomData<fn() -> F>);
```

- `Pass::demand::<F>()` registers `F::Collector` as a visitor once per pass, keyed by
  `TypeId`, however many rules demand it. Each gets a `Demanded<F>`.
- A demanded fact is computed **whether or not** anything turns out to need it (D9). The walk
  is already running over every bin for the deep rules, and the collector's per-node cost is
  what it does per node - for `BankUnits`, one class-hash compare.
- `Coverage::complete` is false when any bin failed to parse or was not reached before a
  cancel. `BankUnits::asks_for` answers yes to everything on an incomplete fact, as it does
  today, for the reason its doc comment gives.
- A fact is computed once per run and never kept between runs. What outlives a run is an
  index, and an index is handed to the pass rather than computed by it (D22).
- **A fact is available to every round after the one that assembles it, and at finish**
  (D10). Every fact today is assembled in the bin round, so it is available at selection, in
  the file round and at finish. A fact assembled in the file round would be available at
  finish only. No rule needs one, and no fact is designed until a rule does.
- **No rule owns a fact.** `Fact` is implemented on the fact's own type, and a rule only
  demands it. Turning a rule off, or running an audience it does not serve, removes its
  demand and nothing else: a fact two rules demand is computed while either runs, and a fact
  nobody demands is not computed. Nothing outside the rules and the fix side reads a fact.
- **Rules are independent.** A rule's inputs are facts and indexes; its outputs are findings
  and, where it contributes one, an `impl Fact`. No rule reads another's findings, and a rule
  that should stay quiet where another fired has no channel for it (D25).
- **A collector holds hashes and counts**, never data that scales with the size of a file: it
  lives for the whole run outside the budget ([section 5.5](#s5.5)). `BankUnits` keeps one
  `String` per bank unit because the bank's name is what the fact is for and a mod has tens
  of units, not millions of nodes. It is the one exemption, and a second one is a redesign of
  the fact, not a precedent.

`BankUnits` becomes:

```rust
impl Fact for BankUnits {
    type Collector = BankUnitCollector; // Mutex<HashMap<WadHash, String>>, extended once per bin
    fn assemble(collector: BankUnitCollector, coverage: Coverage) -> Self { /* ... */ }
}
```

and `BankUnits::of(project)` becomes `ProjectFiles::fact::<BankUnits>()`, which runs a bin
round carrying that one collector and nothing else - what the two audio rules' `fix` bodies
call, since a repair reads the mod as it is now and cannot ride the check's pass
([section 9](#s9)).

## <a id="s8"></a>8. Failure and cancellation

The pass owns every failure a read produces. A rule sees only the files it can act on.

| What happened to a file                             | `head` / `whole` / `objects` subscriber                            | `nodes` visitor                              | Fact               |
| --------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------- | ------------------ |
| Read                                                | its closure ran; `R` reaches `take`                                | called on every node it entered              | contributes        |
| Unreadable (open or read failed)                    | a failure under the rule at the file's site                        | a failure under the rule at the file's site  | `complete = false` |
| Unparseable (bin only)                              | same                                                               | same                                         | `complete = false` |
| Closure returned `Err`                              | a failure under the rule, with the message                         | n/a                                          | n/a                |
| Not reached (cancelled)                             | a failure under the rule: `The check was cancelled`                | same                                         | `complete = false` |
| Object unreadable partway (streaming source, later) | `each` returns `Err`; objects before it were visited               | nodes before it were visited; then a failure | `complete = false` |
| Not selected (`head` / `whole` only)                | not read for this subscriber; nothing reported; absent from `take` | n/a                                          | n/a                |
| Selected against an incomplete fact                 | the selection is ignored; the file is read                         | n/a                                          | n/a                |

A selection declining a file is a rule saying it does not want it, which is not a failure of
anything. A selection made against a fact whose coverage is incomplete cannot be trusted to
decline anything, so the pass reads every file for that subscriber instead (D20). Both
outcomes are the pass's, and a rule never spells either.

**A failure is reported once per subscribing rule**, not once per file. The panel accounts
failures per rule, and a run under the pass draws what a run today draws: three rules over one
bad bin are three rows. The message and the site are spelled by the pass in one place.

**Cancellation is between files**, as `Budget::map` already does it. A file in flight finishes.
A file not reached is reported under every rule that asked for it, so a partial run never
reads as a clean one - the invariant every rule spells for itself today, now spelled once.

A panic in a subscription closure or a visitor propagates out of the worker and fails the run,
which is what a panic in `check` does today. This document does not change it.

Determinism: `Budget::map` returns results in work order; visitors are called in registration
order at each node; sinks merge in file order; finish closures run in rule order; the final sort
is unchanged. A run over eight workers reports what a run over one reports.

## <a id="s9"></a>9. The fix side

`Rule::fix` is unchanged in signature and in behaviour. A repair needs an owned tree it can
mutate and write back, re-derives every change from the file as it is on disk now, and runs
after the check under a different `Run` - none of which a read-only pass over the check's files
can serve. It stays outside the pass.

What the pass gives it:

- **Verification through the walk.** `bin_property_type::fix` re-checks the repaired tree by
  running its check visitor over the owned `BinFile` through `walk::bin`
  ([section 6.4](#s6.4)), instead of a second walker that has to agree with the first. The
  check and its verification are one visitor over two trees (ADR-0020).
- **Facts on demand.** `ProjectFiles::fact::<F>()` computes a fact over a project in one bin
  round, for the audio rules' repairs, which read the mod as it is now.
- **One address renderer.** The hash form the repair matches on is rendered by the same
  function that rendered the finding ([section 6.3](#s6.3)).

The repair's own mutable walk stays in `bin_property_type`. It is the only mutating traversal
in the tree, and a mutable visitor seam with one adapter would be a hypothetical seam (D12).
Its trail renders through the same `Address` as the check's ([section 6.3](#s6.3)).

## <a id="s10"></a>10. Bin sources

Every bin the bin round reads is opened by one function and walked by the toolkit:

```rust
/// A bin the round walks, opened by its kind.
enum BinSource<R> {
    /// A `PROP`, mounted. One object's bytes in memory at a time.
    Stream(BinStream<R>),
    /// A `PTCH`, parsed whole. The streaming reader refuses one.
    Patch(BinOverride),
}

impl<R: Read + Seek> BinSource<R> {
    /// Open `handle` by its magic.
    fn open(handle: &FileHandle<'_>) -> Result<Self, String>;

    /// Walk every object through `fan`, in file order.
    ///
    /// # Errors
    ///
    /// An object the source could not read. Objects before it were walked, and
    /// the pass reports the failure under every subscriber at the file's site.
    fn walk(&mut self, fan: &mut Fan<'_>) -> Result<WalkOutcome, ltk_meta::Error>;
}
```

A `PROP` is walked through `BinStream::walk` ([`value-walk.md` section 5](https://github.com/LeagueToolkit/league-toolkit/blob/main/docs/design/value-walk.md#s5)):
one buffered object at a time, nothing materialised, every leaf decoded only when a visitor
reads it. A `PTCH` is walked through `BinOverride::walk`, over the objects it carries (D17).
`BinStream::mount` refuses a `PTCH`, and the fallback lives in `open` and nowhere else. The
visitor is the same value in both arms (ADR-0020, D13).

What a streamed bin costs the budget is its bytes plus its largest object's buffer, which the
table of contents bounds before anything is decoded. `Weight::Bin` keeps the whole-file
expansion until that cost is measured on a named project, and the measurement is
[appendix A](#appendix-a)'s.

## <a id="s11"></a>11. Testing

The interface is the test surface. Tests drive `subscribe` through a real `Pass` over a fixture
project and assert on the `Run`; nothing tests the walk's active set or the plan by reaching in.

- **One read per file.** A counting `LayerSource` fixture asserts each file is opened once per
  pass however many rules subscribe to it, and that a bin is parsed once.
- **Widest read wins.** Two head subscriptions of 16 and 8 KB on one kind: the file is read
  once at 8 KB, and the 16-byte subscriber sees 16 bytes.
- **Depth.** An `objects` subscriber over a bin whose only `ResourceResolver` is nested inside
  another object never sees it; a `nodes` visitor does.
- **Pruning is per visitor.** Two visitors, one declining a container the other enters: the
  first is never called beneath it, the second is called on every node in it. The regression
  this guards is the one no current test would catch.
- **Address parity.** For every property of a fixture reaching a node through every step
  kind, `Address::of` renders the toolkit's own `Trail` text with the field appended. For every
  finding `bin_property_type` reports on a fixture, the hash form the check records equals the
  hash form the repair's trail renders for the same node.
- **Tree parity.** `bin_property_type`'s visitor over a fixture mounted as a `BinStream`
  reports the findings, at the addresses, it reports over the same bytes parsed whole.
- **Facts.** Two rules demanding `BankUnits` share one collector; an unparseable bin makes it
  incomplete and `asks_for` answers yes.
- **Failure fan-out.** One unreadable bin and three bin subscribers: three failures, one per
  rule, each at the file's site. A cancel after the first file: every unreached file is a
  failure under every subscriber, and `complete` is false.
- **Determinism.** The same fixture under one worker and under eight produces an identical
  `Run` after the engine's sort.
- **A PTCH fixture** in the walk tests: the objects a `PTCH` carries walk as a `PROP`'s do,
  and the bin round's fallback for one is covered.
- **Rule parity.** Each rule's existing tests keep their assertions on the `Run`; a rule moved
  onto the pass changes its `subscribe` and none of its expected output.
- **Selection.** A `head` subscription selected by a fact over a fixture where the fact names
  one of three files: one file is opened, `take` returns one, and no failure is reported for
  the two declined. The same fixture with an unparseable bin: three files are opened.
- **Selection is per subscription.** Two subscriptions on one kind, one selected to one file
  and one unselected: every file is opened once, and each subscriber sees what it asked for.
- **Audience.** A rule serving only `Editor` under a `Library` run is absent from
  `Run::rules` and its subscription is never made. A rule disabled for `Library` in `Config`
  is absent under `Library` and present under `Editor`. A `Required` rule disabled in `Config`
  runs and reports.
- **Facts survive a toggle.** Two rules demanding `BankUnits`, one disabled: the other's
  finish reads a complete fact.

## <a id="s12"></a>12. Rules

| ID  | Rule                                                                                                                                                    | Instead of                                                         | Why                                                                                                                                                            | Spec                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| D1  | `Rule::check` is replaced by `Rule::subscribe`; `Pass::after` carries an unmigrated body                                                                | An additive `subscribe` beside `check`                             | One seam, and a rule cannot implement neither                                                                                                                  | ADR-0013                                   |
| D2  | The pass has two rounds, bins then files, each one `Budget::map`                                                                                        | One work list                                                      | Header reads must not park behind a bin's reservation                                                                                                          | [section 4](#s4)                           |
| D3  | The widest read wins per file; each subscriber sees its own prefix                                                                                      | Per-subscriber reads                                               | One open per file                                                                                                                                              | [section 5.1](#s5.1)                       |
| D4  | A subscription declares the largest read it may make                                                                                                    | Declaring the usual one                                            | The reservation must cover the fallback                                                                                                                        | [section 5.1](#s5.1)                       |
| D5  | The reservation for a file is the largest weight among its subscribers, once                                                                            | Sum of weights                                                     | The bytes are held once                                                                                                                                        | [section 5.4](#s5.4)                       |
| D6  | `Finish::take` reports failed and cancelled files itself and returns successes                                                                          | Every rule matching on the outcome                                 | Five copies of one match become none                                                                                                                           | [section 5.5](#s5.5)                       |
| D7  | The fan-out enters what any active visitor wants and calls each only where it wanted to be; one `ltk_meta::walk::Visitor`, the active set the manager's | A multi-visitor walk in the toolkit, or one shared prune           | A prune tuned to one visitor starves another with no failing test; the scheduling is one consumer's policy (toolkit ADR-0013)                                  | [section 6.1](#s6.1)                       |
| D8  | The trail is the toolkit's, holding hashes and the tree's own keys, and text is rendered at report time through a `FieldNames`                          | Names captured on the way down, or a trail of the manager's own    | The walk holds no rule's names, a step allocates nothing, and one trail serves the toolkit's reports and the manager's                                         | [section 6.2](#s6.2), [section 6.3](#s6.3) |
| D9  | A demanded fact is computed unconditionally                                                                                                             | Demanding it from a file-round result                              | The conditional compensated for a second parse that no longer exists                                                                                           | [section 7](#s7)                           |
| D10 | A fact is available to every round after the one that assembles it, and at finish                                                                       | Facts scoped to one round                                          | The rounds are ordered, so availability is an ordering, not a scope                                                                                            | [section 7](#s7)                           |
| D11 | A failure is reported once per subscribing rule at the file's site                                                                                      | Once per file                                                      | The panel accounts per rule, and today's output is kept                                                                                                        | [section 8](#s8)                           |
| D12 | The repair's mutable walk stays in `bin_property_type`, and its trail renders through the same `Address` as the check's                                 | A mutable visitor seam                                             | One adapter is a hypothetical seam; one renderer keeps the two addressing one node                                                                             | [section 6.3](#s6.3), [section 9](#s9)     |
| D13 | A visitor is generic over the tree and runs over `BinStream::walk` in the pass and `Bin::walk` for a repair's verification                              | A materialised object per visitor                                  | Nothing materialised in the pass; one visitor for the check and its verification                                                                               | ADR-0020                                   |
| D14 | The shallow subscription is a visitor pruned at the root, driven by internal iteration                                                                  | An `Iterator` of objects                                           | A streaming source lends each object out of a reused buffer, and nothing beneath the root is walked                                                            | [section 5.2](#s5.2)                       |
| D15 | `Demanded<F>` is a zero-sized `Copy` token required by `Finish::fact`                                                                                   | A fallible lookup                                                  | An undemanded fact is unrepresentable rather than an error                                                                                                     | [section 5.5](#s5.5)                       |
| D16 | `subscribe` runs on the calling thread and performs no IO                                                                                               | Letting it read                                                    | What it reads would not be budgeted                                                                                                                            | [section 4](#s4)                           |
| D17 | PTCH patch records are outside the pass                                                                                                                 | Visiting them                                                      | Outside every rule today; new scope                                                                                                                            | [section 5.2](#s5.2)                       |
| D18 | Bins are read before files, and a file subscription may be selected by a bin fact                                                                       | Files first, or a third round for dependent reads                  | A file is checked by what the bin that names it says                                                                                                           | ADR-0015                                   |
| D19 | A selection picks files, never a shape or a weight                                                                                                      | A per-file shape                                                   | The file round's plan is known before it starts                                                                                                                | [section 5.1](#s5.1)                       |
| D20 | A selection against an incomplete fact is ignored and every file is read; a declined file is not a failure                                              | Failing the rule                                                   | Answer yes when unsure, the `asks_for` precedent                                                                                                               | [section 8](#s8)                           |
| D21 | A bin subscriber never depends on file data; file-to-bin comparisons join at finish                                                                     | A round after the file round                                       | No rule needs bytes while walking; a third round waits for one                                                                                                 | [section 5.2](#s5.2)                       |
| D22 | An index is handed to the pass, never built by it, and outlives a run                                                                                   | Building the game or project index as a fact                       | A fact is per run; an index is not                                                                                                                             | [section 2](#s2)                           |
| D23 | A rule declares the audiences it serves and whether each may turn it off; a rule a run does not keep never subscribes and is absent from `Run::rules`   | Filtering outside the engine, or listing a disabled rule           | The settings page is the inventory; a run lists what ran                                                                                                       | ADR-0016                                   |
| D24 | A `RuleId` is stable forever, and an unknown id in the config is dropped on save                                                                        | Renaming freely                                                    | A rename silently re-enables a rule a user turned off                                                                                                          | [section 4.2](#s4.2)                       |
| D25 | Rules are independent: inputs are facts and indexes, no rule reads another's findings                                                                   | Declared inputs and outputs between rules                          | Every shared condition decomposes into a fact                                                                                                                  | [section 7](#s7)                           |
| D26 | What a rule keeps until finish is unbudgeted and small; a collector holds hashes and counts; `BankUnits` is the one exemption                           | Reserving it                                                       | A retained tree defeats the budget with no reservation to show it                                                                                              | [section 5.5](#s5.5)                       |
| D27 | A second parsed format gets a round of its own, written by hand                                                                                         | A `parsed::<T>()` subscription                                     | One instance; a `Parse` trait would define weight and failure for formats nobody asked about                                                                   | [section 1](#s1)                           |
| D28 | A finding about several files anchors at the highest-priority layer's copy and names the rest in `Detail`                                               | A multi-file `Site`                                                | That copy is what the game loads and what a repair touches                                                                                                     | [section 5.5](#s5.5)                       |
| D29 | A rule about the project rather than any file's bytes works at finish from the project and the indexes                                                  | `Pass::after`                                                      | Index reads are not file reads; `after` is the migration hatch only                                                                                            | [section 4](#s4)                           |
| D30 | A toggle takes effect on the next run; cancellation is the only mid-run control                                                                         | Live toggling                                                      | The plan is built at subscribe time                                                                                                                            | [section 4.2](#s4.2)                       |
| D31 | A closure's own read is permitted only under a declared weight and becomes an index lookup when a second game-copy rule lands                           | Permitting it indefinitely                                         | It is unbudgeted by shape and honest only by declaration                                                                                                       | [section 5.1](#s5.1)                       |
| D32 | A check across bins collects both sides in the one bin round and diffs at finish                                                                        | A second bin round after a collecting one                          | A second round is a second parse of every bin                                                                                                                  | [section 5.2](#s5.2)                       |
| D33 | A run with no kept rules is not made; the caller checks `rules::kept` first                                                                             | An empty `Run`                                                     | An empty run reads as healthy                                                                                                                                  | [section 4.2](#s4.2)                       |
| D34 | The hash form is the toolkit's grammar: bare lowercase hex, a string key as a JSON string, `{?}` for a key that does not decode                         | The manager's own grammar, with `0x` and bare string keys          | The address a finding records is the address the toolkit's `ValuePath` writes for the same position, so no repair matches on a text the toolkit cannot produce | [section 6.3](#s6.3)                       |
| D35 | `walk::Declared` extends `TreeValue` with the item kind, the key kind and the class a header declares                                                   | Materialising the value to ask, or a walk over the owned tree only | A rule about a declared type asks per property, and a decode per property is the cost the view exists to remove                                                | [section 6.2](#s6.2)                       |
| D36 | One visitor instance per bin, made on the worker and folded in file order, with the rule's shared state behind `&self`                                  | `&self` visitors on every worker with `Mutex` state per node       | No lock on the hot path, and determinism by construction                                                                                                       | ADR-0021                                   |

## <a id="appendix-a"></a>Appendix A. Measurements

None taken. The counts in [section 3](#s3) are read off the source at the commit this document
was written against (`ltk-manager` `main` at `d8dd548`, `ltk_meta` 0.8.1) and are not timings.
The first ticket that lands the pass records, on one named project, wall-clock and peak bytes
reserved for a check before and after, and this appendix gains that row. The ticket that adopts
`BinStream::walk` records the same pair for a streamed bin beside the eager parse, which is
what re-measures `Weight::Bin` ([section 10](#s10)).
