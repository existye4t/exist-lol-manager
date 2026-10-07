//! Public RuneForge catalog commands.
//!
//! This module deliberately calls only the unauthenticated catalog endpoints
//! advertised by RuneForge. Release and artifact routes are intentionally out
//! of scope until RuneForge provides an anonymous, stable download API.

use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::{InstallOutcome, ModLibraryState};
use crate::patcher::PatcherState;
use crate::services::shared::off_thread;
use crate::state::{get_app_data_dir, SettingsState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use url::Url;

const API_BASE: &str = "https://runeforge.dev/api";
const MAX_PAGE_SIZE: u8 = 24;
const MAX_SEARCH_LENGTH: usize = 120;

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgePublisher {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeChampion {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeMod {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub publisher: Option<RuneforgePublisher>,
    pub description: String,
    pub thumbnail_key: Option<String>,
    pub category: Option<String>,
    pub view_count: u64,
    pub download_count: u64,
    pub like_count: u64,
    #[serde(default)]
    pub champions: Vec<RuneforgeChampion>,
    #[serde(default)]
    pub themes: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
    pub status: Option<String>,
    pub is_gilded: bool,
    pub published_at: Option<String>,
    pub is_trending: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeCatalog {
    pub mods: Vec<RuneforgeMod>,
    pub total: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeCatalogQuery {
    pub page: u32,
    pub page_size: u8,
    pub search: Option<String>,
    pub champion_id: Option<u32>,
    pub category: Option<String>,
    pub theme: Option<String>,
    pub feature: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeChampions {
    pub champions: Vec<RuneforgeChampion>,
}

#[tauri::command]
pub async fn get_runeforge_catalog(query: RuneforgeCatalogQuery) -> IpcResult<RuneforgeCatalog> {
    off_thread(move || load_catalog(query)).await
}

#[tauri::command]
pub async fn get_runeforge_champions() -> IpcResult<RuneforgeChampions> {
    off_thread(load_champions).await
}

/// Cache an image from RuneForge's published public image bucket. This keeps
/// the webview on Tauri's asset protocol and never requests mod releases.
#[tauri::command]
pub async fn get_runeforge_thumbnail(
    thumbnail_key: String,
    app: tauri::AppHandle,
) -> IpcResult<Option<String>> {
    off_thread(move || cache_thumbnail(&app, &thumbnail_key)).await
}

fn public_client() -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Exist-Skin-Manager/1.0 (public RuneForge catalog)")
        .build()
        .map_err(|error| AppError::Other(format!("Could not create RuneForge client: {error}")))
}

fn load_catalog(query: RuneforgeCatalogQuery) -> AppResult<RuneforgeCatalog> {
    if query.page_size == 0 || query.page_size > MAX_PAGE_SIZE {
        return Err(AppError::ValidationFailed(
            "RuneForge page size is invalid".into(),
        ));
    }
    if query
        .search
        .as_ref()
        .is_some_and(|value| value.chars().count() > MAX_SEARCH_LENGTH)
    {
        return Err(AppError::ValidationFailed(
            "RuneForge search is too long".into(),
        ));
    }

    let mut url = Url::parse(&format!("{API_BASE}/mods"))
        .map_err(|error| AppError::Other(format!("Invalid RuneForge catalog URL: {error}")))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", &query.page.to_string());
        pairs.append_pair("pageSize", &query.page_size.to_string());
        pairs.append_pair("sortBy", "recently_updated");
        if let Some(search) = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            pairs.append_pair("search", search);
        }
        if let Some(champion_id) = query.champion_id {
            pairs.append_pair("champions[0]", &champion_id.to_string());
        }
        if let Some(category) = query
            .category
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            pairs.append_pair("categories[0]", category);
        }
        if let Some(theme) = query
            .theme
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            pairs.append_pair("themes[0]", theme);
        }
        if let Some(feature) = query
            .feature
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            pairs.append_pair("features[0]", feature);
        }
    }

    let response = public_client()?
        .get(url)
        .send()
        .map_err(|error| {
            AppError::Other(format!("Could not reach the public RuneForge catalog: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "RuneForge catalog returned {}",
            response.status()
        )));
    }
    let body = response
        .text()
        .map_err(|error| AppError::Other(format!("Could not read RuneForge catalog: {error}")))?;
    serde_json::from_str::<RuneforgeCatalog>(&body)
        .map_err(|error| AppError::Other(format!("RuneForge returned malformed catalog data: {error}")))
}

fn load_champions() -> AppResult<RuneforgeChampions> {
    let response = public_client()?
        .get(format!("{API_BASE}/champions"))
        .send()
        .map_err(|error| {
            AppError::Other(format!("Could not reach public RuneForge champions: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "RuneForge champions returned {}",
            response.status()
        )));
    }
    let body = response
        .text()
        .map_err(|error| AppError::Other(format!("Could not read RuneForge champions: {error}")))?;
    serde_json::from_str::<RuneforgeChampions>(&body)
        .map_err(|error| AppError::Other(format!("RuneForge returned malformed champion data: {error}")))
}

fn cache_thumbnail(app: &tauri::AppHandle, thumbnail_key: &str) -> AppResult<Option<String>> {
    if thumbnail_key.is_empty()
        || thumbnail_key.len() > 128
        || !thumbnail_key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err(AppError::ValidationFailed(
            "Invalid RuneForge thumbnail key".into(),
        ));
    }
    let _extension = PathBuf::from(thumbnail_key)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| matches!(*value, "png" | "jpg" | "jpeg" | "webp"))
        .ok_or_else(|| {
            AppError::ValidationFailed("Unsupported RuneForge thumbnail format".into())
        })?;
    let root = get_app_data_dir(app)
        .ok_or_else(|| AppError::Other("Could not locate app data directory".into()))?
        .join("runeforge")
        .join("thumbnails");
    fs::create_dir_all(&root)?;
    let path = root.join(format!("{thumbnail_key}"));
    if path.is_file() {
        return Ok(Some(path.to_string_lossy().to_string()));
    }
    let response = public_client()?
        .get(format!("https://r2-images-prod.runeforge.dev/{thumbnail_key}"))
        .send()
        .map_err(|error| {
            AppError::Other(format!("Could not reach public RuneForge artwork: {error}"))
        })?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response
        .bytes()
        .map_err(|error| AppError::Other(format!("Could not read public RuneForge artwork: {error}")))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn get_runeforge_download_url(mod_id: String) -> IpcResult<String> {
    off_thread(move || fetch_runeforge_asset_url(&mod_id)).await
}

#[tauri::command]
pub async fn install_runeforge_mod(
    mod_id: String,
    thumbnail_key: Option<String>,
    app: tauri::AppHandle,
) -> IpcResult<InstallOutcome> {
    off_thread(move || {
        download_and_install_runeforge_mod(&mod_id, thumbnail_key, &app)
    })
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeInstalledRecord {
    pub mod_id: String,
    pub installed_id: String,
    pub name: String,
    #[serde(default)]
    pub thumbnail_key: Option<String>,
    pub downloaded_at: String,
}

fn runeforge_records_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    get_app_data_dir(app).map(|p| p.join("runeforge").join("installed_mods.json"))
}

pub fn get_installed_runeforge_records(app: &tauri::AppHandle) -> Vec<RuneforgeInstalledRecord> {
    let Some(path) = runeforge_records_path(app) else {
        return Vec::new();
    };
    if !path.is_file() {
        return Vec::new();
    }
    fs_err::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn record_installed_runeforge_mod(
    app: &tauri::AppHandle,
    mod_id: &str,
    installed_id: &str,
    name: &str,
    thumbnail_key: Option<String>,
) -> AppResult<()> {
    let Some(path) = runeforge_records_path(app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        let _ = fs_err::create_dir_all(parent);
    }
    let mut records = get_installed_runeforge_records(app);
    records.retain(|r| r.mod_id != mod_id && r.installed_id != installed_id);
    records.push(RuneforgeInstalledRecord {
        mod_id: mod_id.to_string(),
        installed_id: installed_id.to_string(),
        name: name.to_string(),
        thumbnail_key,
        downloaded_at: chrono::Utc::now().to_rfc3339(),
    });
    let json = serde_json::to_string_pretty(&records)
        .map_err(|e| AppError::Other(format!("Failed to serialize records: {e}")))?;
    fs_err::write(path, json)?;
    Ok(())
}

#[tauri::command]
pub async fn get_installed_runeforge_ids(app: tauri::AppHandle) -> IpcResult<Vec<String>> {
    let mut ids = Vec::new();
    for record in get_installed_runeforge_records(&app) {
        ids.push(record.installed_id);
        ids.push(record.mod_id);
        ids.push(record.name);
    }
    IpcResult::ok(ids)
}

#[tauri::command]
pub async fn get_runeforge_installed_records(
    app: tauri::AppHandle,
) -> IpcResult<Vec<RuneforgeInstalledRecord>> {
    IpcResult::ok(get_installed_runeforge_records(&app))
}

pub fn fetch_runeforge_asset_url(mod_id: &str) -> AppResult<String> {
    if mod_id.is_empty()
        || mod_id.len() > 64
        || !mod_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::ValidationFailed("Invalid RuneForge mod ID".into()));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| AppError::Other(format!("Could not create HTTP client: {e}")))?;

    let page_url = format!("https://runeforge.dev/mods/{mod_id}");
    let response = client
        .get(&page_url)
        .send()
        .map_err(|e| AppError::Other(format!("Could not reach RuneForge mod page: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "RuneForge returned status {} for mod {mod_id}",
            response.status()
        )));
    }

    let html = response
        .text()
        .map_err(|e| AppError::Other(format!("Could not read RuneForge mod page HTML: {e}")))?;

    if let Some(pos) = html.find("https://r2-prod.runeforge.dev/mod_release_artifacts") {
        let remainder = &html[pos..];
        let end = remainder
            .find(['"', '\\', '\'', ' ', '\n', '\r', '<', '>'])
            .unwrap_or(remainder.len());
        let url = &remainder[..end];
        return Ok(url.to_string());
    }

    let re = regex::Regex::new(r#"assetUrl["\\:,\s]+(https://[^\s"\\'<]+)"#)
        .map_err(|e| AppError::Other(format!("Regex error: {e}")))?;
    if let Some(captures) = re.captures(&html) {
        if let Some(m) = captures.get(1) {
            return Ok(m.as_str().to_string());
        }
    }

    Err(AppError::Other(
        "No direct download package (.fantome / .modpkg) found for this RuneForge mod. The author may not have attached an asset archive.".into(),
    ))
}

pub fn download_and_install_runeforge_mod(
    mod_id: &str,
    thumbnail_key: Option<String>,
    app: &tauri::AppHandle,
) -> AppResult<InstallOutcome> {
    let asset_url = fetch_runeforge_asset_url(mod_id)?;

    tracing::info!("Downloading RuneForge mod {mod_id} from {asset_url}");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| AppError::Other(format!("Failed to build HTTP client: {e}")))?;

    let mut response = client
        .get(&asset_url)
        .send()
        .map_err(|e| AppError::Other(format!("Failed to download from RuneForge: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Download failed with status {}",
            response.status()
        )));
    }

    let temp_dir = std::env::temp_dir();
    let temp_file_name = format!("runeforge_{}_{}.fantome", mod_id, uuid::Uuid::new_v4());
    let temp_path = temp_dir.join(temp_file_name);

    let mut file = fs_err::File::create(&temp_path)?;
    response
        .copy_to(&mut file)
        .map_err(|e| AppError::Other(format!("Failed to write downloaded mod to disk: {e}")))?;

    let settings = app.state::<SettingsState>().config();
    let library = app.state::<ModLibraryState>();
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let install_result = library.0.install_mod_from_package(&settings, &temp_path_str);

    let _ = fs_err::remove_file(&temp_path);

    let outcome = install_result?;

    if let InstallOutcome::Installed(ref installed) | InstallOutcome::Updated(ref installed) = outcome {
        let mut tags = installed.tags.clone();
        if !tags.iter().any(|t| t.eq_ignore_ascii_case("runeforge")) {
            tags.push("runeforge".to_string());
        }

        let thumb_path = if let Some(ref tk) = thumbnail_key {
            cache_thumbnail(app, tk).ok().flatten()
        } else {
            None
        };

        let _ = library.0.edit_mod_metadata(
            &settings,
            &installed.id,
            ltk_manager_library::mods::EditModMetadataArgs {
                display_name: None,
                tags: Some(tags),
                champions: None,
                maps: None,
                set_thumbnail_path: thumb_path,
                remove_thumbnail: None,
            },
        );
        library.0.spawn_categorization(&settings, vec![installed.id.clone()]);
        library.0.spawn_health_check(&settings, vec![installed.id.clone()]);
        let _ = record_installed_runeforge_mod(app, mod_id, &installed.id, &installed.name, thumbnail_key);
    }

    library.0.announce_change();
    let _ = app.emit("library-changed", ());

    if let Some(patcher) = app.try_state::<PatcherState>() {
        patcher.refresh_overlay();
    }

    Ok(outcome)
}

