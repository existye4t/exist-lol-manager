//! The passes that bring the library in line with disk when the app starts.
//!
//! Each of the three is defined by the module that owns it. This is only the
//! order they run in, which is the one thing none of them can decide alone.

use crate::config::Config;
use crate::events::BackendEvent;
use crate::mods::ModLibrary;

use crate::mods::HealthSweepState;

use super::layout_migration::LayoutMigrationState;

impl ModLibrary {
    /// Bring the library in line with what is on disk, off the startup path.
    ///
    /// Runs on a detached thread so the Tauri event loop starts immediately and
    /// IPC stays responsive instead of blocking on a disk scan. Emits
    /// `library-changed` when anything moved, so the frontend refetches.
    ///
    /// `tables_installed` is called when the startup sync installs new
    /// hashtables. The library reopens what it holds itself, and this is for
    /// everything else the app read out of the old tables.
    pub fn maintain_in_background(
        &self,
        config: Config,
        tables_installed: impl FnOnce() + Send + 'static,
    ) {
        let library = self.clone();
        std::thread::spawn(move || library.maintain(&config, tables_installed));
    }

    /// The five startup passes, in the order their dependencies demand.
    ///
    /// The staging sweep goes first because startup is the one moment nothing
    /// can be mid-install, which is what makes clearing another process's
    /// staging directories safe. The layout migration goes before
    /// reconciliation because reconciliation stands down until the migration
    /// pass has reported — it would read a mod mid-move as an orphan. The
    /// patcher state reconciliation goes after reconciliation to validate mod
    /// apply state against the actual profile. The health sweep goes last
    /// because it reads every mod's content.
    ///
    /// The hashtable sync sits immediately in front of the sweep rather than at
    /// the head of the pass, because it is the only one of the four that waits
    /// on a network and the three above it are what the library view is
    /// drawing.
    fn maintain(&self, config: &Config, tables_installed: impl FnOnce()) {
        if let Ok(storage_dir) = self.storage_dir(config) {
            super::reconcile::sweep_stale_staging(&storage_dir);
        }

        let migrated = match self.migrate_library_layout(config) {
            Ok(report) => report.migrated > 0 || !report.failed.is_empty(),
            Err(e) => {
                tracing::warn!("Failed to migrate the library layout: {}", e);
                // Whoever is waiting on an answer has to get one, or it waits
                // for the rest of the session.
                self.record_layout_migration(LayoutMigrationState::Idle);
                false
            }
        };

        let reconciled = match self.reconcile_index(config) {
            Ok(reconciled) => reconciled,
            Err(e) => {
                tracing::warn!("Failed to reconcile library on startup: {}", e);
                false
            }
        };

        // Validate that apply state is consistent after reconciliation.
        // If a patcher session crashed, enabled_mods might reference mods
        // that don't exist anymore or have invalid state.
        if let Err(e) = self.reconcile_patcher_state(config) {
            tracing::warn!("Failed to reconcile patcher state on startup: {}", e);
        }

        // Announced before the health sweep rather than after it: the sweep
        // reads every mod and the library view has no reason to wait on that to
        // draw what the two passes above just changed.
        if migrated || reconciled {
            self.events.emit(BackendEvent::LibraryChanged);
        }

        if self.fill_hashtables() {
            tables_installed();
        }
        self.fill_meta_schema();

        if let Err(e) = self.sweep_mod_health(config) {
            tracing::warn!("Failed to sweep mod health on startup: {}", e);
            // Whoever is waiting on an answer has to get one, or it waits for
            // the rest of the session.
            self.record_health_sweep(HealthSweepState::Idle);
        }

        // Always emit LibraryChanged at the end of startup, even if nothing
        // above changed. The frontend may have called get_installed_mods
        // before reconciliation completed, so this signals that startup
        // maintenance is complete and queries should be refreshed.
        if !migrated && !reconciled {
            self.events.emit(BackendEvent::LibraryChanged);
        }
    }
}
