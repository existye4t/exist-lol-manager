# Backend (Rust) - `src-tauri/src/`

Conventions for the Rust side. Repo-wide guidance lives in the root `CLAUDE.md`. This file also
governs `crates/ltk-manager-core/`, which imports it.

## Workspace Crates

| Crate                     | Knows about                       | Depends on   | License            |
| ------------------------- | --------------------------------- | ------------ | ------------------ |
| `crates/ltk-manager-core` | Manager domain logic, UI-agnostic | `ritoclient` | `GPL-3.0-or-later` |
| `src-tauri`               | Tauri commands, IPC, events       | core         | `GPL-3.0-or-later` |

`ritoclient` is an external dependency rather than a workspace member, pinned to a git rev in the
root `Cargo.toml` until it ships on crates.io. It is **Apache-2.0**, where this workspace is
GPL-3.0-or-later - not an oversight to tidy. Re-run `pnpm generate:licenses` after any dependency
is added or relicensed.

Dependencies point one way only. `ritoclient` takes plain arguments (`Option<&Path>`) and reports
through its own `LaunchObserver` and `SessionObserver` traits - it must never learn about `Config`,
`EventSink` or `AppError`. `core/src/launcher/` is the seam that adapts between them, and
`launcher/types.rs` mirrors every launch shape that crosses IPC so an upstream rename is a compile
error there rather than a frontend union that quietly disagrees.

Read-only calls to the Riot Client return `Option`, never `Result`: every caller has a fallback,
and "the client didn't answer" is not a failure worth showing a user. Only launching, closing and
building a launcher return `LauncherError`.

## Tests

Unit tests live in a file of their own. A module keeps `#[cfg(test)] mod tests;` as its last item
and the suite moves next to it - `hashtables.rs` to `hashtables/tests.rs`, `problems/mod.rs` to
`problems/tests.rs`. The module is still a child, so `use super::*` reaches the private items it
always did.

What this buys is a production file that is only production code, and a suite that can grow
without burying it. Leave a test inline only where it is a few lines that read as part of the
thing they check, such as a round-trip beside the conversion it exercises.

## Patcher

`patcher/` owns patcher lifecycle (start/stop/status) and thread management with an
`Arc<AtomicBool>` stop flag. `patcher/injector.rs` spawns and supervises the external
`cslol-host.exe` injection host over a stdin/stdout line protocol (`patcher/host.rs`). The
overlay/prefix dir is sent via a `config prefix` command, **not** as an argv. The host internally
drives `cslol-inj.exe`, and with `--elevate` (auto-enabled when League runs as admin) it bridges to
a high-integrity worker via UAC.

## State

Three Tauri-managed states:

- `SettingsState` - App settings (league path, storage path, theme). Access via `State<SettingsState>`, lock with `.0.lock().mutex_err()?.clone()`.
- `PatcherState` - Patcher thread handle and stop flag. Access via `State<PatcherState>`.
- `LauncherState` - The one `LeagueLauncher`, built at startup. It holds the session watcher and
  the window hider, which outlive the command that started them, so `save_settings` calls
  `reconfigure` rather than rebuilding it.
