# ADR-0014: The pass hands a visitor one materialised object at a time

- **Status:** Superseded by ADR-0020
- **Date:** 2026-09-01
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-3, FR-10, FR-11), ADR-0013, and the spec sections that state the
  rule: `docs/design/problems-pass.md` [section 5.2](../design/problems-pass.md#s5.2),
  [section 5.3](../design/problems-pass.md#s5.3) and [section 10](../design/problems-pass.md#s10)

## Context and problem statement

Once every bin is read by the pass (ADR-0013), the pass has to decide what a bin subscriber
sees. Today every reader holds a whole `ltk_meta::BinFile` - `bin_property_type::check_bin`,
`bin_resolver_key_loss::resolvers_in` and `bank_units::asked_in` all take `&BinFile`.

`ltk_meta` 0.8.1 ships a streaming reader. `concrete::BinStream::mount` walks a `PROP`'s
table of contents and reads one object on demand as an `ObjectStream`, which can yield either
a borrowed `ObjectView` over the bytes - properties as `ValueView`s, nothing allocated - or a
materialised `BinObject`. The whole-file expansion the budget charges (`BIN_EXPANSION = 8`)
is the cost streaming exists to remove. Two facts bound the choice:

- The streaming reader refuses a `PTCH` (`Error::UnexpectedBinKind`) and there is no streaming
  reader for `BinOverride`. `FileHandle::bin` covers both kinds, and every rule that reads bins
  today sees a `PTCH`'s objects. A migration that silently dropped them would fail no test in
  the tree.
- `ValueView` and `PropertyValueEnum` are different types with different accessors. A visitor
  written against one cannot run against the other without an abstraction over both.

Streaming is not a requirement of the pass. The requirement (FR-10) is that when it lands, it
lands behind one function and touches no rule.

## Decision drivers

- No visitor changes when the streaming reader is adopted.
- No coverage regression on `PTCH` when it is.
- The visitor interface stays as small as `(entry, class, properties)` plus a lazy address.
- The memory bound moves from the whole file to something smaller, eventually.

## Considered options

1. **Whole file.** The subscriber receives `&BinFile`, as every reader does today. Streaming
   is not reachable through this interface.
2. **View-abstract visitor.** Visitors are written against an engine-owned value abstraction
   that covers both `PropertyValueEnum` and `ValueView`, so a streaming source never
   materialises anything.
3. **One materialised object at a time.** The source - eager now, streaming later - yields
   `(entry, class, &IndexMap<BinHash, PropertyValueEnum>)` per top-level object, and the walk
   runs over one object, then the next.

## Decision

**A bin subscriber sees one materialised object at a time, never the file, and never a view.**
The bin round reads a bin through one `BinSource`, which today parses the file eagerly and
walks its objects in order, and which later mounts a `PROP` through `BinStream` and
materialises one `BinObject` per step, falling back to the eager parse for a `PTCH`. The
visitor's `Node` and the shallow subscriber's `Object` are both over `PropertyValueEnum`.

The rule is stated in `docs/design/problems-pass.md` [section 10](../design/problems-pass.md#s10).

## Consequences

- **Positive:** the streaming migration is one enum variant and one `match` in `open`, written
  once, with the `PTCH` fallback in the same place. Every visitor, every trail step and every
  address renderer keeps the types it has. The shallow `objects` subscriber and the deep
  `nodes` visitor share the source.
- **Negative:** a streamed bin still materialises each object in turn, so its memory bound is
  its largest object's expansion, not zero - a bin that is one enormous object streams no
  better than it parses. A visitor with no interest in an object still pays to materialise it;
  the streaming reader exposes an object's class hash before its body, and a class filter on
  the shallow subscriber is the extension that would use it, not built here. And the eager
  source under this interface parses the whole file first and only _presents_ it object by
  object, so nothing gets cheaper until the streaming variant exists.
- **Revisit when:** a corpus measurement shows the largest-object bound is not enough on real
  mods, or a rule needs to visit inside an object without materialising it. Either is the case
  for option 2, and the cost of option 2 is known: every visitor becomes generic over the value
  representation.

## Pros and cons of the options

### Option 1: whole file

- Good: no change to what any reader sees; the shallow rule's `bin.objects()` iteration and
  `bin_property_type`'s walk both work as written.
- Bad: `&BinFile` is the whole file in memory by definition. Streaming cannot be reached
  without changing every subscriber's signature later - the three-migration future the pass
  exists to avoid.

### Option 2: view-abstract visitor

- Good: a streamed bin never materialises a property. The memory bound becomes the
  object's raw bytes rather than its expansion.
- Bad: it is the larger interface the handoff warned against. An engine-owned `Value` enum or
  trait covering both representations, with the trail, the address renderer, `Node`,
  `Object`, every accessor a visitor uses and the fact collectors all generic over it. It is
  built to serve a streaming source that does not exist in the manager yet, and its whole
  benefit over option 3 is the difference between an object's bytes and an object's expansion,
  which has not been measured on any mod. It was tempting because it is the only option that
  streams "all the way down"; it loses because it spends the interface now for a bound that
  may not matter.

### Option 3: one materialised object at a time (chosen)

- Good: the visitor interface is `(entry, class, properties)`; streaming is a source-side
  change; the `PTCH` fallback has one home; the shallow and deep subscribers share one
  source. The eager source is what `FileHandle::bin` already returns, presented differently.
- Bad: the largest-object bound and the uninterested-object cost, named above.
