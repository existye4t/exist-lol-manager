//! Public RuneForge catalog commands.
//!
//! This module deliberately calls only the unauthenticated catalog endpoints
//! advertised by RuneForge. Release and artifact routes are intentionally out
//! of scope until RuneForge provides an anonymous, stable download API.

use super::off_thread;
use crate::error::{AppError, AppResult, IpcResult};
use crate::state::get_app_data_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use ts_rs::TS;
use url::Url;

const API_BASE: &str = "https://runeforge.dev/api";
const MAX_PAGE_SIZE: u8 = 24;
const MAX_SEARCH_LENGTH: usize = 120;

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgePublisher {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeChampion {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
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

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuneforgeCatalog {
    pub mods: Vec<RuneforgeMod>,
    pub total: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
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

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
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

    let response = public_client()?.get(url).send().map_err(|error| {
        AppError::Other(format!(
            "Could not reach the public RuneForge catalog: {error}"
        ))
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
    serde_json::from_str::<RuneforgeCatalog>(&body).map_err(|error| {
        AppError::Other(format!(
            "RuneForge returned malformed catalog data: {error}"
        ))
    })
}

fn load_champions() -> AppResult<RuneforgeChampions> {
    let response = public_client()?
        .get(format!("{API_BASE}/champions"))
        .send()
        .map_err(|error| {
            AppError::Other(format!(
                "Could not reach public RuneForge champions: {error}"
            ))
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
    serde_json::from_str::<RuneforgeChampions>(&body).map_err(|error| {
        AppError::Other(format!(
            "RuneForge returned malformed champion data: {error}"
        ))
    })
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
        .get(format!(
            "https://r2-images-prod.runeforge.dev/{thumbnail_key}"
        ))
        .send()
        .map_err(|error| {
            AppError::Other(format!("Could not reach public RuneForge artwork: {error}"))
        })?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response.bytes().map_err(|error| {
        AppError::Other(format!("Could not read public RuneForge artwork: {error}"))
    })?;
    if bytes.is_empty() {
        return Ok(None);
    }
    fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_adapter_serializes_correctly() {
        let catalog = r#"{
            "mods": [{
                "id": "123",
                "name": "Test Mod",
                "category": "skins",
                "status": "approved",
                "downloadCount": 100,
                "thumbnailKey": "abc123.png",
                "themes": ["dark"],
                "features": ["custom"],
                "champions": [{"id": 1, "name": "Ahri"}],
                "description": "A test mod",
                "publisher": {"id": "pub123", "username": "testuser"},
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
                "viewCount": 1000,
                "likeCount": 50,
                "isGilded": false,
                "publishedAt": "2024-01-01T00:00:00Z",
                "isTrending": false
            }],
            "total": 1
        }"#;
        let parsed: RuneforgeCatalog = serde_json::from_str(catalog).unwrap();
        assert_eq!(parsed.mods.len(), 1);
        assert_eq!(parsed.mods[0].id, "123");
        assert_eq!(parsed.mods[0].champions.len(), 1);
        assert_eq!(parsed.mods[0].champions[0].name, "Ahri");
    }
}
