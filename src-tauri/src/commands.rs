//! Frontend'in cagirdigi Tauri komutlari.

use crate::db::{Db, MediaItem};
use crate::grouping::{
    apply_plan, build_merge_plan, build_plan, ApplyResult, GroupPlan, GroupRequest, MergeRequest,
};
use crate::query::{library_stats, query_media, Filter, LibraryStats};
use crate::scanner::scan_roots;
use crate::thumbnails::ffmpeg_available;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

/// Uygulama durumu (paylasimli).
pub struct AppState {
    pub db: Arc<Db>,
    pub cache_dir: PathBuf,
    /// Onaylanmadan once tutulan son plan (preview -> apply tutarliligi).
    pub last_plan: Mutex<Option<GroupPlan>>,
}

/// Secili dizinleri tara (alt klasorler dahil). Uzun surer; ilerleme olaylari yayar.
#[tauri::command]
pub async fn scan_directories(
    app: AppHandle,
    state: State<'_, AppState>,
    roots: Vec<String>,
    make_thumbs: Option<bool>,
) -> Result<usize, String> {
    let db = state.db.clone();
    let cache = state.cache_dir.clone();
    let mt = make_thumbs.unwrap_or(true);
    // Agir isi blocking thread'de yap; UI donmasin.
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan_roots(&app, db, cache, roots, mt)
    })
    .await
    .map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())
}

/// Filtreye gore medya listesi (uygulama ici — dosya sistemine dokunmaz).
#[tauri::command]
pub fn get_media(state: State<'_, AppState>, filter: Filter) -> Result<Vec<MediaItem>, String> {
    query_media(&state.db, &filter).map_err(|e| e.to_string())
}

/// Kutuphane ozet istatistikleri (facet'ler).
#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> Result<LibraryStats, String> {
    library_stats(&state.db).map_err(|e| e.to_string())
}

/// Gruplama/bolme plani uret (dry-run). Sonucu saklar.
#[tauri::command]
pub fn plan_group(state: State<'_, AppState>, req: GroupRequest) -> Result<GroupPlan, String> {
    let plan = build_plan(&state.db, &req).map_err(|e| e.to_string())?;
    *state.last_plan.lock().unwrap() = Some(plan.clone());
    Ok(plan)
}

/// Merge plani uret (dry-run, her zaman kopyalama). Sonucu saklar.
#[tauri::command]
pub fn plan_merge(state: State<'_, AppState>, req: MergeRequest) -> Result<GroupPlan, String> {
    let plan = build_merge_plan(&req).map_err(|e| e.to_string())?;
    *state.last_plan.lock().unwrap() = Some(plan.clone());
    Ok(plan)
}

/// Saklanan son plani uygula (kullanici onayindan sonra).
#[tauri::command]
pub fn apply_last_plan(state: State<'_, AppState>) -> Result<ApplyResult, String> {
    let plan = state
        .last_plan
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Uygulanacak plan yok. Once onizleme olusturun.".to_string())?;
    Ok(apply_plan(state.db.clone(), &plan))
}

/// ffmpeg kurulu mu? (video thumbnail/oynatma bilgisi)
#[tauri::command]
pub fn ffmpeg_status() -> bool {
    ffmpeg_available()
}

/// Uygulama kurulumu ve state olusturma.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let cache_dir = app.path().app_cache_dir()?.join("thumbs");
    std::fs::create_dir_all(&cache_dir)?;

    let db_path = data_dir.join("index.sqlite");
    let db = Arc::new(Db::open(&db_path)?);

    app.manage(AppState {
        db,
        cache_dir,
        last_plan: Mutex::new(None),
    });
    Ok(())
}
