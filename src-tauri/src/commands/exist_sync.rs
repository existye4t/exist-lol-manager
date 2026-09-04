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

fn skin_catalog_url() -> String {
    std::env::var("EXIST_SKIN_CATALOG_URL").unwrap_or_else(|_| {
        "https://raw.githubusercontent.com/existye4t/lol-skin-finder/main/public/data/skins.json".to_string()
    })
}

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

    let mut builder = client.get(&skin_catalog_url());
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn test_catalog_reachable() {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("create client");

        let response = client.get(&skin_catalog_url()).send();

        match response {
            Ok(resp) => {
                assert!(resp.status().is_success(), "Catalog request should succeed");
                assert_eq!(resp.status(), reqwest::StatusCode::OK);

                let etag = resp.headers().get("ETag").and_then(|h| h.to_str().ok());
                println!("Catalog ETag: {:?}", etag);
                assert!(etag.is_some(), "Server should return ETag");

                let body = resp.text().expect("read body");
                let catalog: serde_json::Value =
                    serde_json::from_str(&body).expect("Catalog should be valid JSON");

                let version = catalog["version"].as_str();
                let updated_at = catalog["updatedAt"].as_str();
                let skin_count = catalog["skins"].as_array().map(|a| a.len()).unwrap_or(0);

                println!("Catalog version: {:?}", version);
                println!("Catalog updatedAt: {:?}", updated_at);
                println!("Skin count: {}", skin_count);

                assert!(version.is_some(), "Catalog should have version");
                assert!(updated_at.is_some(), "Catalog should have updatedAt");
                assert!(skin_count > 1000, "Should have many skins");
            }
            Err(e) => {
                println!(
                    "Network request failed (may be expected in test env): {}",
                    e
                );
            }
        }
    }

    #[test]
    fn test_etag_conditional_request() {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("create client");

        let first_response = client.get(&skin_catalog_url()).send();

        let first_resp = match first_response {
            Ok(resp) => resp,
            Err(e) => {
                println!("First request failed: {}", e);
                return;
            }
        };

        assert!(first_resp.status().is_success());
        let etag = first_resp
            .headers()
            .get("ETag")
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string());

        if let Some(etag) = etag {
            let second_response = client
                .get(&skin_catalog_url())
                .header("If-None-Match", &etag)
                .send();

            let second_resp = match second_response {
                Ok(resp) => resp,
                Err(e) => {
                    println!("Second request failed: {}", e);
                    return;
                }
            };

            if second_resp.status() == reqwest::StatusCode::NOT_MODIFIED {
                println!("ETag conditional request works - got 304 Not Modified");
                assert_eq!(second_resp.status(), reqwest::StatusCode::NOT_MODIFIED);
            } else if second_resp.status().is_success() {
                println!("Server returned full catalog (no 304 support or catalog changed between requests)");
                assert_eq!(second_resp.status(), reqwest::StatusCode::OK);
            } else {
                println!("Unexpected status: {}", second_resp.status());
            }
        } else {
            println!("No ETag in first response");
        }
    }

    #[test]
    fn test_catalog_json_structure() {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("create client");

        let response = client.get(&skin_catalog_url()).send();

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let body = resp.text().expect("read body");
                    let catalog: serde_json::Value =
                        serde_json::from_str(&body).expect("Catalog should be valid JSON");

                    assert!(catalog["version"].is_string(), "version should be string");
                    assert!(
                        catalog["updatedAt"].is_string(),
                        "updatedAt should be string"
                    );
                    assert!(catalog["skins"].is_array(), "skins should be array");

                    let skins = catalog["skins"].as_array().unwrap();
                    assert!(!skins.is_empty(), "skins array should not be empty");

                    let first_skin = &skins[0];
                    assert!(first_skin["id"].is_string(), "skin.id should be string");
                    assert!(
                        first_skin["skinNum"].is_u64(),
                        "skin.skinNum should be number"
                    );
                    assert!(first_skin["name"].is_string(), "skin.name should be string");
                    assert!(
                        first_skin["champion"].is_string(),
                        "skin.champion should be string"
                    );
                    assert!(
                        first_skin["nameEn"].is_string(),
                        "skin.nameEn should be string"
                    );
                    assert!(
                        first_skin["championEn"].is_string(),
                        "skin.championEn should be string"
                    );
                    assert!(
                        first_skin["championId"].is_string(),
                        "skin.championId should be string"
                    );
                    assert!(
                        first_skin["image"].is_string(),
                        "skin.image should be string"
                    );
                    assert!(
                        first_skin["imageFallback"].is_string(),
                        "skin.imageFallback should be string"
                    );

                    if let Some(parent) = first_skin["parentSkinId"].as_str() {
                        if !parent.is_empty() {
                            println!("Skin has parent: {}", parent);
                        }
                    }

                    let has_fantome_hash = first_skin["fantome_hash"].is_string();
                    let has_fantome_size = first_skin["fantome_size"].is_u64();

                    println!("First skin has fantome_hash: {}", has_fantome_hash);
                    println!("First skin has fantome_size: {}", has_fantome_size);
                }
            }
            Err(e) => {
                println!("Request failed: {}", e);
            }
        }
    }
}
