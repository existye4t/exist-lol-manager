use crate::commands::exist_skins::{get_all_update_status, update_skin_to_latest};
use crate::commands::off_thread;
use crate::error::{AppError, AppResult, IpcResult};
use crate::state::get_app_data_dir;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

const SKIN_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/existye4t/lol-skin-finder/main/public/data/skins.json";

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistSkinCatalogStatus {
    pub last_updated: Option<String>,
    pub source_version: Option<String>,
    pub skin_count: u32,
    pub is_updating: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExistMetadata {
    pub etag: Option<String>,
    pub source_version: Option<String>,
}

pub struct ExistSyncState {
    pub status: Mutex<ExistSkinCatalogStatus>,
    pub metadata: Mutex<ExistMetadata>,
}

impl Default for ExistSyncState {
    fn default() -> Self {
        Self {
            status: Mutex::new(ExistSkinCatalogStatus {
                last_updated: None,
                source_version: None,
                skin_count: 0,
                is_updating: false,
                error: None,
            }),
            metadata: Mutex::new(ExistMetadata {
                etag: None,
                source_version: None,
            }),
        }
    }
}

fn get_exist_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let data_dir = get_app_data_dir(app).ok_or_else(|| AppError::Other("No data dir".into()))?;
    let exist_dir = data_dir.join("exist");
    fs::create_dir_all(&exist_dir)?;
    Ok(exist_dir)
}

fn load_metadata(app: &tauri::AppHandle) -> ExistMetadata {
    let path = get_exist_dir(app).ok().map(|d| d.join("metadata.json"));
    if let Some(p) = path {
        if let Ok(content) = fs::read_to_string(p) {
            if let Ok(meta) = serde_json::from_str(&content) {
                return meta;
            }
        }
    }
    ExistMetadata {
        etag: None,
        source_version: None,
    }
}

fn save_metadata(app: &tauri::AppHandle, meta: &ExistMetadata) -> AppResult<()> {
    let path = get_exist_dir(app)?.join("metadata.json");
    let content = serde_json::to_string(meta).map_err(|e| AppError::Other(e.to_string()))?;
    fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
pub async fn sync_exist_skin_catalog(app: AppHandle) -> IpcResult<()> {
    off_thread(move || {
        let state = app.state::<ExistSyncState>();
        let mut status = state
            .status
            .lock()
            .map_err(|_| AppError::InternalState("Sync state lock failed".into()))?;
        if status.is_updating {
            return Ok(());
        }
        status.is_updating = true;
        drop(status);

        let result = perform_sync_blocking(&app, &state);

        let mut status = state
            .status
            .lock()
            .map_err(|_| AppError::InternalState("Sync state lock failed".into()))?;
        status.is_updating = false;
        match result {
            Ok(Some(count)) => {
                status.skin_count = count;
                status.last_updated = Some(chrono::Utc::now().to_rfc3339());
                let meta = state
                    .metadata
                    .lock()
                    .map_err(|_| AppError::InternalState("Sync metadata lock failed".into()))?;
                status.source_version = meta.source_version.clone();
                status.error = None;
            }
            Ok(None) => {
                status.last_updated = Some(chrono::Utc::now().to_rfc3339());
                let meta = state
                    .metadata
                    .lock()
                    .map_err(|_| AppError::InternalState("Sync metadata lock failed".into()))?;
                status.source_version = meta.source_version.clone();
                status.error = None;
            }
            Err(e) => {
                status.error = Some(e.to_string());
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_exist_catalog_status(app: AppHandle) -> IpcResult<ExistSkinCatalogStatus> {
    off_thread(move || {
        let state = app.state::<ExistSyncState>();
        let status = state
            .status
            .lock()
            .map_err(|_| AppError::InternalState("Sync state lock failed".into()))?;
        Ok(status.clone())
    })
    .await
}

fn perform_sync_blocking(app: &AppHandle, state: &ExistSyncState) -> AppResult<Option<u32>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let etag = {
        let meta = state
            .metadata
            .lock()
            .map_err(|_| AppError::InternalState("Sync metadata lock failed".into()))?;
        meta.etag.clone()
    };

    let mut builder = client.get(SKIN_CATALOG_URL);
    if let Some(etag) = etag {
        builder = builder.header("If-None-Match", etag);
    }

    let response = builder.send().map_err(|e| AppError::Other(e.to_string()))?;

    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Failed to fetch catalog: {}",
            response.status()
        )));
    }

    let etag = response
        .headers()
        .get("ETag")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());
    let body = response
        .text()
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Validate JSON structure
    let catalog: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| AppError::Other(e.to_string()))?;
    let version = catalog["version"].as_str().map(|s| s.to_string());
    let skin_count = catalog["skins"]
        .as_array()
        .map(|s| s.len() as u32)
        .unwrap_or(0);

    let exist_dir = get_exist_dir(app)?;

    let temp_path = exist_dir.join("skins.json.tmp");
    let final_path = exist_dir.join("skins.json");

    fs::write(&temp_path, &body).map_err(|e| AppError::Other(e.to_string()))?;
    fs::rename(temp_path, final_path).map_err(|e| AppError::Other(e.to_string()))?;

    let mut meta = state
        .metadata
        .lock()
        .map_err(|_| AppError::InternalState("Sync metadata lock failed".into()))?;
    meta.etag = etag;
    meta.source_version = version;
    save_metadata(app, &meta)?;

    // After successful catalog sync, check for .fantome file updates
    // This runs on the blocking thread, so we can call the update check functions directly
    let update_status = get_all_update_status(app)?;
    let updates_available: Vec<_> = update_status
        .into_iter()
        .filter(|u| u.update_available)
        .collect();

    if !updates_available.is_empty() {
        tracing::info!(
            "Found {} skins with available .fantome updates, triggering automatic updates",
            updates_available.len()
        );
        for update in updates_available {
            // Get settings and library for the update
            let settings_result = app.state::<crate::state::SettingsState>().config();
            let library = app.state::<crate::mods::ModLibraryState>().0.clone();

            if let Ok(settings) = settings_result {
                if let Err(e) = update_skin_to_latest(&app, &update.skin_id, &settings, &library) {
                    tracing::error!("Failed to auto-update skin {}: {}", update.skin_id, e);
                    // Continue with other updates even if one fails
                }
            }
        }
    }

    Ok(Some(skin_count))
}
