# Tech Context

## Technology Stack

### Backend

- **Language:** Rust (edition 2024, toolchain 1.85+).
- **Application Framework:** Tauri v2 (`tauri` crate).
- **Workspace Structure:** 16 crates organized under `crates/`:
  - `atlas`: Texture and font atlas utilities.
  - `hexshade`: Shaders and GPU rendering helpers.
  - `ltk_patcher`: Core League of Legends process memory injection and hooking.
  - `ltk-manager-base`: Core data types, error handling, and configuration definitions.
  - `ltk-manager-game`: Game directory detection, RADS/WAD indexing, and asset extraction.
  - `ltk-manager-library`: Mod library, profile state, and package parsing.
  - `ltk-manager-storage`: File storage and path resolution.
  - Additional support crates: `ltk-manager-client`, `ltk-manager-hash`, `ltk-manager-meta`, `ltk-manager-profile`, `ltk-manager-report`, `ltk-manager-state`, `ltk-manager-test`, `ltk-meta`, `ltk-runtime`.

### Frontend

- **Runtime & Bundler:** Node.js 20+, Vite 6, pnpm 9+.
- **Framework:** React 19, TypeScript 5.8+.
- **Routing:** TanStack Router (`@tanstack/react-router`).
- **Data Fetching:** TanStack Query (`@tanstack/react-query`).
- **Styling:** Tailwind CSS v4, Lucide React icons.
- **Internationalization:** Inlang Paraglide JS (`@inlang/paraglide-js`).

## Development & Build Commands

All commands execute from the workspace root:

```bash
# Start development server with frontend HMR and Tauri backend
pnpm dev

# Start development with verbose backend logging
pnpm dev:logged

# Run linter and type checks
pnpm lint
pnpm typecheck

# Run frontend tests
pnpm test

# Build production Windows installer and executables
pnpm tauri build --no-sign
```

## Packaging & Distribution

- **Installer System:** NSIS via Tauri bundler (`src-tauri/tauri.conf.json`).
- **Output Artifacts:** `target/release/bundle/nsis/`.
- **Target Architecture:** Windows x86_64 (`x86_64-pc-windows-msvc`).
- **Release Assets:**
  - `Exist.Skin.Manager_<version>_x64-setup.exe`
  - `Exist.Manager_<version>_x64-setup.exe`
  - `ltk-manager.exe`

## Technical Constraints

- **Single Active Instance:** Tauri enforces single instance locking to prevent duplicate injection hooks into the game process.
- **Process Privileges:** Live game patching requires sufficient user permissions to inspect and open game process handles.
- **Vanguard Coexistence:** Memory patching targets game WAD resolution during match loading, avoiding persistent disk modifications to game files.
