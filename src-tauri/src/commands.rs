//! Frontend'in cagirdigi Tauri komutlari.

use crate::db::{Db, MediaItem};
use crate::grouping::{
    apply_plan, build_merge_plan, build_plan, ApplyResult, GroupPlan, GroupRequest, MergeRequest,
};
use crate::query::{library_stats, query_media, Filter, LibraryStats};
use crate::scanner::{reverse_geocode, scan_roots, ScanProgress, ThumbReady};
use crate::thumbnails::{self, ensure_thumb, ffmpeg_available, resolve_ffmpeg};
use crate::metadata::MediaKind;

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use chrono::{Datelike, Local, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOpResult {
    pub succeeded: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoPreview {
    pub id: String,
    pub root: String,
    pub label: String,
    pub files: Vec<String>,
}

fn sidecar_timestamp(path: &Path) -> Result<String, String> {
    let name = path.file_name().and_then(|v| v.to_str()).ok_or("Dosya adı okunamadı")?;
    let sidecar = path.with_file_name(format!("{name}.json"));
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&sidecar).map_err(|_| "Google JSON bulunamadı")?)
        .map_err(|_| "Google JSON okunamadı")?;
    let raw = value.pointer("/photoTakenTime/timestamp")
        .or_else(|| value.pointer("/creationTime/timestamp"))
        .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_i64().map(|n| n.to_string())))
        .ok_or("JSON içinde tarih bulunamadı")?;
    let seconds = raw.parse::<i64>().map_err(|_| "JSON tarihi geçersiz")?;
    let datetime = chrono::DateTime::<Utc>::from_timestamp(seconds, 0).ok_or("JSON tarihi geçersiz")?;
    Ok(datetime.with_timezone(&Local).format("%Y-%m-%dT%H:%M:%S").to_string())
}

fn created_today(path: &Path) -> bool {
    let time = std::fs::metadata(path).ok().and_then(|m| m.created().ok());
    time.map(|value| {
        let date: chrono::DateTime<Local> = value.into();
        let today = Local::now();
        date.year() == today.year() && date.ordinal() == today.ordinal()
    }).unwrap_or(false)
}

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
                if kind == MediaKind::Video {
                    if let Ok((width, height)) = image::image_dimensions(&thumb) {
                        let _ = db.set_rendered_orientation(path, width, height);
                    }
                }
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

#[tauri::command]
pub fn check_roots(roots: Vec<String>) -> Vec<String> {
    roots.into_iter().filter(|root| !Path::new(root).is_dir()).collect()
}

#[cfg(windows)]
fn write_file_clipboard(paths: &[String]) -> Result<(), String> {
    use std::{mem::size_of, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{GlobalFree, POINT},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::CF_HDROP,
        },
        UI::Shell::DROPFILES,
    };
    let mut names: Vec<u16> = Vec::new();
    for path in paths {
        names.extend(std::ffi::OsStr::new(path).encode_wide());
        names.push(0);
    }
    names.push(0);
    let bytes = size_of::<DROPFILES>() + names.len() * size_of::<u16>();
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if memory.is_null() { return Err("Pano belleği ayrılamadı.".into()); }
        let locked = GlobalLock(memory) as *mut u8;
        if locked.is_null() { GlobalFree(memory); return Err("Pano belleği açılamadı.".into()); }
        let header = DROPFILES { pFiles: size_of::<DROPFILES>() as u32, pt: POINT { x: 0, y: 0 }, fNC: 0, fWide: 1 };
        ptr::copy_nonoverlapping(&header as *const DROPFILES as *const u8, locked, size_of::<DROPFILES>());
        ptr::copy_nonoverlapping(names.as_ptr() as *const u8, locked.add(size_of::<DROPFILES>()), names.len() * 2);
        GlobalUnlock(memory);
        if OpenClipboard(ptr::null_mut()) == 0 { GlobalFree(memory); return Err("Windows panosu açılamadı.".into()); }
        EmptyClipboard();
        if SetClipboardData(CF_HDROP as u32, memory).is_null() {
            CloseClipboard(); GlobalFree(memory); return Err("Dosyalar panoya yazılamadı.".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[tauri::command]
pub fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)] { write_file_clipboard(&paths) }
    #[cfg(not(windows))] { let _ = paths; Err("Bu özellik yalnızca Windows'ta destekleniyor.".into()) }
}

#[tauri::command]
pub fn remove_roots(state: State<'_, AppState>, roots: Vec<String>, delete_thumbs: Option<bool>) -> Result<usize, String> {
    let thumbs = state.db.remove_roots(&roots).map_err(|e| e.to_string())?;
    if delete_thumbs.unwrap_or(true) {
        for thumb in thumbs { let _ = std::fs::remove_file(thumb); }
    }
    Ok(roots.len())
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
    let candidates: Vec<(String, String, String)> = plan.ops.iter()
        .filter(|op| !Path::new(&op.dst).exists())
        .filter_map(|op| state.db.root_for_path(&op.src).ok().flatten().map(|root| (op.src.clone(), op.dst.clone(), root)))
        .collect();
    let result = apply_plan(state.db.clone(), &plan);
    let mut by_root: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for (src, dst, root) in candidates {
        let completed = Path::new(&dst).exists() && (plan.mode != "move" || !Path::new(&src).exists());
        if completed {
            by_root.entry(root.clone()).or_default().push(serde_json::json!({
                "src": src, "dst": dst, "mode": plan.mode, "root": root
            }));
        }
    }
    for (root, entries) in by_root {
        let _ = state.db.push_undo(&root, "file_plan", "Gruplama / birleştirme", &serde_json::json!({ "entries": entries }));
    }
    Ok(result)
}

/// ffmpeg mevcut mu? (PATH + yaygin konumlar + indirilen kopya)
#[tauri::command]
pub fn ffmpeg_status(state: State<'_, AppState>) -> bool {
    ffmpeg_available(Some(&state.bin_dir))
}

#[tauri::command]
pub async fn set_media_location(
    state: State<'_, AppState>, path: String, root: String, kind: String, lat: f64, lon: f64,
    old_lat: Option<f64>, old_lon: Option<f64>, old_place: Option<String>, old_region: Option<String>, old_country: Option<String>,
) -> Result<(), String> {
    if !lat.is_finite() || !lon.is_finite() || !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("Geçersiz koordinat.".into());
    }
    let db = state.db.clone();
    let bin_dir = state.bin_dir.clone();
    let ff = resolve_ffmpeg(Some(&bin_dir));
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let file = Path::new(&path);
        if kind == "video" {
            let ffmpeg = match ff {
                Some(path) => path,
                None => thumbnails::download_ffmpeg(&bin_dir).map_err(|e| e.to_string())?,
            };
            crate::metadata::write_video_location(file, lat, lon, &ffmpeg).map_err(|e| e.to_string())?;
        } else {
            crate::metadata::write_photo_location(file, lat, lon).map_err(|e| e.to_string())?;
        }
        let (place, region, country) = reverse_geocode(lat, lon);
        db.set_location(&path, lat, lon, place.as_deref(), region.as_deref(), country.as_deref()).map_err(|e| e.to_string())?;
        let payload = serde_json::json!({ "entries": [{
            "path": path, "kind": kind, "old_lat": old_lat, "old_lon": old_lon,
            "old_place": old_place, "old_region": old_region, "old_country": old_country
        }] });
        db.push_undo(&root, "location", "Konum değişikliği", &payload).map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_video_details(
    state: State<'_, AppState>, path: String, root: String, old_file_name: String,
    old_taken_at: Option<String>, file_name: String, taken_at: String,
) -> Result<(), String> {
    chrono::NaiveDateTime::parse_from_str(&taken_at, "%Y-%m-%dT%H:%M:%S")
        .map_err(|_| "Geçersiz tarih/saat.".to_string())?;
    let clean_name = file_name.trim();
    if clean_name.is_empty() || clean_name.contains(['/', '\\']) || clean_name.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err("Geçersiz dosya adı.".into());
    }
    let source = PathBuf::from(&path);
    let parent = source.parent().ok_or_else(|| "Dosya klasörü bulunamadı.".to_string())?;
    let original_ext = source.extension().and_then(|v| v.to_str()).unwrap_or("");
    let final_name = if Path::new(clean_name).extension().is_some() || original_ext.is_empty() {
        clean_name.to_string()
    } else {
        format!("{clean_name}.{original_ext}")
    };
    let target = parent.join(&final_name);
    if target != source && target.exists() { return Err("Bu isimde bir dosya zaten var.".into()); }
    let db = state.db.clone();
    let bin_dir = state.bin_dir.clone();
    let stored_date = taken_at.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let ffmpeg = resolve_ffmpeg(Some(&bin_dir))
            .or_else(|| thumbnails::download_ffmpeg(&bin_dir).ok())
            .ok_or_else(|| "Video desteği hazırlanamadı.".to_string())?;
        crate::metadata::write_video_datetime(&source, &stored_date, &ffmpeg).map_err(|e| e.to_string())?;
        if target != source { std::fs::rename(&source, &target).map_err(|e| e.to_string())?; }
        db.update_video_details(&path, &target.to_string_lossy(), &final_name, &stored_date).map_err(|e| e.to_string())?;
        let payload = serde_json::json!({ "entries": [{
            "old_path": path, "new_path": target, "old_file_name": old_file_name,
            "new_file_name": final_name, "old_taken_at": old_taken_at
        }] });
        db.push_undo(&root, "video_details", "Video bilgisi değişikliği", &payload).map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_takeout_metadata(state: State<'_, AppState>, items: Vec<MediaItem>) -> Result<FileOpResult, String> {
    let db = state.db.clone();
    let bin_dir = state.bin_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = FileOpResult { succeeded: 0, skipped: 0, errors: Vec::new() };
        let mut ffmpeg: Option<PathBuf> = None;
        let mut undo_by_root: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        for item in items {
            let path = Path::new(&item.path);
            if !created_today(path) { result.skipped += 1; continue; }
            let datetime = match sidecar_timestamp(path) {
                Ok(value) => value,
                Err(_) => { result.skipped += 1; continue; }
            };
            let write = if item.kind == "video" {
                if ffmpeg.is_none() {
                    ffmpeg = resolve_ffmpeg(Some(&bin_dir)).or_else(|| thumbnails::download_ffmpeg(&bin_dir).ok());
                }
                match ffmpeg.as_deref() {
                    Some(ff) => crate::metadata::write_video_datetime(path, &datetime, ff),
                    None => Err(anyhow::anyhow!("FFmpeg hazırlanamadı")),
                }
            } else {
                crate::metadata::write_photo_datetime(path, &datetime)
            };
            match write.and_then(|_| db.update_taken_at(&item.path, &datetime)) {
                Ok(_) => {
                    undo_by_root.entry(item.root.clone()).or_default().push(serde_json::json!({
                        "path": item.path, "kind": item.kind, "file_name": item.file_name, "old_taken_at": item.taken_at
                    }));
                    result.succeeded += 1;
                }
                Err(error) => result.errors.push(format!("{}: {error}", item.file_name)),
            }
        }
        for (root, entries) in undo_by_root {
            let _ = db.push_undo(&root, "metadata_date", "Google Takeout metadata", &serde_json::json!({ "entries": entries }));
        }
        result
    }).await.map_err(|e| e.to_string())
}

fn unique_trash_path(trash: &Path, file_name: &str) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original.file_stem().and_then(|v| v.to_str()).unwrap_or("media");
    let ext = original.extension().and_then(|v| v.to_str());
    let mut candidate = trash.join(file_name);
    let mut index = 1;
    while candidate.exists() || candidate.with_file_name(format!("{}.json", candidate.file_name().unwrap().to_string_lossy())).exists() {
        let name = match ext { Some(ext) => format!("{stem} ({index}).{ext}"), None => format!("{stem} ({index})") };
        candidate = trash.join(name); index += 1;
    }
    candidate
}

#[tauri::command]
pub async fn move_to_trash(state: State<'_, AppState>, items: Vec<MediaItem>) -> Result<FileOpResult, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = FileOpResult { succeeded: 0, skipped: 0, errors: Vec::new() };
        let mut undo_by_root: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        for item in items {
            let source = PathBuf::from(&item.path);
            if !source.exists() { result.skipped += 1; continue; }
            let trash = Path::new(&item.root).join("Trash");
            if let Err(error) = std::fs::create_dir_all(&trash) { result.errors.push(format!("{}: {error}", item.file_name)); continue; }
            let destination = unique_trash_path(&trash, &item.file_name);
            let destination_name = destination.file_name().unwrap().to_string_lossy().to_string();
            let record = destination.with_file_name(format!("{destination_name}.json"));
            let original_directory = source.parent().unwrap_or(Path::new(&item.root)).to_string_lossy().to_string();
            let record_data = serde_json::json!({ "original_directory": original_directory });
            if let Err(error) = std::fs::rename(&source, &destination) { result.errors.push(format!("{}: {error}", item.file_name)); continue; }
            let original_sidecar = source.with_file_name(format!("{}.json", item.file_name));
            let takeout_sidecar = destination.with_file_name(format!("{destination_name}.takeout.json"));
            if original_sidecar.exists() { let _ = std::fs::rename(&original_sidecar, &takeout_sidecar); }
            if let Err(error) = std::fs::write(&record, serde_json::to_vec_pretty(&record_data).unwrap()) {
                let _ = std::fs::rename(&destination, &source);
                if takeout_sidecar.exists() { let _ = std::fs::rename(&takeout_sidecar, &original_sidecar); }
                result.errors.push(format!("{}: {error}", item.file_name)); continue;
            }
            match db.remove_paths(&[item.path.clone()]) {
                Ok(_) => {
                    undo_by_root.entry(item.root.clone()).or_default().push(serde_json::json!({
                        "file_name": destination_name,
                        "original_path": source,
                        "trash_path": destination,
                        "record_path": record,
                        "original_sidecar": original_sidecar,
                        "takeout_sidecar": takeout_sidecar
                    }));
                    result.succeeded += 1;
                }
                Err(error) => {
                    let _ = std::fs::remove_file(&record);
                    let _ = std::fs::rename(&destination, &source);
                    if takeout_sidecar.exists() { let _ = std::fs::rename(&takeout_sidecar, &original_sidecar); }
                    result.errors.push(format!("{}: {error}", item.file_name));
                }
            }
        }
        for (root, entries) in undo_by_root {
            let _ = db.push_undo(&root, "trash", "Trash'e taşıma", &serde_json::json!({ "entries": entries }));
        }
        result
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_trash(state: State<'_, AppState>, roots: Vec<String>) -> Result<FileOpResult, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = FileOpResult { succeeded: 0, skipped: 0, errors: Vec::new() };
        for root in roots {
            let mut undo_entries = Vec::new();
            let trash = Path::new(&root).join("Trash");
            let entries = match std::fs::read_dir(&trash) { Ok(value) => value, Err(_) => continue };
            for entry in entries.flatten() {
                let record = entry.path();
                let record_name = record.file_name().and_then(|v| v.to_str()).unwrap_or("");
                if !record_name.ends_with(".json") || record_name.ends_with(".takeout.json") { continue; }
                let media_name = record_name.trim_end_matches(".json");
                let media = trash.join(media_name);
                if !media.is_file() { result.skipped += 1; continue; }
                let value: serde_json::Value = match serde_json::from_slice(&std::fs::read(&record).unwrap_or_default()) { Ok(v) => v, Err(_) => { result.skipped += 1; continue; } };
                let original_dir = match value.get("original_directory").and_then(|v| v.as_str()) { Some(v) => PathBuf::from(v), None => { result.skipped += 1; continue; } };
                let destination = original_dir.join(media_name);
                if destination.exists() { result.errors.push(format!("{}: hedefte aynı isimde dosya var", media_name)); continue; }
                if let Err(error) = std::fs::create_dir_all(&original_dir).and_then(|_| std::fs::rename(&media, &destination)) { result.errors.push(format!("{}: {error}", media_name)); continue; }
                let takeout = trash.join(format!("{media_name}.takeout.json"));
                if takeout.exists() { let _ = std::fs::rename(&takeout, original_dir.join(format!("{media_name}.json"))); }
                if std::fs::remove_file(&record).is_ok() {
                    undo_entries.push(serde_json::json!({
                        "file_name": media_name, "original_path": destination, "trash_path": media,
                        "record_path": record, "record_data": value,
                        "original_sidecar": original_dir.join(format!("{media_name}.json")),
                        "takeout_sidecar": takeout
                    }));
                    result.succeeded += 1;
                }
            }
            if !undo_entries.is_empty() {
                let _ = db.push_undo(&root, "restore_trash", "Trash geri yükleme", &serde_json::json!({ "entries": undo_entries }));
            }
        }
        result
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn peek_undo(state: State<'_, AppState>, roots: Vec<String>) -> Result<Option<UndoPreview>, String> {
    let Some((id, root, _kind, label, raw)) = state.db.latest_undo(&roots).map_err(|e| e.to_string())? else { return Ok(None) };
    let payload: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let files = payload.get("entries").and_then(|v| v.as_array()).into_iter().flatten().filter_map(|entry| {
        entry.get("file_name").or_else(|| entry.get("path")).or_else(|| entry.get("old_file_name")).or_else(|| entry.get("src")).or_else(|| entry.get("original_path"))
            .and_then(|v| v.as_str()).map(|s| Path::new(s).file_name().and_then(|v| v.to_str()).unwrap_or(s).to_string())
    }).collect();
    Ok(Some(UndoPreview { id, root, label, files }))
}

#[tauri::command]
pub async fn apply_undo(state: State<'_, AppState>, id: String) -> Result<FileOpResult, String> {
    let db = state.db.clone();
    let bin_dir = state.bin_dir.clone();
    let Some((stored_id, _root, kind, _label, raw)) = db.get_undo(&id).map_err(|e| e.to_string())? else { return Err("Geri alma kaydı bulunamadı.".into()) };
    apply_undo_payload(db, bin_dir, stored_id, kind, raw).await
}

async fn apply_undo_payload(db: Arc<Db>, bin_dir: PathBuf, id: String, kind: String, raw: String) -> Result<FileOpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let payload: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let entries = payload.get("entries").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let mut result = FileOpResult { succeeded: 0, skipped: 0, errors: Vec::new() };
        let mut ffmpeg: Option<PathBuf> = None;
        for entry in entries {
            let outcome: Result<(), String> = (|| {
                match kind.as_str() {
                    "trash" => {
                        let original = PathBuf::from(entry["original_path"].as_str().ok_or("Eski yol yok")?);
                        let trash = PathBuf::from(entry["trash_path"].as_str().ok_or("Trash yolu yok")?);
                        if original.exists() { return Err("Eski konumda aynı isimde dosya var".into()); }
                        std::fs::create_dir_all(original.parent().ok_or("Eski klasör yok")?).map_err(|e| e.to_string())?;
                        std::fs::rename(&trash, &original).map_err(|e| e.to_string())?;
                        if let (Some(takeout), Some(sidecar)) = (entry["takeout_sidecar"].as_str(), entry["original_sidecar"].as_str()) {
                            if Path::new(takeout).exists() { let _ = std::fs::rename(takeout, sidecar); }
                        }
                        if let Some(record) = entry["record_path"].as_str() { let _ = std::fs::remove_file(record); }
                    }
                    "restore_trash" => {
                        let original = PathBuf::from(entry["original_path"].as_str().ok_or("Geri yüklenen yol yok")?);
                        let trash = PathBuf::from(entry["trash_path"].as_str().ok_or("Trash yolu yok")?);
                        if trash.exists() { return Err("Trash içinde aynı isimde dosya var".into()); }
                        std::fs::create_dir_all(trash.parent().ok_or("Trash klasörü yok")?).map_err(|e| e.to_string())?;
                        std::fs::rename(&original, &trash).map_err(|e| e.to_string())?;
                        if let (Some(sidecar), Some(takeout)) = (entry["original_sidecar"].as_str(), entry["takeout_sidecar"].as_str()) {
                            if Path::new(sidecar).exists() { let _ = std::fs::rename(sidecar, takeout); }
                        }
                        let record = PathBuf::from(entry["record_path"].as_str().ok_or("Geri yükleme JSON yolu yok")?);
                        std::fs::write(record, serde_json::to_vec_pretty(&entry["record_data"]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                        db.remove_paths(&[original.to_string_lossy().to_string()]).map_err(|e| e.to_string())?;
                    }
                    "metadata_date" => {
                        let path = Path::new(entry["path"].as_str().ok_or("Dosya yolu yok")?);
                        let old = entry.get("old_taken_at").and_then(|v| v.as_str());
                        if entry["kind"].as_str() == Some("video") {
                            if ffmpeg.is_none() { ffmpeg = resolve_ffmpeg(Some(&bin_dir)); }
                            let ff = ffmpeg.as_deref().ok_or("FFmpeg bulunamadı")?;
                            if let Some(value) = old { crate::metadata::write_video_datetime(path, value, ff) } else { crate::metadata::clear_video_datetime(path, ff) }.map_err(|e| e.to_string())?;
                        } else { crate::metadata::restore_photo_datetime(path, old).map_err(|e| e.to_string())?; }
                        db.restore_taken_at(&path.to_string_lossy(), old).map_err(|e| e.to_string())?;
                    }
                    "location" => {
                        let path = Path::new(entry["path"].as_str().ok_or("Dosya yolu yok")?);
                        let lat = entry.get("old_lat").and_then(|v| v.as_f64());
                        let lon = entry.get("old_lon").and_then(|v| v.as_f64());
                        if entry["kind"].as_str() == Some("video") {
                            if ffmpeg.is_none() { ffmpeg = resolve_ffmpeg(Some(&bin_dir)); }
                            let ff = ffmpeg.as_deref().ok_or("FFmpeg bulunamadı")?;
                            if let (Some(lat),Some(lon))=(lat,lon) { crate::metadata::write_video_location(path,lat,lon,ff) } else { crate::metadata::clear_video_location(path,ff) }.map_err(|e| e.to_string())?;
                        } else { crate::metadata::restore_photo_location(path,lat,lon).map_err(|e| e.to_string())?; }
                        db.restore_location(&path.to_string_lossy(), lat, lon, entry["old_place"].as_str(), entry["old_region"].as_str(), entry["old_country"].as_str()).map_err(|e| e.to_string())?;
                    }
                    "video_details" => {
                        let current = PathBuf::from(entry["new_path"].as_str().ok_or("Yeni yol yok")?);
                        let old_path = PathBuf::from(entry["old_path"].as_str().ok_or("Eski yol yok")?);
                        let old_date = entry.get("old_taken_at").and_then(|v| v.as_str());
                        if ffmpeg.is_none() { ffmpeg = resolve_ffmpeg(Some(&bin_dir)); }
                        let ff = ffmpeg.as_deref().ok_or("FFmpeg bulunamadı")?;
                        if let Some(value)=old_date { crate::metadata::write_video_datetime(&current,value,ff) } else { crate::metadata::clear_video_datetime(&current,ff) }.map_err(|e| e.to_string())?;
                        if current != old_path { if old_path.exists() { return Err("Eski isimde dosya zaten var".into()); } std::fs::rename(&current,&old_path).map_err(|e| e.to_string())?; }
                        db.restore_video_identity(&current.to_string_lossy(), &old_path.to_string_lossy(), entry["old_file_name"].as_str().unwrap_or("video"), old_date).map_err(|e| e.to_string())?;
                    }
                    "file_plan" => {
                        let src = PathBuf::from(entry["src"].as_str().ok_or("Kaynak yol yok")?);
                        let dst = PathBuf::from(entry["dst"].as_str().ok_or("Hedef yol yok")?);
                        if entry["mode"].as_str() == Some("move") {
                            if src.exists() { return Err("Eski kaynak yolunda dosya var".into()); }
                            std::fs::create_dir_all(src.parent().ok_or("Kaynak klasör yok")?).map_err(|e| e.to_string())?;
                            std::fs::rename(&dst, &src).map_err(|e| e.to_string())?;
                            let root = entry["root"].as_str().unwrap_or("");
                            let name = src.file_name().and_then(|v| v.to_str()).unwrap_or("");
                            db.update_path(&dst.to_string_lossy(), &src.to_string_lossy(), root, name).map_err(|e| e.to_string())?;
                        } else {
                            std::fs::remove_file(&dst).map_err(|e| e.to_string())?;
                        }
                    }
                    _ => return Err("Bu işlem türü geri alınamıyor".into()),
                }
                Ok(())
            })();
            match outcome { Ok(_) => result.succeeded += 1, Err(error) => result.errors.push(error) }
        }
        if result.errors.is_empty() { db.delete_undo(&id).map_err(|e| e.to_string())?; }
        Ok(result)
    }).await.map_err(|e| e.to_string())?
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
