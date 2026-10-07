# Product Context

## Why Exist LoL Manager Exists

Standard League of Legends skin modding often requires tedious manual steps. Users traditionally download zip or `.fantome` files from various websites, extract them into folders, import them manually, and troubleshoot crashes caused by outdated files or broken metadata.

Upstream LTK delivers a robust patching engine, but lacks a built-in browsing experience for community mods. Users still had to leave the application to find content.

Exist LoL Manager integrates discovery and installation directly into the client. Users can search for champion skins, preview their artwork, and install them with a single click.

## Problems Solved

- **Missing Artwork & Broken Previews:** Community mods often lack standard metadata or host remote images that fail to load. Exist LoL Manager downloads and caches `thumbnail.png` files directly inside each mod folder upon installation.
- **Ghost Selections:** When a user deleted an enabled skin from their library, the patcher profile previously retained an active selection reference. This caused phantom selection counts (e.g., displaying "2 Selected" when only 1 skin existed). Exist LoL Manager strictly unapplies mods before deleting them.
- **Fragmented Counts:** Users could not see their total installed mods at a glance. Exist LoL Manager unifies curated skins and local RuneForge mods into a single, accurate badge counter.
- **Scan Blocks:** Aggressive anti-skinhack scanning previously prevented legitimate custom skins and champion replacements from loading. Exist LoL Manager disables `enforce_skinhack_scan` by default so users can use their mods without false positives.

## Core User Workflows

1. **Browsing & Discovery:**
   - User navigates to the Skin Library (`/skins`).
   - User filters by champion or searches RuneForge community mods.
   - User views high-resolution splash art and mod descriptions.

2. **One-Click Installation:**
   - User clicks Install on a chosen skin.
   - The backend downloads the archive and saves `thumbnail.png`.
   - The mod is added to the active library and appears in the Installed tab.

3. **Live In-Game Patching:**
   - User enables the desired skins.
   - User clicks Start Patcher.
   - When League of Legends launches, the engine hooks the game process and injects the active mods on the fly.
