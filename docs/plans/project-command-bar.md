# Project Command Bar — Implementation Plan

> Status: **implemented** (2026-08-20), steps 1 and 2, plus the scope machinery and the
> settings row of step 3. Deviations
> from the letter of the design: `HistoryEntry` holds the document id alone, `useListNav`
> compares its stops by content rather than by identity so a caller that rebuilds the array
> still holds its highlight, and the palette is a combobox in flow under the bar rather than a
> `Dialog` - the focus stays in the input, which is what the accessibility section asks for and
> what a dialog's focus trap would fight. `useProjectActions` gained stable identities, because
> the palette memoizes its command rows on it.
>
> Design source: `docs/ux/PROJECT_EDITOR.md` —
> [The project bar](../ux/PROJECT_EDITOR.md#the-project-bar),
> [The navigation history](../ux/PROJECT_EDITOR.md#the-navigation-history),
> [Building the palette](../ux/PROJECT_EDITOR.md#building-the-palette).
> Feature rows this closes: **Project bar**, **Command palette**, **Navigation history**,
> **Quick open**.
> Ships step 1 of [What ships in what order](../ux/PROJECT_EDITOR.md#what-ships-in-what-order-1),
> plus the scope machinery for the sources that step 1 holds.

The project header carries a back arrow and a title today. This plan replaces both with one
control that names the project while idle and searches every route into it once a user types.

## 1. Current state (verified 2026-08-20)

| Piece           | Where                                               | Shape today                                                         |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Project header  | `src/modules/workshop/components/ProjectHeader.tsx` | Back arrow, `<h1>` name, version pill, layout popover, actions      |
| Project actions | `src/modules/workshop/api/useProjectActions.ts`     | Test, pack, delete, open location, already closing over the project |
| Editor state    | `src/stores/workshopEditor.ts`                      | `byProject[path]`, split tree, documents keyed by id                |
| State hooks     | `src/modules/workshop/state/useProjectEditor.ts`    | Everything resolves the project from `ProjectContext`               |
| Content scan    | `src/modules/workshop/api/useProjectContentTree.ts` | Every layer's every file, no truncation, 10s stale                  |
| Document labels | `src/modules/workshop/documents/registry.tsx`       | `useContentEditors()` gives an icon and a title per document        |
| Game index      | `src/modules/workshop/gameBrowser/useGameIndex.ts`  | `useRefreshGameIndex()` is the rebuild the command list wants       |
| Virtual lists   | `@tanstack/react-virtual`                           | Already a dependency, used by both trees                            |

Facts that shape the plan:

- Every source of step 1 is in the frontend already, so no Rust lands here
- `useProjectActions` and the editor hooks already close over the project, so a command record
  can hold the real mutation rather than a copy of it
- The header sits in a `Toolbar` with no clipping ancestor before `main`, so the result list
  drops in flow rather than through a portal
- The four closes live in `EditorSurface` local state behind an unsaved-edits queue. They are
  not reachable from a command without a project-level close channel, so they are out of scope

## 2. The scorer

`palette/matcher.ts` splits a query on whitespace and looks for each term as a run of
characters. A term is read where it reads best, which is at a word boundary wherever the
candidate offers one, so `base` in `.../base/skin.bin` beats the `base` inside `databases.bin`.

The first attempt was fzy's matrix scorer over a subsequence, and it was the wrong default: read
[Ranking](../ux/PROJECT_EDITOR.md#ranking) for why `nasus` matched 137,032 files of a live
install. A fuzzy mode can return as a setting, off by default.

The bands come from the same section. A candidate is matched against its name first and against
`directory/name` only when the name fails, which is what separates band 2 from band 3.

| Signal                             | Where it lands               |
| ---------------------------------- | ---------------------------- |
| Query is a prefix of the name      | Band 0                       |
| Query is a subsequence of the name | Band 1                       |
| The match reaches the directory    | Band 2                       |
| Boundary, adjacency, gap           | fzy's bonuses, inside a band |
| The candidate is in the open layer | A flat bonus                 |
| The candidate is in the history    | A bonus decaying with depth  |
| A tie                              | The shorter path wins        |

`__tests__/ranking.fixture.json` holds the query and candidate pairs that fix the order, and
both suites read it: the frontend through `rank.ts` and the Rust side through
`GameIndex::search`. Each case names the exact order a query returns and, where it matters, the
paths it must not return at all.

## 3. The candidates

One flat array, built with `useMemo`, each row carrying its lowercase forms and a 32-bit letter
mask. A query mask that is not a subset of a candidate's rejects that candidate before the
matcher reads a character.

A candidate is a plain record and holds no closure, so a project of a few thousand files builds
a few thousand small objects rather than a few thousand bound functions. `runTarget` in
`ProjectBar` resolves a row to an action.

| Source    | Rows                               | Reads                         |
| --------- | ---------------------------------- | ----------------------------- |
| Documents | The open tabs, history order first | The editor store              |
| Files     | Every file of every layer          | The content tree query        |
| Layers    | The project's layers               | The project record            |
| Strings   | Every override key of every locale | The layer's `stringOverrides` |
| Commands  | `useProjectCommands()`             | The modules' own hooks        |

## 4. The navigation history

`ProjectEditor` gains `history` and `historyIndex`, both session-only — `serializeEditorFile`
names its fields one by one, so neither reaches `.ltk/editor.json`.

Every route that lands on a document records a visit inside the store action itself, so a push
cannot be forgotten at a call site. `navigateHistory` moves the index without recording, which
is what stops a back from pushing a forward entry.

`HistoryEntry.position` is not implemented. The stack restores which document in which group,
and `useDocumentPosition` is left for the pass that needs it.

## 5. What ships

| Step | Holds                                                             |
| ---- | ----------------------------------------------------------------- |
| 1    | `useListNav`, the scorer, the candidates, the command registry    |
| 2    | `CommandPalette` in `@/components`, and `ProjectBar` on top of it |
| 3    | The history slice, the arrows, and their keys                     |
| 4    | The header swap, and the barrel exports                           |

Out of this plan, and named in the design doc: the game source and its Rust scorer, the bin
object source, the `@` scope, the settings row that switches a source off, and the four closes.

## 6. The game source

Step 2 puts the second scorer where the data is. `GameIndex` holds 819,136 files behind a
directory arena, and building that many paths per keystroke costs more than the matching does,
so the scan reads the arena in place.

| Piece        | Where                                                                |
| ------------ | -------------------------------------------------------------------- |
| The scorer   | `crates/ltk-manager-core/src/fuzzy.rs`, a port of `score.ts`         |
| The scan     | `GameIndex::search`, with a `Scan` walking the arena depth first     |
| Cancellation | `SearchGeneration`, an `AtomicU64` a command claims a ticket from    |
| The command  | `search_game_index`, on `spawn_blocking` like every other index read |
| The frontend | `useGameSearch` (120ms debounce), then `useGameRows`                 |

Every way this source can fail looks from the palette like a query that matched nothing, so the
group reports rather than vanishing: it says what it is waiting for while the index builds, it
carries the backend's error where there is one, and it says so where the index built but no hash
table named a chunk - `GameSearchResult::unnamed`, which answers every path query with nothing
and is fixed by a sync rather than by a different query. `search_game_index` logs its query, its
hit count and its verdict.

Three things keep the scan cheap, and all three come from
[The backend side](../ux/PROJECT_EDITOR.md#the-backend-side):

- **A letter mask per file and per directory.** A file's covers its name. A directory's covers
  the union of its subtree, and the walk carries the path's own mask down the stack rather than
  storing it, which holds the index's extra cost to one word per directory
- **One reusable buffer.** The walk pushes and pops a segment on a single `String`, and the
  scorer's two matrices are allocated once per search rather than once per candidate
- **A bounded heap.** `Hit` orders worst first, so a full heap compares against its root and
  drops the row it beats. Nothing sorts a million rows

### Why not a crate

`nucleo-matcher` and `fuzzy-matcher` were both considered while the matcher was a fuzzy one, and
neither was rejected for quality. Two things ruled them out. One ranking rule has to hold across
the IPC boundary and there is no faithful port of either into TypeScript, and moving the
project's own matching into Rust to get a single matcher does not work - a command and an open
tab hold a closure and a React node, so neither crosses IPC at all. Both are also MPL-2.0
against this workspace's `GPL-3.0-or-later`, and neither has shipped a release since 2024.

The question is moot now that a query is a substring. Twenty lines of `find` need no dependency.
It comes back if a fuzzy mode is ever added, and the answer would be the same.

## 7. What is left

| Item                                       | Why it waits                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The four closes as commands                | Their unsaved-edits queue is `EditorSurface` local state, so a command needs a project-level close channel first, the way `reveal` is one                           |
| `HistoryEntry.position`                    | No document supplies a position yet, and `useDocumentPosition` lands with the first one that does                                                                   |
| A test over `CommandPalette` itself        | `useVirtualizer` wants a `ResizeObserver` and a measured scroll box, neither of which jsdom gives. The keyboard model is covered through `useListNav`               |
| A measurement of the game scan             | There is no League install on the machine this was written on. The 819,136-file budget in the design doc is a target, not a reading                                 |
| The game section's archive count           | The mock heads the group `GAME · 456 archives`. Reading that count would fetch the index stats just to open the box, which is the build the setting exists to avoid |
| The layer and history bonuses on game rows | The backend takes no context, so a game row is ranked on its path alone                                                                                             |
