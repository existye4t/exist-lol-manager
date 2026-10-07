<div align="center">
  <a href="https://github.com/existye4t/exist-lol-manager">
    <img src="src-tauri/icons/128x128@2x.png" alt="Exist LoL Manager logo" width="96" height="96">
  </a>
  <h1>Exist LoL Manager</h1>
  <p><strong>Next-generation League of Legends skin and mod manager powered by LTK 1.27.0</strong></p>
</div>

Exist LoL Manager combines the [League Toolkit](https://github.com/LeagueToolkit) (LTK) 1.27.0 injection and mod engine with an integrated skin catalog, direct RuneForge integration, and automated mod lifecycle management.

[![Windows 10+](https://img.shields.io/badge/Windows-10+-0078D4?style=for-the-badge&logo=windows)](#installation)
[![LTK Core: 1.27.0](https://img.shields.io/badge/LTK%20Core-1.27.0-purple?style=for-the-badge)](https://github.com/LeagueToolkit/ltk-manager)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](LICENSE)

<div align="center">

**[Features](#features)** · **[Installation](#installation)** · **[Quick Start](#quick-start)** · **[Building from Source](#building-from-source)** · **[Troubleshooting](#troubleshooting)**

</div>

---

## Features

### 1. Exist Skin Library
- **Curated Catalog:** Browse champions and custom skins indexed from the Finder repository with verified Fantome archives and checksums.
- **Fast Client Caching:** Instant offline catalog access with background sync.
- **Automated Version Tracking:** Detects when catalog skins receive newer versions and displays a one-click **Update** button.
- **Download Queue:** Integrated background downloads with pause, resume, retry, and progress metrics.

### 2. RuneForge Integration
- **Public Catalog Browsing:** Search and discover skins, maps, HUDs, and SFX directly from RuneForge.
- **Direct Downloads:** One-click download and installation without external browser redirects or public API limitations.
- **Cover Artwork Caching:** Automatic thumbnail retrieval from RuneForge CDN with offline caching.

### 3. Unified Installed & Cache View
- **Multi-Source Filtering:** Filter installed packages by source (`Exist Library` vs `RuneForge`).
- **Category Filtering:** View by package category (`Skin`, `Map`, `UI / HUD`, `SFX`).
- **Clean Workspace Separation:** Curated packages are separated from raw imported custom skins to keep your library organized.

### 4. Patcher Engine & Profile Sync (LTK 1.27.0)
- **Zero-Crash Game Patching:** Uses the LTK 1.27.0 injection host and runtime overlay builder.
- **Active Selection Sync:** Deleting an enabled skin automatically unapplies it from the active profile, keeping the patcher selection count accurate.
- **One-Click Reset:** Reset active selections immediately from the sidebar.
- **Built-in Creator Workshop:** Inspect game archives, browse `.wad` trees, edit `.bin` files via ritobin, and build `.modpkg` archives.

---

## Installation

1. Download the latest installer from the [Releases](https://github.com/existye4t/exist-lol-manager/releases) page.
2. Run the installer and launch **Exist LoL Manager**.
3. On first startup, the app detects your League of Legends installation directory automatically. If prompted, select your game directory manually.

---

## Quick Start

### Applying a Skin from the Catalog
1. Navigate to **Champions** or **Featured Skins**.
2. Select a skin and click **Download Fantome**.
3. Once downloaded, switch to **Installed & Cache** or the champion detail drawer and click **Apply Skin**.
4. Click **START PATCHER** in the sidebar.
5. Launch League of Legends through the Riot Client.

### Downloading from RuneForge
1. Click **RuneForge** in the sidebar.
2. Search for any champion, map, or UI mod.
3. Open the mod details and click **Download & Install**.
4. The mod is automatically installed, thumbnail-cached, and added to **Installed & Cache**.

### Importing Custom Files
1. Navigate to **Custom Skins** in the sidebar.
2. Click **Import Skins** and select any `.fantome` or `.modpkg` file.
3. Toggle the switch to enable or disable the skin.

---

## Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)
- [Rust](https://rustup.rs/) (stable toolchain)
- Visual Studio C++ Build Tools (Windows)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/existye4t/exist-lol-manager.git
cd exist-lol-manager

# Install frontend dependencies
pnpm install

# Run frontend checks
pnpm check

# Start development build with live reload
pnpm dev

# Start development build with verbose backend logs
pnpm dev:logged
```

### Production Build

```bash
pnpm build:app
```

The compiled installer and binaries will be written to `src-tauri/target/release/bundle/`.

---

## Troubleshooting & Logs

If you encounter issues during patching or downloads, review the application log:

- **Windows:** `%APPDATA%\dev.leaguetoolkit.manager\logs\ltk-manager.log`
- **Linux / macOS:** `~/.local/share/dev.leaguetoolkit.manager/logs/ltk-manager.log`

Common resolutions:
- **Game path not recognized:** Open **Settings > League** and ensure the path points to the directory containing `LeagueClient.exe`.
- **Patcher count desynchronized:** Click **Reset** beside the Start Patcher button in the sidebar to reset all enabled skins.
- **Antivirus false positives:** Add an exclusion for `%APPDATA%\dev.leaguetoolkit.manager` and the installation folder.

---

## Credits & License

- Core patching engine and architecture by the **[League Toolkit](https://github.com/LeagueToolkit)** team ([ltk-manager](https://github.com/LeagueToolkit/ltk-manager)).
- Exist Skin Library and RuneForge integration maintained by **[existye4t](https://github.com/existye4t)**.
- Licensed under the [GNU General Public License v3.0 or later](LICENSE).
- Patcher binaries are governed by the [LTK Patcher License](LTK-PATCHER-LICENSE.md).
