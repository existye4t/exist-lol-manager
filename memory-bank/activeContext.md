# Active Context

## Current Status

- **Version:** v1.27.0 (Production Release).
- **Git Branch:** `main` and `exist-lol-manager` are synchronized with remote.
- **GitHub Release:** Published at `https://github.com/existye4t/exist-lol-manager/releases/tag/v1.27.0`.

## Recent Milestones & Changes

- **Release v1.27.0 Assets Published:**
  - Built Windows NSIS installers: `Exist.Skin.Manager_1.27.0_x64-setup.exe` and `Exist.Manager_1.27.0_x64-setup.exe`.
  - Built standalone executable: `ltk-manager.exe`.
  - Maintained installer filename compatibility with v1.16.0 in-app updater heuristics.

- **Artwork & Thumbnail Caching Fix:**
  - RuneForge downloads now pass `thumbnailKey` to `install_runeforge_mod`.
  - Thumbnail files are written directly to `<mod_path>/thumbnail.png` and tracked in `runeforge/installed_mods.json`.
  - Fixed "No Artwork" fallback on installed community skins.

- **Patcher Selection Count & Mod Deletion Sync:**
  - Deleting or uninstalling an enabled mod unapplies it first via `toggleMod(id, false)`.
  - Eliminates phantom selection counts on the Start Patcher button.

- **Installed Badge Harmonization:**
  - Unified the Installed badge count across curated and RuneForge mods (`safeInstalled.length + localMods.filter(isRuneForgeMod).length`).

- **Anti-Skinhack Scan Policy:**
  - Set `enforce_skinhack_scan = false` as default in `crates/ltk-manager-base/src/config.rs`.
  - Custom skins and champion WAD assets load without false-positive blocking.

## Immediate Priorities

1. Gather user feedback on the v1.27.0 release.
2. Monitor RuneForge API uptime and schema changes.
3. Keep upstream synchronization (`exist_sync.rs`) ready for future LTK patches.
