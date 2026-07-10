//! Frontend'in cagirdigi Tauri komutlari.

use crate::db::{Db, MediaItem};
use crate::grouping::{
    apply_plan, build_merge_plan, build_plan, ApplyResult, GroupPlan, GroupRequest, MergeRequest,
};
use crate::query::{library_stats, query_media, Filter, LibraryStats};
use crate::scanner::{scan_roots, ScanProgress, ThumbReady};
use crate::thumbnails::{self, ensure_thumb, ffmpeg_available, resolve_ffmpeg};
use crate::metadata::MediaKind;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Uygulama durumu (paylasimli).
pub struct AppState {
    pub db: Arc<Db>,
    pub cache_dir: PathBuf,
    /// Indirilen ffmpeg gibi ikili dosyalarin klasoru.
    pub bin_dir: PathBuf,
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
    let bin = state.bin_dir.clone();
    let mt = make_thumbs.unwrap_or(true);
    // Agir isi blocking thread'de yap; UI donmasin.
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan_roots(&app, db, cache, bin, roots, mt)
    })
    .await
    .map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())
}

/// Onizlemesi olmayan ogeler icin thumbnail uret (yeniden taramaya gerek yok).
/// Video kareleri icin cozumlenmis ffmpeg kullanilir. Ilerleme olayi yayar.
#[tauri::command]
pub async fn generate_thumbs(app: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let db = state.db.clone();
    let cache = state.cache_dir.clone();
    let bin = state.bin_dir.clone();

    let missing = db.items_missing_thumb().map_err(|e| e.to_string())?;
    let total = missing.len();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let ff = resolve_ffmpeg(Some(&bin));
        let done = AtomicUsize::new(0);
        let mut made = 0usize;
        for (path, kind_s) in &missing {
            let kind = if kind_s == "video" { MediaKind::Video } else { MediaKind::Photo };
            let src = Path::new(path);
            if let Some(thumb) = ensure_thumb(&cache, src, kind, ff.as_deref()) {
                let ts = thumb.to_string_lossy().to_string();
                let _ = db.set_thumb(path, &ts);
                let _ = app.emit("thumb://ready", ThumbReady { path: path.clone(), thumb: ts });
                made += 1;
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 10 == 0 || n == total {
                let _ = app.emit("scan://progress", ScanProgress {
                    phase: "thumbnails".into(),
                    processed: n,
                    total,
                    current: String::new(),
                });
            }
        }
        let _ = app.emit("scan://progress", ScanProgress {
            phase: "done".into(), processed: total, total, current: String::new(),
        });
        made
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
}

/// ffmpeg'i uygulamanin kendi klasorune indir (kullanici hicbir sey kurmaz).
#[tauri::command]
pub async fn download_ffmpeg(state: State<'_, AppState>) -> Result<String, String> {
    let bin = state.bin_dir.clone();
    let path = tauri::async_runtime::spawn_blocking(move || thumbnails::download_ffmpeg(&bin))
        .await
        .map_err(|e| e.to_string())??;
    Ok(path.to_string_lossy().to_string())
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

/// ffmpeg mevcut mu? (PATH + yaygin konumlar + indirilen kopya)
#[tauri::command]
pub fn ffmpeg_status(state: State<'_, AppState>) -> bool {
    ffmpeg_available(Some(&state.bin_dir))
}

/// Uygulama kurulumu ve state olusturma.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let cache_dir = app.path().app_cache_dir()?.join("thumbs");
    std::fs::create_dir_all(&cache_dir)?;
    let bin_dir = data_dir.join("bin");
    std::fs::create_dir_all(&bin_dir)?;

    let db_path = data_dir.join("index.sqlite");
    let db = Arc::new(Db::open(&db_path)?);

    app.manage(AppState {
        db,
        cache_dir,
        bin_dir,
        last_plan: Mutex::new(None),
    });
    Ok(())
}
