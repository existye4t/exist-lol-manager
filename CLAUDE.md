# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is the primary guidance document for the ltk-manager codebase.

Guidance is scoped so backend work does not carry the frontend's:

- `src-tauri/CLAUDE.md` - workspace crates, the patcher and the Tauri states. Loads under
  `src-tauri/`, and `crates/ltk-manager-core/` imports it.
- `src/CLAUDE.md` - React/TypeScript conventions, loads when working under `src/`.
- `src/styles/CLAUDE.md` - how to author the design tokens, loads only in that directory.
- The `design-system` skill - which token to reach for in a component. Loaded on demand, so it
  costs nothing while you are in `src-tauri/`.

## Commands

All commands run from the repo root. See `package.json` scripts for the full list.

```bash
# Verbose backend logging, any shell. The optional argument is a RUST_LOG
# filter, defaulting to ltk_manager=trace,ltk_overlay=debug,tauri=info.
pnpm dev:logged [ltk_overlay=debug]
```

`pnpm generate:licenses` requires `cargo-about` on PATH, and its config is `about.toml`.

`pnpm generate:meta-schema` reads the meta wiki's database out of its own repository rather than
from the API that serves the same bytes, because the API challenges a CI runner and cannot be
excepted - see `docs/research/meta-api-reachability-from-ci.md`. It writes nothing when the
embedded snapshot already matches.

## Code Style

Avoid trivially descriptive comments. Only comment non-obvious business logic, workarounds, edge cases, or a decision the code cannot show. Document all public Rust APIs with `///` doc comments.

**A comment explains the code, not the product.** The test is whether deleting it would let a
reader change this code and break something. An architectural decision - why the state is shaped
this way, why a hook is mounted here - passes. Why the _product_ behaves as it does fails,
however true the sentence is. That belongs in `docs/ux/`, and repeating it here records one
decision in two places that then drift apart.

**A comment is smaller than the code it explains.** A doc comment longer than the function under it
is the signal that the reason belongs in `docs/ux/` or an ADR with a citation left behind, or that
the code already shows it. One line is the default and one line is what most symbols get. A second
paragraph is for a decision the code cannot show, and it is a sentence or two rather than the case
for it. Count the lines before committing: on a diff where the prose outweighs the statements, the
prose is what is wrong.

**No redundant comments.** Do not add inline comments that restate what the code already expresses. If the code is descriptive enough (clear variable names, well-known patterns like temp-file-then-rename, obvious API calls), leave it uncommented. This applies to AI-generated code and suggestions too - strip narration comments before committing. The same goes for what a symbol's own doc expresses: a call site that restates the constant or type it is using is writing that doc twice. Needing the explanation there usually means the code is in the wrong place - move it beside what it explains, and the comment stops being needed.

**Cite a rule, do not restate it.** Code written to satisfy a documented design rule
names that rule by its code and stops - `/* Duotone rather than fill: DS-ICON-WEIGHT. */`,
not a paragraph reproducing the reasoning. `DS-*` codes are defined in the `design-system`
skill. Add a code there before citing a new one.

The same holds for a `docs/ux/` spec: name the section and the file and stop - a comment reading
`per "What an empty box lists" in docs/ux/WORKSHOP.md` and nothing more. A citation sits at a file
header or a module's exported entry point, never on a statement, and only where prose was removed.
It is the receipt for what is no longer written there. Never a relative path, because the code
moves and the doc does not.

**A doc's first line names the thing, it does not narrate it.** One line, a noun phrase or a single
declarative sentence, saying what the symbol _is_ - the same shape a commit subject takes, on the
codebase's own vocabulary. No `Returns`, no `This function`, no restating the signature, and no
walk through the body:

```
Bad   /** This function takes the verdicts and builds a string out of them. */
Good  /** What is wrong with a library, as one string two runs compare by. */

Bad   /** Called by the sweep's effect to decide whether it should announce. */
Good  /** Claim the unprompted announcement `key` is owed, if it is owed one. */
```

Third person and the present tense throughout, on the domain's nouns rather than the
implementation's - `the reader`, `a mod`, `the run` - and never `we` or `you`. Drop `note that`,
`simply`, `just` and `basically`: a sentence that survives deleting them never needed them.

**No semicolons splicing sentences,** in comments, doc comments, or markdown. They read as
compressed notes rather than prose. Use a full stop when the halves are two thoughts, or a comma
plus `and` / `so` / `but` when the second half follows from the first:

```
Bad   Dark is the default; light is [data-theme="light"] on <html>.
Good  Dark is the default. Light is [data-theme="light"] on <html>.

Bad   Wallpaper costs the muted rungs contrast; lift them.
Good  Wallpaper costs the muted rungs contrast, so lift them.
```

A bulleted list of fragments takes no terminal punctuation at all. A bullet that is a complete
sentence ends with a full stop, like any other sentence.

## Commits and PRs

One conventional-commit subject line. No body, no trailers, no `Co-Authored-By`. A PR is that same
subject as its title and an empty body. Never commit or push unasked.

**A subject names the change, it does not describe it.** A plain verb and a domain noun phrase,
roughly three to six words, in the codebase's own vocabulary. No contrastive clause, no mechanism,
no narrative verb, and drop articles that carry nothing.

```
Bad   fix(Problems): tell a volume texture from a resource type the repair cannot write
Good  fix(Problems): warn on unwritable texture resource type

Bad   feat(mods): edit a removal into the archive instead of repacking it
Good  feat(mods): support delta target dropping

Bad   fix(mods): rebuild the installed game index when the game build changes
Good  fix(mods): key game content cache on build
```

### The same shape everywhere, on different vocabulary

A title is a terse noun phrase wherever one is written, and what changes between them is only which
words are common ground with the reader. Terseness is not a concession to `git log`.

| What                | Common ground with the reader                |
| ------------------- | -------------------------------------------- |
| Commit and PR title | the codebase's own vocabulary                |
| Issue title         | the same, and the rule id where there is one |
| Rule title, UI copy | whatever the product itself documents        |

**The test for a word is whether the product teaches it, not whether it sounds technical.**
`Meta property type mismatch` is a good user-facing title: `meta` is a word a mod user meets in the
tooling and at <https://meta-wiki.leaguetoolkit.dev/>, so it is shared vocabulary, and the phrase
is four nouns with nothing else in it. A relative clause is what makes a title read badly, not a
domain word - `Texture size the format cannot hold` is worse than `Block-unaligned texture size`
for that reason alone.

Two things keep their own shape. An **ADR title** is a declarative sentence, because the title is
the decision - `A repair rewrites the archive in place`. A **test name** stays narrative, because
it is read one at a time and is the only sentence saying what the case is.

A rule's `description` is a sentence by contract - one for a reader who has not met the state. It
is the title that is a noun phrase.

## Log Files

- **Windows:** `%APPDATA%\dev.leaguetoolkit.manager\logs\ltk-manager.log`
- **Linux/macOS:** `~/.local/share/dev.leaguetoolkit.manager/logs/ltk-manager.log`

## Agent skills

### Issue tracker

Issues live as GitHub issues in `LeagueToolkit/ltk-manager`, driven through the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The canonical roles map onto the repo's existing `triage`, `needs-context` and `wontfix`
labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context, with one `CONTEXT.md` and one `docs/adr/` at the repo root. See
`docs/agents/domain.md`.

### CodeGraph

In a checkout indexed by CodeGraph (`.codegraph/` at the repo root), the index reads the code but
has blind spots:

- The Tauri command boundary has no edge. `api.fooBar` in `src/lib/tauri.ts` invokes the string
  `"foo_bar"`, which is the Rust command of that name registered in `src-tauri/src/main.rs`. An
  explore query that names both sides (`fooBar foo_bar`) returns the whole flow.
- A cross-language `calls` or `imports` edge is a name collision (Rust `.unwrap()` resolves to
  `src/utils/result.ts`), unless the target is a ts-rs binding type. Qualified Rust names such as
  `GameDir::resolve` keep callers exact.
- `codegraph affected` sees no Rust tests, because they are inline `#[cfg(test)]` modules. Rust
  test impact is `cargo test`, scoped with `-p` to the crate touched.
- `docs/` is outside the index. The reasons in `docs/ux/` and `docs/adr/` are found by grep.
