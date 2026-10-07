# Progress

## Completed Features

### Curated Skin Library

- Integrated champion skin grid and search bar.
- Remote catalog fetching and local profile activation.
- Accurate installed status indicators.

### RuneForge Community Browser

- Real-time search and filtering for RuneForge mod archives.
- Automated download, decompression, and local `.fantome` extraction.
- Local thumbnail extraction and caching (`thumbnail.png`).

### Patching Engine & Selection Sync

- Process-level injection synchronized with League game start.
- Mod enabling and disabling per profile.
- Automatic removal of active selections when deleting or uninstalling mods.
- Patcher button selection count strictly aligned with enabled mods.

### Localization & UI Experience

- English and Turkish language support.
- Modern dark theme interface with responsive layouts.
- Unified Installed mod counter in the sidebar.

### Updates & Distribution

- In-app update checker through `exist_sync.rs`.
- Automated installer asset detection supporting backwards-compatible names.
- Public GitHub release pipeline established with v1.27.0.

## Verified Releases

| Release | Date       | Commit    | Assets                                                                                                 |
| ------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------ |
| v1.27.0 | 2026-10-07 | `ea14bab` | `Exist.Skin.Manager_1.27.0_x64-setup.exe`<br>`Exist.Manager_1.27.0_x64-setup.exe`<br>`ltk-manager.exe` |

## Next Steps

1. Collect community telemetry and issue reports on v1.27.0.
2. Optimize download throughput and chunked caching for large skin packages.
3. Keep dependency crates updated with upstream LTK improvements.
