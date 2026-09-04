# ADR-0020: A visitor is generic over the tree it walks

- **Status:** Proposed
- **Date:** 2026-09-02
- **Crates:** `ltk-manager-core`
- **Related:** PRD-001 (FR-3, FR-6, FR-9, FR-10), ADR-0013, supersedes ADR-0014, toolkit
  ADR-0013 and ADR-0014 and `value-walk.md` W20 in `LeagueToolkit/league-toolkit`, and the
  spec sections that state the rule: `docs/design/problems-pass.md`
  [section 5.3](../design/problems-pass.md#s5.3), [section 6](../design/problems-pass.md#s6)
  and [section 10](../design/problems-pass.md#s10)

## Context and problem statement

ADR-0014 chose what a bin subscriber sees: one materialised object at a time, over
`PropertyValueEnum`, with a streaming source expected to read each object into a `BinObject`
before the visitor saw it. It was written against `ltk_meta` 0.8.1, which had a streaming
reader and no traversal, and its option 2 - a visitor abstract over both representations - was
rejected as an interface the manager would have to own and keep generic in every visitor, trail
and renderer.

`ltk_meta::walk` (league-toolkit PR 227, closing #225) is that interface, owned by the toolkit.
The walk is written once against two sealed traits, `TreeValue` and `TreeNode`, which the owned
tree and the streaming views both implement, and a `Visitor` is generic over the tree's value
type. `BinStream::walk` crosses an object's buffered bytes and materialises nothing; `Bin::walk`,
`BinObject::walk` and `BinOverride::walk` run the same visitor over the owned tree. The trail is
the toolkit's, with the class context ADR-0012 there gives it.

Two facts bound the manager's choice:

- The manager's own walkers were the duplication the toolkit's walk exists to remove. Keeping a
  manager-owned visitor over `PropertyValueEnum` means keeping a traversal or an adapter that
  materialises every object a streamed pass reads, which is the cost the views exist to remove.
- `TreeValue` answers the walk's questions and no other. A rule about a property's declared
  type - `bin_property_type` asks every property of every node whether it is a `List<String>` -
  needs the item kind a header declares, which neither trait carries. The view's own types do,
  infallibly, and so does the owned tree.

## Decision drivers

- One visitor for the check and its verification, so the repair re-checks with the rule it
  repaired for (FR-9).
- A streamed pass that materialises nothing (FR-10).
- No traversal in the manager.
- A rule that never names `ValueView` or `PropertyValueEnum`, so a rework of the value model
  does not touch it.

## Considered options

1. **Materialise per object.** Keep ADR-0014: `ObjectStream::read` for each streamed object,
   `BinObject::walk` over it, visitors over `PropertyValueEnum`.
2. **Tree-generic visitors, with a manager-owned extension for what the traits leave out.**
   Every rule is `impl<'a, V: TreeValue<'a>> Visitor<'a, V>`; `walk::Declared` extends
   `TreeValue` with the item kind, key kind and class a header declares.
3. **Tree-generic visitors, blocked on the toolkit carrying `item_kind`.** Option 2 with the
   extension landed in `ltk_meta` first.

## Decision

**Option 2. A rule's visitor is generic over `ltk_meta::walk::TreeValue`, runs over
`BinStream::walk` in the pass and over `Bin::walk` when a repair verifies its work, and asks
`walk::Declared` for what a header declares.** The rule is `docs/design/problems-pass.md`
[section 5.3](../design/problems-pass.md#s5.3) and [section 6.2](../design/problems-pass.md#s6.2);
the sources are [section 10](../design/problems-pass.md#s10).

`Declared` is implemented for `&PropertyValueEnum` and for `ValueView`, both infallibly, off the
header either holds. A value a finding needs the wording of is materialised once, for the hit,
through `TreeValue::to_value`.

## Consequences

- **Positive:** the two hand-written walkers are visitors, and the manager holds no traversal.
  The check and its verification are one visitor over two trees, held to each other by a parity
  test. The streaming source is a `match` in one `open`, and nothing a rule reads is decoded
  before the rule reads it.
- **Negative:** a visitor is generic, which is more to write than a concrete trait, and a
  `for<'a>` bound on the pass's visitor trait that a rule author meets once. `Declared`
  duplicates a header read the toolkit could own, and moves to the toolkit the day it does. A
  hit materialises its value, so a rule with thousands of findings on one container clones that
  container once per finding.
- **Revisit when:** `ltk_meta` carries the item-kind questions on `TreeValue`. Then `Declared`
  is deleted and nothing else moves.

## Pros and cons of the options

### Option 1: materialise per object

- Good: the visitors keep `PropertyValueEnum` and every accessor they have; the choice ADR-0014
  already made.
- Bad: every object of a streamed pass is decoded whether or not any visitor looks at it, 96
  bytes per node, so the budget keeps the expansion factor the views make unnecessary. The
  manager keeps an adapter over a walk the toolkit already runs over views. Tempting because it
  changes nothing a rule sees, and loses because the traversal it would keep is the duplication
  this work removes.

### Option 3: block on the toolkit

- Good: no extension trait in the manager, ever.
- Bad: the migration waits on a toolkit release for three small methods with obvious
  implementations, and the manager learns nothing about the shape it needs until it has written
  a rule against it. The extension is the evidence for the toolkit change.
