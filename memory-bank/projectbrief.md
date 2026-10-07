# Project Brief

Exist LoL Manager is an extended, modern League of Legends mod manager and live skin patching client.

The project builds directly on the open-source League Toolkit (LTK) 1.27.0+ architecture. It extends the core engine with a curated custom skin catalog, native RuneForge community mod integration, localized metadata, and automated release coordination.

## Core Goals

- Provide a reliable, crash-free skin injection and live game patching workflow.
- Offer an integrated catalog for exploring, searching, and installing curated skins.
- Support direct RuneForge community mod search, one-click download, and automated archive extraction.
- Cache mod artwork and thumbnails locally to guarantee responsive UI rendering without broken image states.
- Maintain seamless synchronization between the mod library, active patcher selection, and client storage.
- Provide smooth in-app updates with backwards-compatible release asset discovery.

## Scope and Boundaries

- **In Scope:**
  - Game client detection and live WAD memory patching through `ltk_patcher`.
  - Managing custom skins, `.fantome` archives, and raw asset modifications.
  - Curated skin catalog APIs and RuneForge search proxies.
  - Multi-language localization (including Turkish and English).
  - Multi-profile mod activation and conflict resolution.

- **Out of Scope:**
  - Modifying League of Legends game files on disk permanently.
  - Bypassing Riot Vanguard or anti-cheat mechanisms.
  - Server-side matchmaking manipulation.
