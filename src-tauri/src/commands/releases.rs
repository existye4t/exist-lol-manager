//! The release feed over IPC, as the changelog scrolls through it.

use crate::error::IpcResult;
use crate::releases::{self, ReleaseFeedError, ReleasePage};

/// Read page `page` of the release feed, one-based as GitHub numbers it.
///
/// Spawned rather than run through [`off_thread`](super::off_thread), because
/// the feed reports its own remedies rather than core's `AppError`.
#[tauri::command]
pub async fn list_releases(page: u32) -> IpcResult<ReleasePage> {
    tauri::async_runtime::spawn_blocking(move || releases::fetch_page(page))
        .await
        .unwrap_or_else(|e| Err(ReleaseFeedError::Interrupted(e.to_string())))
        .into()
}
