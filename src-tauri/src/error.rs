//! How a domain error reaches the frontend.
//!
//! [`AppError`] itself lives in core and says only what went wrong. This module
//! owns the IPC representation of it: the [`AppErrorResponse`] payload, tagged
//! on a stable `code` the frontend matches on and carrying the fields it
//! translates over, and the [`IpcResult`] envelope every command returns. The
//! `From<AppError>` mapping below is the single place that decides which
//! variants collapse to the same code and which fields each carries.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use ltk_manager_core::error::{
    AppError, AppResult, MutexResultExt, OverlayErrorCategory, Utf8PathExt,
};
use ltk_manager_core::launcher::LauncherError;
use ltk_manager_core::patcher::PatcherError;
use ltk_manager_core::workshop::WorkshopError;

use crate::releases::{ReleaseFeedError, ReleaseFeedErrorKind};

/// What went wrong, as the fields the frontend translates over.
///
/// The frontend owns every sentence a user reads (ADR-0017), so no variant
/// carries one. A `detail` is prose from outside the app, such as an OS or
/// crate error, which the frontend draws as data under a title of its own.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, rename = "AppError")]
#[serde(
    tag = "code",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum AppErrorResponse {
    /// File system I/O failed.
    Io { detail: String },
    /// JSON could not be read or written.
    Serialization { detail: String },
    /// A `.modpkg` could not be processed.
    Modpkg { detail: String },
    /// No League of Legends installation is configured.
    LeagueNotFound,
    /// A file or directory path cannot be used.
    InvalidPath { path: String },
    /// No installed mod has this id.
    ModNotFound { mod_id: String },
    /// Input failed validation.
    ValidationFailed { detail: String },
    /// Internal state was not what the operation needed.
    InternalState { detail: String },
    /// A mutex was poisoned.
    MutexLockFailed,
    /// A failure with no code of its own.
    Unknown { detail: String },
    /// No workshop directory is configured.
    WorkshopNotConfigured,
    /// No workshop project has this name.
    ProjectNotFound { project_name: String },
    /// A workshop project with this name already exists.
    ProjectAlreadyExists { project_name: String },
    /// A workshop project could not be packed.
    PackFailed { detail: String },
    /// A `.fantome` could not be processed.
    Fantome { detail: String },
    /// A WAD could not be read or built.
    Wad { detail: String },
    /// The patcher refused or a start failed. The variant says which.
    ///
    /// One code, not one per [`PatcherError`] variant: the whole error travels,
    /// so a code per variant would put the same discriminant on the wire twice.
    Patcher { error: PatcherError },
    /// A ZIP archive could not be processed.
    Zip { detail: String },
    /// The library index was written by a newer app version.
    SchemaVersionTooNew {
        file_version: u32,
        max_supported: u32,
    },
    /// A workshop operation failed. The variant says which.
    Workshop { error: WorkshopError },
    /// A launch failed. The variant says which and carries its remedy's inputs.
    Launcher { error: LauncherError },
    /// A hashtable cache operation failed.
    ///
    /// `HashtableError` is not `Serialize`, so the detail is where the
    /// variant's own words ride.
    Hashtable { detail: String },
    /// An asset could not be previewed.
    Preview { detail: String },
    /// An overlay build or analysis failed.
    ///
    /// One code with a category, not one per category: `ltk_overlay::Error`
    /// is `#[non_exhaustive]`, so a new category arrives as
    /// [`OverlayErrorCategory::Other`] rather than as a code the frontend has
    /// never heard of.
    Overlay {
        category: OverlayErrorCategory,
        detail: String,
    },
    /// The release feed could not be read. The kind says which remedy applies.
    Releases {
        kind: ReleaseFeedErrorKind,
        detail: String,
    },
}

/// Result type for IPC commands.
///
/// ```rust
/// #[tauri::command]
/// pub fn my_command() -> IpcResult<String> {
///     my_command_inner().into()
/// }
///
/// fn my_command_inner() -> AppResult<String> {
///     Ok("value".to_string())
/// }
/// ```
///
/// Serializes to: `{ "ok": true, "value": T }` or `{ "ok": false, "error": ... }`
#[derive(Debug, Clone)]
pub enum IpcResult<T> {
    Ok { value: T },
    Err { error: AppErrorResponse },
}

// Custom serialization to use actual boolean values for the `ok` field
impl<T: Serialize> Serialize for IpcResult<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            IpcResult::Ok { value } => {
                let mut state = serializer.serialize_struct("IpcResult", 2)?;
                state.serialize_field("ok", &true)?;
                state.serialize_field("value", value)?;
                state.end()
            }
            IpcResult::Err { error } => {
                let mut state = serializer.serialize_struct("IpcResult", 2)?;
                state.serialize_field("ok", &false)?;
                state.serialize_field("error", error)?;
                state.end()
            }
        }
    }
}

impl<T> IpcResult<T> {
    pub fn ok(value: T) -> Self {
        IpcResult::Ok { value }
    }

    #[allow(dead_code)]
    pub fn err(error: impl Into<AppErrorResponse>) -> Self {
        IpcResult::Err {
            error: error.into(),
        }
    }
}

impl<T, E: Into<AppErrorResponse>> From<Result<T, E>> for IpcResult<T> {
    fn from(result: Result<T, E>) -> Self {
        match result {
            Ok(value) => IpcResult::Ok { value },
            Err(e) => IpcResult::Err { error: e.into() },
        }
    }
}

impl From<AppError> for AppErrorResponse {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Io(e) => Self::Io {
                detail: e.to_string(),
            },
            AppError::Serialization(e) => Self::Serialization {
                detail: e.to_string(),
            },
            AppError::Modpkg(e) => Self::Modpkg {
                detail: e.to_string(),
            },
            AppError::LeagueNotFound => Self::LeagueNotFound,
            AppError::InvalidPath(path) => Self::InvalidPath { path },
            AppError::ModNotFound(mod_id) => Self::ModNotFound { mod_id },
            AppError::ValidationFailed(detail) => Self::ValidationFailed { detail },
            AppError::InternalState(detail) => Self::InternalState { detail },
            AppError::MutexLockFailed => Self::MutexLockFailed,
            AppError::Other(detail) => Self::Unknown { detail },
            AppError::WorkshopNotConfigured => Self::WorkshopNotConfigured,
            AppError::ProjectNotFound(project_name) => Self::ProjectNotFound { project_name },
            AppError::ProjectAlreadyExists(project_name) => {
                Self::ProjectAlreadyExists { project_name }
            }
            AppError::PackFailed(detail) => Self::PackFailed { detail },
            AppError::Fantome(detail) => Self::Fantome { detail },
            AppError::WadError(e) => Self::Wad {
                detail: e.to_string(),
            },
            AppError::WadBuilderError(e) => Self::Wad {
                detail: e.to_string(),
            },
            AppError::Patcher(error) => Self::Patcher { error },
            AppError::Launcher(error) => Self::Launcher { error },
            AppError::ZipError(e) => Self::Zip {
                detail: e.to_string(),
            },
            AppError::SchemaVersionTooNew {
                file_version,
                max_supported,
            } => Self::SchemaVersionTooNew {
                file_version,
                max_supported,
            },
            AppError::Workshop(error) => Self::Workshop { error },
            AppError::Hashtable(e) => Self::Hashtable {
                detail: e.to_string(),
            },
            AppError::Preview(e) => Self::Preview {
                detail: e.to_string(),
            },
            AppError::Overlay(e) => Self::Overlay {
                category: OverlayErrorCategory::from(&e),
                detail: e.to_string(),
            },
        }
    }
}

impl From<ReleaseFeedError> for AppErrorResponse {
    fn from(error: ReleaseFeedError) -> Self {
        Self::Releases {
            kind: error.kind(),
            detail: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests;
