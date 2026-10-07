# AGENTS.md

This file provides guidance to coding agents working in this repository.

This file is the primary guidance document for the ltk-manager codebase.

Guidance is scoped by directory:

- `src-tauri/AGENTS.md` - workspace crates, the patcher and the Tauri states. Loads under
  `src-tauri/`, and the `AGENTS.md` of each `crates/ltk-manager-*` crate points to it.
- `src/AGENTS.md` - React/TypeScript conventions, loads when working under `src/`.
- `src/styles/AGENTS.md` - how to author the design tokens, loads only in that directory.
- The `design-system` skill - which token to reach for in a component. Loaded on demand, so it
  is not needed for backend work.

## Writing

Use direct, literal language in replies, documentation, comments, UI copy, issues and PRs.
Mannered prose uses metaphor, decorative phrasing or rhetorical contrast where a direct statement
would explain the same thing. Remove it before sending a reply or saving prose.

Name the action, fact or condition. Use familiar words and short paragraphs. Keep technical terms
when they are precise. Delete phrases that add emphasis without information. For example, write
"adjust the setting" instead of "turn the dial", and "remains relevant" instead of "earns its keep".

## Task execution

- Complete requested changes and required checks before ending the turn. An assessment request ends
  with findings. Continue authorized, reversible work without another approval.
- Resolve routine ambiguity from repository conventions. Ask when the answer changes the scope
  or safety of the work, and finish independent work while waiting.
- Batch independent reads and searches. Sequence dependent calls and mutations. Prefer targeted
  patches, and report unrelated findings separately.
- Keep tests proportional to changed behavior and local conventions. Run required checks, then
  repeat only when edits, failures or unresolved concerns justify it.
- Give brief progress updates. Close with the outcome, verification and remaining blockers in
  plain language.
- In handoffs or compaction summaries, retain the request, constraints, decisions, rejected
  approaches, changed files, check results and next unfinished step. Preserve exact identifiers
  needed to resume.

Load scoped guidance before editing its files. Read referenced material when its task applies,
and reuse current findings already in context. Repository rules remain authoritative for local
checks and commit permissions.

When changing agent instructions or evaluating agent efficiency, read
[Agent evaluation](docs/agents/agent-evaluation.md).

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

**Separate logical steps with blank lines.** In every language, group statements that serve
one purpose and leave a blank line when the context changes: setup, validation, loading,
transformation, side effects, or the final result. Keep a guard beside the value it checks.
Separate function declarations, and give nested loops and branches the same logical spacing.
Expand compound control flow into braced blocks. Apply this to new and changed code, and
review the grouping after formatting, since a formatter cannot identify context boundaries.

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

Use clear names, small components and functions, and named constants to make the code understandable without explanatory comments.

- **One rich doc per unit** - document the exported component, hook or function with a single structured doc comment: what it is, its parts, non-obvious behaviour, accessibility, gotchas. Reference, not a story.
- **Inline comments are the exception** - only for what the code cannot say: a hidden constraint, a workaround and its cause, a magic value. One or two lines.
- **Never** narrate history ("used to", "the old X"), argue design or product decisions at length, retell the change, or restate the code. That belongs in the commit or PR.
- If comments outweigh the code around them, cut them.

**Cite a rule, do not restate it.** Code written to satisfy a documented design rule
names that rule by its code and stops - `/* Duotone rather than fill: DS-ICON-WEIGHT. */`,
not a paragraph reproducing the reasoning. `DS-*` codes are defined in the `design-system`
skill. Add a code there before citing a new one.

The same holds for a `docs/ux/` spec: name the section and the file and stop - a comment reading
`per "What an empty box lists" in docs/ux/WORKSHOP.md` and nothing more. A citation sits at a file
header or a module's exported entry point, never on a statement, and only where prose was removed.
It identifies the source of the removed prose. Use a repository-root path so moving the code
does not change the reference.

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

One conventional-commit subject line. No body, no trailers, no `Co-Authored-By`. A PR takes that
same subject as its title. Never commit or push unasked.

**A PR body declares what the change is.** Terse statements of what the code does, grouped by
area, as a list. No prose paragraphs, no account of how the work went, and no wording bound to a
moment (`now`, `previously`, `no longer`, `new`) unless a reader has to act on the transition, as
with a migration or a breaking change.

```
Bad   Previously a save could race, so this PR now writes through a temp file instead.
Good  A collider save writes through a temporary file of its own.

Bad   I reworked the Physics pane after the split layout turned out not to work.
Good  The Physics pane shows the list or the picked item's fields, never both.
```

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
words the reader knows.

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

- The Tauri command boundary has no edge. `api.fooBar` in `src/lib/tauri.ts` calls
  `commands.fooBar` in `src/lib/bindings.ts` or a service's `src/lib/ipc/<service>.ts`, which
  invokes the string `"foo_bar"` or `"plugin:<service>|foo_bar"`, the Rust command of that name
  in `src-tauri/src/ipc.rs` or `src-tauri/src/services/table.rs`. An explore query that names both
  sides (`fooBar foo_bar`) returns the whole flow.
- A cross-language `calls` or `imports` edge is a name collision (Rust `.unwrap()` resolves to
  `src/utils/result.ts`), unless the target is a generated binding type. Qualified Rust names such as
  `GameDir::resolve` keep callers exact.
- `codegraph affected` sees no Rust tests, because they are inline `#[cfg(test)]` modules. Rust
  test impact is `cargo test`, scoped with `-p` to the crate touched.
- `docs/` is outside the index. The reasons in `docs/ux/` and `docs/adr/` are found by grep.

## Exist Architecture & Extensions

Exist LoL Manager extends LTK 1.27.0 with custom catalog and community features:

- **Backend Commands (`src-tauri/src/commands/`):**
  - `exist_skins.rs`: Curated skin catalog fetching, download queueing, and `installed_skins.json` mapping.
  - `runeforge.rs`: RuneForge catalog query proxy, archive downloading, and thumbnail cache persistence in `runeforge/installed_mods.json`.
  - `exist_sync.rs`: Upstream LTK release detection, safe diff evaluation, and Exist in-app updater coordination.
- **Frontend Pages & Modules:**
  - `src/pages/ExistSkinLibrary.tsx`: Unified skin library, champion view, RuneForge browser, and Installed Cache filtering.
  - `src/routes/skins.tsx`: TanStack route mapping `/skins` to `ExistSkinLibrary`.
  - `src/modules/runeforge/`: API queries and cached thumbnail helpers.
  - `src/lib/tauri.ts`: Typed IPC interface binding both core LTK services and Exist commands.

### Invariants

1. **Selection Sync:** Uninstalling or deleting an enabled mod must unapply it first (`toggleMod(id, false)`), then remove it. This prevents ghost enabled entries in `library.json` active profile.
2. **Artwork Caching:** RuneForge downloads must pass `thumbnailKey` to `install_runeforge_mod` to write `thumbnail.png` into the mod folder and record the metadata in `runeforge/installed_mods.json`.
3. **Unified Count:** The sidebar Installed badge reflects `safeInstalled.length + localMods.filter(isRuneForgeMod).length`. Custom imported skins remain scoped under Custom Skins.
4. **Anti-Skinhack Policy:** `enforce_skinhack_scan` in `crates/ltk-manager-base/src/config.rs` defaults to `false` so custom skins and champion WADs load without being blocked by anti-skinhack scan enforcement.
5. **Release Packaging:** Windows builds use `pnpm tauri build --no-sign`. Installers are generated in `target/release/bundle/nsis/`.

## Memory Bank

Persistent architectural memory and operational context are maintained under `memory-bank/`:

- `memory-bank/projectbrief.md`: Core project goals, scope, and foundation.
- `memory-bank/productContext.md`: User problems solved, core user experience, and feature workflows.
- `memory-bank/activeContext.md`: Current sprint status, recent release history, and immediate priorities.
- `memory-bank/systemPatterns.md`: Tauri IPC patterns, state flow, catalog synchronization, and folder structures.
- `memory-bank/techContext.md`: Toolchain, dependencies, Rust workspace crates, build constraints, and packaging.
- `memory-bank/progress.md`: Working features, verified builds, and future roadmap.
