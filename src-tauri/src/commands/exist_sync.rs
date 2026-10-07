use crate::error::{AppError, AppResult, IpcResult};
use crate::services::shared::off_thread;
use crate::state::get_app_data_dir;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CURRENT_LTK_VERSION: &str = "1.27.0";
const UPSTREAM_LTK_RELEASES_API: &str =
    "https://api.github.com/repos/LeagueToolkit/ltk-manager/releases";
const EXIST_RELEASES_API: &str =
    "https://api.github.com/repos/existye4t/exist-lol-manager/releases/latest";
const SYNC_INTERVAL_HOURS: u64 = 6;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExistSyncStatus {
    pub last_checked_at: Option<String>,
    pub current_ltk_version: String,
    pub latest_upstream_version: Option<String>,
    pub has_upstream_update: bool,
    pub status: String,
    pub last_error: Option<String>,
    pub requires_manual_review: bool,
    pub review_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExistAppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_notes: Option<String>,
    pub asset_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
    pub published_at: Option<String>,
}

pub struct ExistSyncState {
    pub is_checking: AtomicBool,
    pub status: RwLock<ExistSyncStatus>,
}

impl Default for ExistSyncState {
    fn default() -> Self {
        Self {
            is_checking: AtomicBool::new(false),
            status: RwLock::new(ExistSyncStatus {
                last_checked_at: None,
                current_ltk_version: CURRENT_LTK_VERSION.to_string(),
                latest_upstream_version: None,
                has_upstream_update: false,
                status: "idle".to_string(),
                last_error: None,
                requires_manual_review: false,
                review_reason: None,
            }),
        }
    }
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    published_at: Option<String>,
    assets: Option<Vec<GitHubAsset>>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
}

fn sync_state_file(app: &AppHandle) -> AppResult<PathBuf> {
    get_app_data_dir(app)
        .map(|path| path.join("exist").join("ltk-sync-state.json"))
        .ok_or_else(|| AppError::Other("Could not resolve Exist data directory".into()))
}

fn load_persisted_sync_status(app: &AppHandle) -> Option<ExistSyncStatus> {
    let path = sync_state_file(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_persisted_sync_status(app: &AppHandle, status: &ExistSyncStatus) {
    if let Ok(path) = sync_state_file(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let temporary = path.with_extension("tmp");
        if let Ok(bytes) = serde_json::to_vec_pretty(status) {
            if fs::write(&temporary, bytes).is_ok() {
                let _ = fs::rename(temporary, path);
            }
        }
    }
}

pub fn init_sync_state(app: &AppHandle) {
    if let Some(loaded) = load_persisted_sync_status(app) {
        if let Some(state) = app.try_state::<ExistSyncState>() {
            *state.status.write() = loaded;
        }
    }
}

pub fn start_background_sync(app: AppHandle) {
    init_sync_state(&app);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // Startup initial delay: 5 seconds
        tokio::time::sleep(Duration::from_secs(5)).await;
        let _ = perform_upstream_check(&app_clone).await;

        // Recurring interval: every 6 hours
        let mut interval = tokio::time::interval(Duration::from_secs(SYNC_INTERVAL_HOURS * 3600));
        loop {
            interval.tick().await;
            let _ = perform_upstream_check(&app_clone).await;
        }
    });
}

#[tauri::command]
pub async fn get_exist_sync_status(app: AppHandle) -> IpcResult<ExistSyncStatus> {
    let state = app.state::<ExistSyncState>();
    let status = state.status.read().clone();
    IpcResult::ok(status)
}

#[tauri::command]
pub async fn check_exist_upstream_sync(app: AppHandle) -> IpcResult<ExistSyncStatus> {
    off_thread(move || {
        let app_clone = app.clone();
        tauri::async_runtime::block_on(async { perform_upstream_check(&app_clone).await })
    })
    .await
}

pub async fn perform_upstream_check(app: &AppHandle) -> AppResult<ExistSyncStatus> {
    let state = match app.try_state::<ExistSyncState>() {
        Some(s) => s,
        None => {
            return Err(AppError::InternalState(
                "ExistSyncState not registered".into(),
            ))
        }
    };

    if state.is_checking.swap(true, Ordering::SeqCst) {
        return Ok(state.status.read().clone());
    }

    {
        let mut current = state.status.write();
        current.status = "checking".to_string();
    }

    let client = reqwest::Client::builder()
        .user_agent("Exist-LoL-Manager")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let response = client.get(UPSTREAM_LTK_RELEASES_API).send().await;

    let result = match response {
        Ok(resp) if resp.status().is_success() => {
            let releases: Vec<GitHubRelease> = resp.json().await.unwrap_or_default();
            // Filter stable releases (not draft, not prerelease, starts with 'v')
            let latest_stable = releases
                .into_iter()
                .filter(|r| !r.draft && !r.prerelease && r.tag_name.starts_with('v'))
                .find(|r| {
                    let version_str = r.tag_name.trim_start_matches('v');
                    semver::Version::parse(version_str).is_ok()
                });

            match latest_stable {
                Some(release) => {
                    let tag = release.tag_name.clone();
                    let upstream_semver =
                        semver::Version::parse(tag.trim_start_matches('v')).unwrap();
                    let current_semver = semver::Version::parse(CURRENT_LTK_VERSION).unwrap();

                    let has_update = upstream_semver > current_semver;

                    // Evaluate safe integration & breaking changes
                    let (requires_manual_review, review_reason) = if has_update {
                        check_safe_diff(&client, CURRENT_LTK_VERSION, &tag).await
                    } else {
                        (false, None)
                    };

                    let new_status = ExistSyncStatus {
                        last_checked_at: Some(chrono::Utc::now().to_rfc3339()),
                        current_ltk_version: CURRENT_LTK_VERSION.to_string(),
                        latest_upstream_version: Some(tag),
                        has_upstream_update: has_update,
                        status: if has_update {
                            "update_available".to_string()
                        } else {
                            "up_to_date".to_string()
                        },
                        last_error: None,
                        requires_manual_review,
                        review_reason,
                    };
                    save_persisted_sync_status(app, &new_status);
                    *state.status.write() = new_status.clone();
                    Ok(new_status)
                }
                None => {
                    let mut current = state.status.write();
                    current.status = "idle".to_string();
                    current.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
                    save_persisted_sync_status(app, &current);
                    Ok(current.clone())
                }
            }
        }
        Ok(resp) => {
            tracing::warn!(
                "Upstream release check returned non-200 status: {}",
                resp.status()
            );
            let mut current = state.status.write();
            current.status = "error".to_string();
            current.last_error = Some(format!("HTTP error {}", resp.status()));
            Ok(current.clone())
        }
        Err(err) => {
            tracing::warn!("Upstream release check failed silently: {}", err);
            let mut current = state.status.write();
            current.status = "error".to_string();
            current.last_error = Some(err.to_string());
            Ok(current.clone())
        }
    };

    state.is_checking.store(false, Ordering::SeqCst);
    result
}

async fn check_safe_diff(
    client: &reqwest::Client,
    current_version: &str,
    upstream_tag: &str,
) -> (bool, Option<String>) {
    let compare_url = format!(
        "https://api.github.com/repos/LeagueToolkit/ltk-manager/compare/v{}...{}",
        current_version, upstream_tag
    );
    let resp = client.get(&compare_url).send().await;
    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(files) = json.get("files").and_then(|f| f.as_array()) {
                    let critical_paths = [
                        "crates/ltk-manager-base/src/config.rs",
                        "crates/ltk-manager-library/src/mods/mod.rs",
                        "crates/ltk-manager-runtime/src/patcher/",
                        "src-tauri/src/main.rs",
                        "src-tauri/src/setup.rs",
                        "src-tauri/tauri.conf.json",
                    ];
                    let mut conflicting_files = Vec::new();
                    for file in files {
                        if let Some(filename) = file.get("filename").and_then(|f| f.as_str()) {
                            for crit in &critical_paths {
                                if filename.starts_with(crit) {
                                    conflicting_files.push(filename.to_string());
                                }
                            }
                        }
                    }
                    if !conflicting_files.is_empty() {
                        return (
                            true,
                            Some(format!(
                                "Critical architectural files modified upstream: {}",
                                conflicting_files.join(", ")
                            )),
                        );
                    }
                }
            }
        }
    }
    (false, None)
}

#[tauri::command]
pub async fn check_exist_app_update(_app: AppHandle) -> IpcResult<ExistAppUpdateInfo> {
    off_thread(move || {
        let app_version = env!("CARGO_PKG_VERSION");
        let client = reqwest::blocking::Client::builder()
            .user_agent("Exist-LoL-Manager")
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;

        let response = client.get(EXIST_RELEASES_API).send();
        match response {
            Ok(resp) if resp.status().is_success() => {
                let release: GitHubRelease = resp.json().map_err(|e| AppError::Other(e.to_string()))?;
                let clean_remote = release.tag_name.trim_start_matches('v');
                let remote_semver = semver::Version::parse(clean_remote).unwrap_or_else(|_| semver::Version::new(0, 0, 0));
                let local_semver = semver::Version::parse(app_version).unwrap_or_else(|_| semver::Version::new(0, 0, 0));

                let has_update = remote_semver > local_semver;
                let asset = release.assets.as_ref().and_then(|assets| {
                    assets.iter().find(|a| a.name.ends_with(".exe") || a.name.ends_with(".msi"))
                });

                Ok(ExistAppUpdateInfo {
                    current_version: app_version.to_string(),
                    latest_version: release.tag_name,
                    has_update,
                    release_notes: release.body,
                    asset_url: asset.map(|a| a.browser_download_url.clone()),
                    asset_name: asset.map(|a| a.name.clone()),
                    asset_size: asset.map(|a| a.size),
                    published_at: release.published_at,
                })
            }
            _ => Ok(ExistAppUpdateInfo {
                current_version: app_version.to_string(),
                latest_version: app_version.to_string(),
                has_update: false,
                release_notes: None,
                asset_url: None,
                asset_name: None,
                asset_size: None,
                published_at: None,
            }),
        }
    })
    .await
}

#[tauri::command]
pub async fn start_exist_app_update(app: AppHandle) -> IpcResult<()> {
    off_thread(move || {
        let update_info = check_exist_app_update_blocking(&app)?;
        if !update_info.has_update {
            return Err(AppError::ValidationFailed("No update available".into()));
        }
        let url = update_info.asset_url.ok_or_else(|| {
            AppError::ValidationFailed("Update release has no installer executable".into())
        })?;
        let asset_name = update_info
            .asset_name
            .unwrap_or_else(|| "Exist-Manager-setup.exe".to_string());

        let temp_dir = std::env::temp_dir().join("exist-manager-update");
        fs::create_dir_all(&temp_dir)?;
        let installer_path = temp_dir.join(&asset_name);

        let client = reqwest::blocking::Client::builder()
            .user_agent("Exist-LoL-Manager")
            .timeout(Duration::from_secs(600))
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;

        let mut resp = client
            .get(&url)
            .send()
            .map_err(|e| AppError::Other(format!("Failed to download update: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Other(format!(
                "Download failed with status {}",
                resp.status()
            )));
        }

        let mut file = fs::File::create(&installer_path)?;
        std::io::copy(&mut resp, &mut file)?;

        // Validate executable header
        let mut header = [0u8; 2];
        let mut check_file = fs::File::open(&installer_path)?;
        let _ = std::io::Read::read_exact(&mut check_file, &mut header);
        if &header != b"MZ" {
            let _ = fs::remove_file(&installer_path);
            return Err(AppError::ValidationFailed(
                "Downloaded file is not a valid Windows executable".into(),
            ));
        }

        // Spawn installer passively
        #[cfg(windows)]
        {
            std::process::Command::new(&installer_path)
                .args(["/P", "/UPDATE"])
                .spawn()
                .map_err(|e| AppError::Other(format!("Failed to execute installer: {e}")))?;
        }

        Ok(())
    })
    .await
}

fn check_exist_app_update_blocking(_app: &AppHandle) -> AppResult<ExistAppUpdateInfo> {
    let app_version = env!("CARGO_PKG_VERSION");
    let client = reqwest::blocking::Client::builder()
        .user_agent("Exist-LoL-Manager")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let resp = client
        .get(EXIST_RELEASES_API)
        .send()
        .map_err(|e| AppError::Other(e.to_string()))?;

    if !resp.status().is_success() {
        return Ok(ExistAppUpdateInfo {
            current_version: app_version.to_string(),
            latest_version: app_version.to_string(),
            has_update: false,
            release_notes: None,
            asset_url: None,
            asset_name: None,
            asset_size: None,
            published_at: None,
        });
    }

    let release: GitHubRelease = resp.json().map_err(|e| AppError::Other(e.to_string()))?;
    let clean_remote = release.tag_name.trim_start_matches('v');
    let remote_semver =
        semver::Version::parse(clean_remote).unwrap_or_else(|_| semver::Version::new(0, 0, 0));
    let local_semver =
        semver::Version::parse(app_version).unwrap_or_else(|_| semver::Version::new(0, 0, 0));

    let has_update = remote_semver > local_semver;
    let asset = release.assets.as_ref().and_then(|assets| {
        assets
            .iter()
            .find(|a| a.name.ends_with(".exe") || a.name.ends_with(".msi"))
    });

    Ok(ExistAppUpdateInfo {
        current_version: app_version.to_string(),
        latest_version: release.tag_name,
        has_update,
        release_notes: release.body,
        asset_url: asset.map(|a| a.browser_download_url.clone()),
        asset_name: asset.map(|a| a.name.clone()),
        asset_size: asset.map(|a| a.size),
        published_at: release.published_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_comparison_filters_correctly() {
        let v1_27 = semver::Version::parse("1.27.0").unwrap();
        let v1_28 = semver::Version::parse("1.28.0").unwrap();
        assert!(v1_28 > v1_27);
        assert_eq!(v1_27, semver::Version::parse(CURRENT_LTK_VERSION).unwrap());
    }

    #[test]
    fn initial_state_has_expected_values() {
        let state = ExistSyncState::default();
        let status = state.status.read();
        assert_eq!(status.current_ltk_version, "1.27.0");
        assert_eq!(status.status, "idle");
        assert!(!status.has_upstream_update);
        assert!(!status.requires_manual_review);
    }
}
