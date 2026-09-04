use super::off_thread;
use crate::error::{AppError, AppResult, IpcResult};
use crate::mods::ModLibraryState;
use crate::patcher::PatcherState;
use crate::state::{get_app_data_dir, SettingsState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/existye4t/lol-skin-finder/main/public/data/skins.json";
const FANTOME_INDEX_URL: &str = "https://raw.githubusercontent.com/existye4t/lol-skin-finder/main/public/data/fantome-files.json";
const FANTOME_URL_PREFIX: &str =
    "https://raw.githubusercontent.com/existye4t/lol-skin-finder/main/public/fantome/";
const CHUNK_SIZE: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistSkin {
    pub id: String,
    pub skin_num: u32,
    pub name: String,
    pub champion: String,
    pub name_en: String,
    pub champion_en: String,
    pub champion_id: String,
    pub image: String,
    pub image_fallback: String,
    pub parent_skin_id: Option<String>,
    pub has_fantome: bool,
    /// SHA-256 hash of the .fantome file for version detection
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fantome_hash: Option<String>,
    /// File size of the .fantome file in bytes
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fantome_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistCatalog {
    pub version: String,
    pub updated_at: String,
    pub skins: Vec<ExistSkin>,
    pub from_cache: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinderCatalog {
    version: String,
    updated_at: String,
    skins: Vec<FinderSkin>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinderSkin {
    id: String,
    skin_num: u32,
    name: String,
    champion: String,
    name_en: String,
    champion_en: String,
    champion_id: String,
    image: String,
    #[serde(default)]
    image_fallback: String,
    #[serde(default)]
    parent_skin_id: Option<String>,
    #[serde(default)]
    fantome_hash: Option<String>,
    #[serde(default)]
    fantome_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistDownloadProgress {
    pub skin_id: String,
    pub state: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub retry: u8,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistInstall {
    pub skin_id: String,
    pub mod_id: String,
    pub cached_path: String,
}

/// The queue view is transient. Completed packages remain durable through the
/// installed-skin index rather than attempting to restore in-flight requests.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistDownloadTask {
    pub skin_id: String,
    pub state: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub error: Option<String>,
}

#[derive(Default)]
struct DownloadQueue {
    tasks: HashMap<String, ExistDownloadTask>,
    controls: HashMap<String, Arc<DownloadControl>>,
}

#[derive(Default)]
struct DownloadControl {
    paused: std::sync::atomic::AtomicBool,
    cancelled: std::sync::atomic::AtomicBool,
}

const MAX_CONCURRENT_DOWNLOADS: usize = 2;
static DOWNLOAD_QUEUE: OnceLock<Mutex<DownloadQueue>> = OnceLock::new();

fn queue() -> &'static Mutex<DownloadQueue> {
    DOWNLOAD_QUEUE.get_or_init(|| Mutex::new(DownloadQueue::default()))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExistSkin {
    pub skin_id: String,
    pub mod_id: String,
    pub cached_path: String,
    pub file_size: u64,
    pub downloaded_at: String,
    pub applied: bool,
}

/// Local metadata for a downloaded .fantome file, used for update detection
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FantomeFileMetadata {
    pub skin_id: String,
    pub cached_path: String,
    pub file_size: u64,
    pub sha256_hash: String,
    pub remote_hash: Option<String>,
    pub remote_size: Option<u64>,
    pub last_checked: Option<String>,
    pub last_updated: Option<String>,
}

#[tauri::command]
pub async fn get_exist_catalog(app: AppHandle) -> IpcResult<ExistCatalog> {
    off_thread(move || load_catalog(&app)).await
}

#[tauri::command]
pub async fn download_exist_skin(skin_id: String, app: AppHandle) -> IpcResult<ExistInstall> {
    let setup: AppResult<_> = (|| {
        let patcher = app.state::<PatcherState>();
        super::mods::reject_if_patcher_running(&patcher)?;
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>().0.clone();
        Ok((settings, library))
    })();

    let (settings, library) = match setup {
        Ok(value) => value,
        Err(error) => return IpcResult::from(Err::<ExistInstall, _>(error)),
    };

    off_thread(move || download_and_install(&app, &skin_id, &settings, &library)).await
}

#[tauri::command]
pub fn enqueue_exist_download(skin_id: String, app: AppHandle) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        if !skin_id.chars().all(|character| character.is_ascii_digit()) || skin_id.is_empty() {
            return Err(AppError::ValidationFailed("Invalid skin ID".into()));
        }
        let mut queue = queue()
            .lock()
            .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?;
        if queue.tasks.contains_key(&skin_id) {
            return Ok(());
        }
        queue
            .controls
            .insert(skin_id.clone(), Arc::new(DownloadControl::default()));
        queue.tasks.insert(
            skin_id.clone(),
            ExistDownloadTask {
                skin_id,
                state: "queued".into(),
                downloaded_bytes: 0,
                total_bytes: None,
                bytes_per_second: 0,
                eta_seconds: None,
                error: None,
            },
        );
        drop(queue);
        start_queued_downloads(&app);
        Ok(())
    })();
    result.into()
}

#[tauri::command]
pub fn get_exist_download_queue() -> IpcResult<Vec<ExistDownloadTask>> {
    let result: AppResult<Vec<ExistDownloadTask>> = (|| {
        Ok(queue()
            .lock()
            .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?
            .tasks
            .values()
            .cloned()
            .collect())
    })();
    result.into()
}

#[tauri::command]
pub fn pause_exist_download(skin_id: String, app: AppHandle) -> IpcResult<()> {
    set_download_control(&skin_id, &app, true, false).into()
}
#[tauri::command]
pub fn resume_exist_download(skin_id: String, app: AppHandle) -> IpcResult<()> {
    set_download_control(&skin_id, &app, false, false).into()
}
#[tauri::command]
pub fn cancel_exist_download(skin_id: String, app: AppHandle) -> IpcResult<()> {
    set_download_control(&skin_id, &app, false, true).into()
}

#[tauri::command]
pub fn retry_exist_download(skin_id: String, app: AppHandle) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        let mut queue = queue()
            .lock()
            .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?;
        let control = queue
            .controls
            .get(&skin_id)
            .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
        control
            .paused
            .store(false, std::sync::atomic::Ordering::Relaxed);
        control
            .cancelled
            .store(false, std::sync::atomic::Ordering::Relaxed);
        let task = queue
            .tasks
            .get_mut(&skin_id)
            .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
        if task.state != "failed" && task.state != "cancelled" {
            return Err(AppError::ValidationFailed(
                "Only failed or cancelled downloads can be retried".into(),
            ));
        }
        task.state = "queued".into();
        task.error = None;
        task.bytes_per_second = 0;
        task.eta_seconds = None;
        drop(queue);
        start_queued_downloads(&app);
        Ok(())
    })();
    result.into()
}

#[tauri::command]
pub fn remove_exist_download(skin_id: String) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        let mut queue = queue()
            .lock()
            .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?;
        let task = queue
            .tasks
            .get(&skin_id)
            .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
        if matches!(
            task.state.as_str(),
            "queued" | "downloading" | "pausing" | "paused" | "cancelling"
        ) {
            return Err(AppError::ValidationFailed(
                "Active downloads must be cancelled before removal".into(),
            ));
        }
        queue.tasks.remove(&skin_id);
        queue.controls.remove(&skin_id);
        Ok(())
    })();
    result.into()
}

fn set_download_control(
    skin_id: &str,
    app: &AppHandle,
    pause: bool,
    cancel: bool,
) -> AppResult<()> {
    let mut queue = queue()
        .lock()
        .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?;
    let control = queue
        .controls
        .get(skin_id)
        .cloned()
        .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
    let task = queue
        .tasks
        .get_mut(skin_id)
        .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
    if cancel {
        if !matches!(task.state.as_str(), "queued" | "downloading" | "paused") {
            return Err(AppError::ValidationFailed(
                "Download is already stopping".into(),
            ));
        }
        control
            .cancelled
            .store(true, std::sync::atomic::Ordering::Relaxed);
        task.state = if task.state == "downloading" {
            "cancelling".into()
        } else {
            "cancelled".into()
        };
    } else if pause {
        if task.state != "downloading" {
            return Err(AppError::ValidationFailed(
                "Only active downloads can be paused".into(),
            ));
        }
        control
            .paused
            .store(true, std::sync::atomic::Ordering::Relaxed);
        task.state = "pausing".into();
    } else {
        if task.state != "paused" {
            return Err(AppError::ValidationFailed(
                "Download is not ready to resume".into(),
            ));
        }
        control
            .paused
            .store(false, std::sync::atomic::Ordering::Relaxed);
        control
            .cancelled
            .store(false, std::sync::atomic::Ordering::Relaxed);
        task.state = "queued".into();
    }
    drop(queue);
    if !pause && !cancel {
        start_queued_downloads(app);
    }
    Ok(())
}

fn start_queued_downloads(app: &AppHandle) {
    let to_start: Vec<String> = {
        let mut queue = match queue().lock() {
            Ok(queue) => queue,
            Err(_) => return,
        };
        let active = queue
            .tasks
            .values()
            .filter(|task| {
                matches!(
                    task.state.as_str(),
                    "downloading" | "pausing" | "cancelling"
                )
            })
            .count();
        let available = MAX_CONCURRENT_DOWNLOADS.saturating_sub(active);
        let ids: Vec<_> = queue
            .tasks
            .values()
            .filter(|task| task.state == "queued")
            .take(available)
            .map(|task| task.skin_id.clone())
            .collect();
        for id in &ids {
            if let Some(task) = queue.tasks.get_mut(id) {
                task.state = "downloading".into();
            }
        }
        ids
    };
    for skin_id in to_start {
        let app = app.clone();
        std::thread::spawn(move || run_queued_download(&app, &skin_id));
    }
}

fn run_queued_download(app: &AppHandle, skin_id: &str) {
    let result: AppResult<()> = (|| {
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>().0.clone();
        let control = queue()
            .lock()
            .map_err(|_| AppError::InternalState("Download queue unavailable".into()))?
            .controls
            .get(skin_id)
            .cloned()
            .ok_or_else(|| AppError::ValidationFailed("Download not found".into()))?;
        download_and_install_controlled(app, skin_id, &settings, &library, &control).map(|_| ())
    })();
    let finished_task = if let Ok(mut queue) = queue().lock() {
        if let Some(task) = queue.tasks.get_mut(skin_id) {
            match result {
                Ok(()) => task.state = "completed".into(),
                Err(error) if error.to_string() == "download paused" => {
                    task.state = "paused".into()
                }
                Err(error) if error.to_string() == "download cancelled" => {
                    task.state = "cancelled".into()
                }
                Err(_) => {
                    task.state = "failed".into();
                    task.error = Some(
                        "Could not download this skin. Check your connection and try again.".into(),
                    );
                }
            }
        }
        queue.tasks.get(skin_id).cloned()
    } else {
        None
    };
    if let Some(task) = finished_task {
        emit_queue_state(app, &task);
    }
    start_queued_downloads(app);
}

#[tauri::command]
pub async fn get_installed_exist_skins(app: AppHandle) -> IpcResult<Vec<InstalledExistSkin>> {
    off_thread(move || installed_skins(&app)).await
}

#[tauri::command]
pub fn apply_exist_skin(skin_id: String, app: AppHandle) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>();
        let mut entries = installed_skins(&app)?;
        let position = entries
            .iter()
            .position(|entry| entry.skin_id == skin_id)
            .ok_or_else(|| AppError::ValidationFailed("This skin is not in the cache".into()))?;
        if !Path::new(&entries[position].cached_path).exists() {
            return Err(AppError::ValidationFailed(
                "The cached Fantome file is missing".into(),
            ));
        }

        // Identify the champion of the skin being applied
        let catalog = load_catalog(&app).ok();
        let target_champion = catalog.as_ref().and_then(|cat| {
            cat.skins
                .iter()
                .find(|s| s.id == skin_id)
                .map(|s| s.champion.clone())
        });

        // If another skin for the same champion was applied, disable that one.
        // Other champions' skins remain applied.
        if let Some(target_champ) = target_champion {
            for item in &mut entries {
                if item.applied && item.skin_id != skin_id {
                    let item_champ = catalog.as_ref().and_then(|cat| {
                        cat.skins
                            .iter()
                            .find(|s| s.id == item.skin_id)
                            .map(|s| s.champion.as_str())
                    });
                    if item_champ == Some(&target_champ) {
                        let _ = library.0.toggle_mod_enabled(&settings, &item.mod_id, false);
                        item.applied = false;
                    }
                }
            }
        }

        let mod_id = entries[position].mod_id.clone();
        library.0.toggle_mod_enabled(&settings, &mod_id, true)?;
        entries[position].applied = true;
        save_installed_skins(&app, &entries)?;
        library.0.announce_change();
        Ok(())
    })();
    result.into()
}

#[tauri::command]
pub fn unapply_exist_skin(skin_id: String, app: AppHandle) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>();
        let mut entries = installed_skins(&app)?;
        let position = entries
            .iter()
            .position(|entry| entry.skin_id == skin_id)
            .ok_or_else(|| AppError::ValidationFailed("This skin is not in the cache".into()))?;
        let entry = &mut entries[position];
        if entry.applied {
            // Try to toggle the mod in the library. If the mod no longer exists
            // (legacy skin from older version), just clear the applied flag locally.
            if let Err(e) = library
                .0
                .toggle_mod_enabled(&settings, &entry.mod_id, false)
            {
                if !matches!(e, AppError::ModNotFound(_)) {
                    return Err(e);
                }
                // Mod not found in library - legacy skin. Just clear applied flag locally.
            }
            entry.applied = false;
        }
        save_installed_skins(&app, &entries)?;
        library.0.announce_change();
        Ok(())
    })();
    result.into()
}

#[tauri::command]
pub fn delete_exist_skin(skin_id: String, app: AppHandle) -> IpcResult<()> {
    let result: AppResult<()> = (|| {
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>();
        let mut entries = installed_skins(&app)?;
        let position = entries
            .iter()
            .position(|entry| entry.skin_id == skin_id)
            .ok_or_else(|| AppError::ValidationFailed("This skin is not in the cache".into()))?;
        let entry = entries.remove(position);
        if entry.applied {
            // Try to toggle the mod in the library. If the mod no longer exists
            // (legacy skin from older version), just proceed without it.
            if let Err(e) = library
                .0
                .toggle_mod_enabled(&settings, &entry.mod_id, false)
            {
                if !matches!(e, AppError::ModNotFound(_)) {
                    return Err(e);
                }
            }
        }
        // Try to uninstall the mod from the library. If the mod no longer exists
        // (legacy skin from older version), just proceed without it.
        if let Err(e) = library.0.uninstall_mod_by_id(&settings, &entry.mod_id) {
            if !matches!(e, AppError::ModNotFound(_)) {
                return Err(e);
            }
        }
        if Path::new(&entry.cached_path).exists() {
            fs::remove_file(&entry.cached_path)?;
        }
        save_installed_skins(&app, &entries)?;
        library.0.announce_change();
        Ok(())
    })();
    result.into()
}

fn cache_root(app: &AppHandle) -> AppResult<PathBuf> {
    get_app_data_dir(app)
        .map(|path| path.join("exist"))
        .ok_or_else(|| AppError::Other("Could not determine the Exist cache directory".into()))
}

fn load_catalog(app: &AppHandle) -> AppResult<ExistCatalog> {
    let root = cache_root(app)?;
    fs::create_dir_all(&root)?;
    let catalog_path = root.join("skins.json");
    let fantome_path = root.join("fantome-files.json");

    let fetched = (|| -> AppResult<(String, String)> {
        let client = http_client()?;
        let catalog = client
            .get(CATALOG_URL)
            .send()
            .map_err(|e| AppError::Other(format!("Could not reach the Exist skin catalog: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("Could not load the Exist skin catalog: {e}")))?
            .text()
            .map_err(|e| AppError::Other(format!("Could not read the Exist skin catalog: {e}")))?;
        let fantomes = client
            .get(FANTOME_INDEX_URL)
            .send()
            .map_err(|e| AppError::Other(format!("Could not reach the Exist download index: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(format!("Could not load the Exist download index: {e}")))?
            .text()
            .map_err(|e| {
                AppError::Other(format!("Could not read the Exist download index: {e}"))
            })?;
        Ok((catalog, fantomes))
    })();

    let (catalog_json, fantome_json, from_cache) = match fetched {
        Ok((catalog, fantomes)) => {
            atomic_write(&catalog_path, catalog.as_bytes())?;
            atomic_write(&fantome_path, fantomes.as_bytes())?;
            (catalog, fantomes, false)
        }
        Err(_error) if catalog_path.exists() && fantome_path.exists() => (
            fs::read_to_string(&catalog_path)?,
            fs::read_to_string(&fantome_path)?,
            true,
        ),
        Err(error) => return Err(error),
    };

    parse_catalog(&catalog_json, &fantome_json, from_cache)
}

fn parse_catalog(
    catalog_json: &str,
    fantome_json: &str,
    from_cache: bool,
) -> AppResult<ExistCatalog> {
    let catalog: FinderCatalog = serde_json::from_str(catalog_json)?;
    let fantome_files: Vec<String> = serde_json::from_str(fantome_json)?;
    let available: HashSet<String> = fantome_files
        .into_iter()
        .map(|name| name.trim().trim_end_matches(".fantome").to_string())
        .collect();
    let skins = catalog
        .skins
        .into_iter()
        .map(|skin| ExistSkin {
            has_fantome: available.contains(&skin.id),
            id: skin.id,
            skin_num: skin.skin_num,
            name: skin.name,
            champion: skin.champion,
            name_en: skin.name_en,
            champion_en: skin.champion_en,
            champion_id: skin.champion_id,
            image: skin.image,
            image_fallback: skin.image_fallback,
            parent_skin_id: skin.parent_skin_id,
            fantome_hash: skin.fantome_hash,
            fantome_size: skin.fantome_size,
        })
        .collect();
    Ok(ExistCatalog {
        version: catalog.version,
        updated_at: catalog.updated_at,
        skins,
        from_cache,
    })
}

fn download_and_install(
    app: &AppHandle,
    skin_id: &str,
    settings: &ltk_manager_core::config::Config,
    library: &crate::mods::ModLibrary,
) -> AppResult<ExistInstall> {
    download_and_install_controlled(app, skin_id, settings, library, &DownloadControl::default())
}

fn download_and_install_controlled(
    app: &AppHandle,
    skin_id: &str,
    settings: &ltk_manager_core::config::Config,
    library: &crate::mods::ModLibrary,
    control: &DownloadControl,
) -> AppResult<ExistInstall> {
    if !skin_id.chars().all(|character| character.is_ascii_digit()) || skin_id.is_empty() {
        return Err(AppError::ValidationFailed("Invalid skin ID".into()));
    }
    let catalog = load_catalog(app)?;
    let skin_info = catalog
        .skins
        .iter()
        .find(|skin| skin.id == skin_id && skin.has_fantome)
        .ok_or_else(|| {
            AppError::ValidationFailed("This skin has no downloadable Fantome package".into())
        })?;

    let root = cache_root(app)?;
    let downloads = root.join("downloads");
    fs::create_dir_all(&downloads)?;
    let part_path = downloads.join(format!("{skin_id}.fantome.part"));
    let final_path = downloads.join(format!("{skin_id}.fantome"));

    if !final_path.exists() {
        download_with_resume(app, skin_id, &part_path, &final_path, control)?;
    }
    validate_fantome(&final_path)?;

    // Compute SHA-256 hash of the downloaded file
    let file_size = fs::metadata(&final_path)?.len();
    let sha256_hash = compute_sha256(&final_path)?;

    // Update fantome metadata
    let mut fantome_meta = load_fantome_metadata(app);
    fantome_meta.retain(|m| m.skin_id != skin_id);
    fantome_meta.push(FantomeFileMetadata {
        skin_id: skin_id.to_string(),
        cached_path: final_path.display().to_string(),
        file_size,
        sha256_hash: sha256_hash.clone(),
        remote_hash: skin_info.fantome_hash.clone(),
        remote_size: skin_info.fantome_size,
        last_checked: Some(chrono::Utc::now().to_rfc3339()),
        last_updated: Some(chrono::Utc::now().to_rfc3339()),
    });
    save_fantome_metadata(app, &fantome_meta)?;

    let installed =
        library.install_mod_from_package(settings, &final_path.display().to_string())?;
    library.toggle_mod_enabled(settings, &installed.id, false)?;
    library.announce_change();
    let mut entries = installed_skins(app)?;
    entries.retain(|entry| entry.skin_id != skin_id);
    entries.push(InstalledExistSkin {
        skin_id: skin_id.to_string(),
        mod_id: installed.id.clone(),
        cached_path: final_path.display().to_string(),
        file_size,
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        applied: false,
    });
    save_installed_skins(app, &entries)?;
    Ok(ExistInstall {
        skin_id: skin_id.to_string(),
        mod_id: installed.id,
        cached_path: final_path.display().to_string(),
    })
}

fn installed_skins(app: &AppHandle) -> AppResult<Vec<InstalledExistSkin>> {
    let path = cache_root(app)?.join("installed-skins.json");
    let entries: Vec<InstalledExistSkin> = fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    // Filter to only valid entries (cached file exists), but do NOT save back here.
    // Saving on every read causes data loss when called from multiple places.
    // Callers that modify the list (download, apply, unapply, delete) are responsible for saving.
    let valid: Vec<_> = entries
        .into_iter()
        .filter(|entry| Path::new(&entry.cached_path).is_file())
        .collect();
    Ok(valid)
}
fn save_installed_skins(app: &AppHandle, entries: &[InstalledExistSkin]) -> AppResult<()> {
    let path = cache_root(app)?.join("installed-skins.json");
    fs::create_dir_all(path.parent().unwrap())?;
    atomic_write(&path, &serde_json::to_vec_pretty(entries)?)
}

fn fantome_metadata_path(app: &AppHandle) -> AppResult<PathBuf> {
    cache_root(app).map(|p| p.join("fantome-metadata.json"))
}

fn load_fantome_metadata(app: &AppHandle) -> Vec<FantomeFileMetadata> {
    let path = fantome_metadata_path(app).ok();
    if let Some(p) = path {
        if let Ok(content) = fs::read_to_string(p) {
            if let Ok(meta) = serde_json::from_str(&content) {
                return meta;
            }
        }
    }
    Vec::new()
}

fn save_fantome_metadata(app: &AppHandle, entries: &[FantomeFileMetadata]) -> AppResult<()> {
    let path = fantome_metadata_path(app)?;
    fs::create_dir_all(path.parent().unwrap())?;
    atomic_write(&path, &serde_json::to_vec_pretty(entries)?)
}

fn compute_sha256(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = std::io::Read::read(&mut file, &mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn download_with_resume(
    app: &AppHandle,
    skin_id: &str,
    part_path: &Path,
    final_path: &Path,
    control: &DownloadControl,
) -> AppResult<()> {
    let existing = part_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let url = format!("{FANTOME_URL_PREFIX}{skin_id}.fantome");
    let client = http_client()?;
    let mut request = client.get(&url);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let mut response = request
        .send()
        .map_err(|e| AppError::Other(format!("Connection to the server was lost: {e}")))?;
    if response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing > 0 {
        validate_fantome(part_path)?;
        fs::rename(part_path, final_path)?;
        return Ok(());
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Download failed with status {}",
            response.status()
        )));
    }
    let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let start_at = if resumed { existing } else { 0 };
    if !resumed && existing > 0 {
        fs::remove_file(part_path)?;
    }
    let total = response.content_length().map(|size| size + start_at);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)?;
    let started = Instant::now();
    let mut downloaded = start_at;
    let mut last_update = Instant::now();
    let mut buffer = vec![0; CHUNK_SIZE];
    loop {
        if control.cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(AppError::Other("download cancelled".into()));
        }
        if control.paused.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(AppError::Other("download paused".into()));
        }
        let count = response.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])?;
        downloaded += count as u64;
        if last_update.elapsed() >= Duration::from_millis(125) {
            emit_progress(
                app,
                skin_id,
                "downloading",
                downloaded,
                total,
                start_at,
                started,
                None,
            );
            last_update = Instant::now();
        }
    }
    file.sync_all()?;
    emit_progress(
        app,
        skin_id,
        "verifying",
        downloaded,
        total,
        start_at,
        started,
        None,
    );
    validate_fantome(part_path)?;
    fs::rename(part_path, final_path)?;
    emit_progress(
        app,
        skin_id,
        "downloaded",
        downloaded,
        total,
        start_at,
        started,
        None,
    );
    Ok(())
}

fn validate_fantome(path: &Path) -> AppResult<()> {
    let mut file = File::open(path)?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    if magic != [0x50, 0x4b, 0x03, 0x04] {
        return Err(AppError::ValidationFailed(
            "The downloaded file is not a valid Fantome archive".into(),
        ));
    }
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    skin_id: &str,
    state: &str,
    downloaded: u64,
    total: Option<u64>,
    start_at: u64,
    started: Instant,
    message: Option<String>,
) {
    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    let bytes_per_second = ((downloaded.saturating_sub(start_at)) as f64 / elapsed) as u64;
    let eta_seconds = total.and_then(|value| {
        bytes_per_second
            .checked_sub(0)
            .filter(|speed| *speed > 0)
            .map(|speed| value.saturating_sub(downloaded) / speed)
    });
    if let Ok(mut queue) = queue().lock() {
        if let Some(task) = queue.tasks.get_mut(skin_id) {
            task.downloaded_bytes = downloaded;
            task.total_bytes = total;
            task.bytes_per_second = bytes_per_second;
            task.eta_seconds = eta_seconds;
            if state == "downloading" {
                task.state = state.to_string();
            }
        }
    }
    let _ = app.emit(
        "exist-download-progress",
        ExistDownloadProgress {
            skin_id: skin_id.to_string(),
            state: state.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            bytes_per_second,
            eta_seconds,
            retry: 0,
            message,
        },
    );
}

fn emit_queue_state(app: &AppHandle, task: &ExistDownloadTask) {
    let _ = app.emit(
        "exist-download-progress",
        ExistDownloadProgress {
            skin_id: task.skin_id.clone(),
            state: task.state.clone(),
            downloaded_bytes: task.downloaded_bytes,
            total_bytes: task.total_bytes,
            bytes_per_second: task.bytes_per_second,
            eta_seconds: task.eta_seconds,
            retry: 0,
            message: task.error.clone(),
        },
    );
}

fn http_client() -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| AppError::Other(format!("Could not create the download client: {error}")))
}

fn atomic_write(path: &Path, content: &[u8]) -> AppResult<()> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content)?;
    fs::rename(temporary, path)?;
    Ok(())
}

// Check if a downloaded skin has an update available
#[tauri::command]
pub async fn check_exist_skin_update(
    app: AppHandle,
    skin_id: String,
) -> IpcResult<Option<ExistSkinUpdateInfo>> {
    off_thread(move || check_skin_update(&app, &skin_id)).await
}

// Update a specific skin to the latest version
#[tauri::command]
pub async fn update_exist_skin(skin_id: String, app: AppHandle) -> IpcResult<ExistInstall> {
    let setup: AppResult<_> = (|| {
        let patcher = app.state::<PatcherState>();
        super::mods::reject_if_patcher_running(&patcher)?;
        let settings = app.state::<SettingsState>().config()?;
        let library = app.state::<ModLibraryState>().0.clone();
        Ok((settings, library))
    })();

    let (settings, library) = match setup {
        Ok(value) => value,
        Err(error) => return IpcResult::from(Err::<ExistInstall, _>(error)),
    };

    off_thread(move || update_skin_to_latest(&app, &skin_id, &settings, &library)).await
}

// Get update status for all installed skins
#[tauri::command]
pub async fn get_exist_skins_update_status(app: AppHandle) -> IpcResult<Vec<ExistSkinUpdateInfo>> {
    off_thread(move || get_all_update_status(&app)).await
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ExistSkinUpdateInfo {
    pub skin_id: String,
    pub local_hash: String,
    pub remote_hash: Option<String>,
    pub remote_size: Option<u64>,
    pub update_available: bool,
    pub local_size: u64,
    pub last_checked: Option<String>,
}

pub fn check_skin_update(app: &AppHandle, skin_id: &str) -> AppResult<Option<ExistSkinUpdateInfo>> {
    let catalog = load_catalog(app)?;
    let skin_info = catalog.skins.iter().find(|s| s.id == skin_id);
    if skin_info.is_none() || !skin_info.unwrap().has_fantome {
        return Ok(None);
    }
    let skin_info = skin_info.unwrap();

    let fantome_meta = load_fantome_metadata(app);
    let local_meta = fantome_meta.iter().find(|m| m.skin_id == skin_id);
    if local_meta.is_none() {
        return Ok(None);
    }
    let local_meta = local_meta.unwrap();

    let remote_hash = skin_info.fantome_hash.clone();
    let remote_size = skin_info.fantome_size;

    let update_available = remote_hash
        .as_ref()
        .map(|rh| rh != &local_meta.sha256_hash)
        .unwrap_or(false);

    Ok(Some(ExistSkinUpdateInfo {
        skin_id: skin_id.to_string(),
        local_hash: local_meta.sha256_hash.clone(),
        remote_hash,
        remote_size,
        update_available,
        local_size: local_meta.file_size,
        last_checked: local_meta.last_checked.clone(),
    }))
}

pub fn get_all_update_status(app: &AppHandle) -> AppResult<Vec<ExistSkinUpdateInfo>> {
    let catalog = load_catalog(app)?;
    let fantome_meta = load_fantome_metadata(app);
    let mut results = Vec::new();

    for meta in fantome_meta {
        let skin_info = catalog.skins.iter().find(|s| s.id == meta.skin_id);
        if skin_info.is_none() || !skin_info.unwrap().has_fantome {
            continue;
        }
        let skin_info = skin_info.unwrap();

        let remote_hash = skin_info.fantome_hash.clone();
        let remote_size = skin_info.fantome_size;

        let update_available = remote_hash
            .as_ref()
            .map(|rh| rh != &meta.sha256_hash)
            .unwrap_or(false);

        results.push(ExistSkinUpdateInfo {
            skin_id: meta.skin_id.clone(),
            local_hash: meta.sha256_hash.clone(),
            remote_hash,
            remote_size,
            update_available,
            local_size: meta.file_size,
            last_checked: meta.last_checked.clone(),
        });
    }

    Ok(results)
}

pub fn update_skin_to_latest(
    app: &AppHandle,
    skin_id: &str,
    settings: &ltk_manager_core::config::Config,
    library: &crate::mods::ModLibrary,
) -> AppResult<ExistInstall> {
    // Re-download the file
    let root = cache_root(app)?;
    let downloads = root.join("downloads");
    fs::create_dir_all(&downloads)?;
    let part_path = downloads.join(format!("{skin_id}.fantome.part"));
    let final_path = downloads.join(format!("{skin_id}.fantome"));

    // Remove existing file to force re-download
    if final_path.exists() {
        fs::remove_file(&final_path)?;
    }

    download_with_resume(
        app,
        skin_id,
        &part_path,
        &final_path,
        &DownloadControl::default(),
    )?;
    validate_fantome(&final_path)?;

    // Compute SHA-256 hash of the downloaded file
    let file_size = fs::metadata(&final_path)?.len();
    let sha256_hash = compute_sha256(&final_path)?;

    // Update fantome metadata
    let catalog = load_catalog(app)?;
    let skin_info = catalog
        .skins
        .iter()
        .find(|s| s.id == skin_id && s.has_fantome);
    let mut fantome_meta = load_fantome_metadata(app);
    fantome_meta.retain(|m| m.skin_id != skin_id);
    fantome_meta.push(FantomeFileMetadata {
        skin_id: skin_id.to_string(),
        cached_path: final_path.display().to_string(),
        file_size,
        sha256_hash: sha256_hash.clone(),
        remote_hash: skin_info.as_ref().and_then(|s| s.fantome_hash.clone()),
        remote_size: skin_info.as_ref().and_then(|s| s.fantome_size),
        last_checked: Some(chrono::Utc::now().to_rfc3339()),
        last_updated: Some(chrono::Utc::now().to_rfc3339()),
    });
    save_fantome_metadata(app, &fantome_meta)?;

    // Re-install the mod
    let installed =
        library.install_mod_from_package(settings, &final_path.display().to_string())?;
    library.toggle_mod_enabled(settings, &installed.id, false)?;
    library.announce_change();

    // Update installed skins
    let mut entries = installed_skins(app)?;
    entries.retain(|entry| entry.skin_id != skin_id);
    entries.push(InstalledExistSkin {
        skin_id: skin_id.to_string(),
        mod_id: installed.id.clone(),
        cached_path: final_path.display().to_string(),
        file_size,
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        applied: false,
    });
    save_installed_skins(app, &entries)?;

    Ok(ExistInstall {
        skin_id: skin_id.to_string(),
        mod_id: installed.id,
        cached_path: final_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_adapter_marks_only_indexed_fantomes_as_downloadable() {
        let catalog = r#"{
            "version": "16.17.1",
            "updatedAt": "2026-08-27T07:22:59.009Z",
            "skins": [{
                "id": "103", "skinNum": 3, "name": "Galactic Azir",
                "champion": "Azir", "nameEn": "Galactic Azir",
                "championEn": "Azir", "championId": "Azir",
                "image": "https://example.invalid/azir.jpg", "imageFallback": ""
            }]
        }"#;
        let parsed = parse_catalog(catalog, r#"["103.fantome"]"#, false).unwrap();
        assert_eq!(parsed.skins.len(), 1);
        assert!(parsed.skins[0].has_fantome);
        assert_eq!(parsed.skins[0].champion_id, "Azir");
    }
}
