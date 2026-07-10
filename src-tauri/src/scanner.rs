//! Paralel dizin tarama motoru. Secili kok dizin(ler) ve TUM alt klasorleri
//! taranir. Dosyalar okunur ama ASLA degistirilmez / kopyalanmaz / tasinmaz.

use crate::db::{Db, MediaItem};
use crate::metadata::{self, kind_from_ext, MediaKind};
use crate::thumbnails;

use chrono::{DateTime, Utc};
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

/// Frontend'e gonderilen ilerleme olayi.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String, // "walking" | "reading" | "thumbnails" | "done"
    pub processed: usize,
    pub total: usize,
    pub current: String,
}

fn emit(app: &AppHandle, p: ScanProgress) {
    let _ = app.emit("scan://progress", p);
}

/// Bir dosyayi indekslenebilir MediaItem'a cevir (metadata + temel dosya bilgisi).
fn build_item(path: &Path, root: &str, kind: MediaKind) -> Option<MediaItem> {
    let fs_meta = std::fs::metadata(path).ok()?;
    let size_bytes = fs_meta.len() as i64;

    let modified_at = fs_meta
        .modified()
        .ok()
        .and_then(|t| {
            let dt: DateTime<Utc> = t.into();
            Some(dt.format("%Y-%m-%dT%H:%M:%S").to_string())
        });

    let meta = metadata::extract(path, kind);

    // Tarih onceligi: cekim tarihi -> dosya degistirme tarihi
    let effective = meta.taken_at.clone().or(modified_at.clone());
    let (year, month) = parse_ym(effective.as_deref());

    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    Some(MediaItem {
        id: 0,
        path: path.to_string_lossy().to_string(),
        root: root.to_string(),
        file_name,
        ext,
        kind: kind.as_str().to_string(),
        size_bytes,
        modified_at,
        taken_at: meta.taken_at,
        year,
        month,
        gps_lat: meta.gps_lat,
        gps_lon: meta.gps_lon,
        camera_make: meta.camera_make,
        camera_model: meta.camera_model,
        width: meta.width.map(|w| w as i64),
        height: meta.height.map(|h| h as i64),
        duration_s: meta.duration_s,
        orientation: meta.orientation.map(|o| o as i64),
        thumb_path: None,
    })
}

fn parse_ym(dt: Option<&str>) -> (Option<i64>, Option<i64>) {
    let s = match dt {
        Some(s) => s,
        None => return (None, None),
    };
    // "YYYY-MM-DDTHH:MM:SS" veya "YYYY-MM-DD"
    if s.len() >= 7 {
        let y = s[0..4].parse::<i64>().ok();
        let m = s[5..7].parse::<i64>().ok();
        return (y, m);
    }
    (None, None)
}

/// Tam tarama: yurur, metadata okur, DB'ye yazar, thumbnail uretir. Olaylar yayar.
pub fn scan_roots(
    app: &AppHandle,
    db: Arc<Db>,
    cache_dir: PathBuf,
    roots: Vec<String>,
    make_thumbs: bool,
) -> anyhow::Result<usize> {
    // 1) Yururuk: tum medya dosyalarini topla
    emit(
        app,
        ScanProgress {
            phase: "walking".into(),
            processed: 0,
            total: 0,
            current: String::new(),
        },
    );

    let mut files: Vec<(PathBuf, String, MediaKind)> = Vec::new();
    for root in &roots {
        // Bu kokun eski kayitlarini temizle (yeniden tarama tutarliligi)
        let _ = db.clear_root(root);
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if let Some(kind) = kind_from_ext(ext) {
                    files.push((path.to_path_buf(), root.clone(), kind));
                }
            }
        }
    }

    let total = files.len();
    emit(
        app,
        ScanProgress {
            phase: "reading".into(),
            processed: 0,
            total,
            current: String::new(),
        },
    );

    // 2) Paralel metadata okuma. Parser thread-local olarak yeniden kullanilir.
    let processed = Arc::new(AtomicUsize::new(0));
    let app_arc = app.clone();

    let items: Vec<MediaItem> = files
        .par_iter()
        .filter_map(|(path, root, kind)| {
            let item = build_item(path, root, *kind);
            let n = processed.fetch_add(1, Ordering::Relaxed) + 1;
            // Her 25 dosyada bir ilerleme yay
            if n % 25 == 0 || n == total {
                emit(
                    &app_arc,
                    ScanProgress {
                        phase: "reading".into(),
                        processed: n,
                        total,
                        current: path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    },
                );
            }
            item
        })
        .collect();

    // 3) DB'ye toplu yaz (chunk'lar halinde transaction)
    for chunk in items.chunks(1000) {
        db.upsert_batch(chunk)?;
    }

    // 4) Thumbnail uretimi (paralel, opsiyonel)
    if make_thumbs {
        let tprocessed = Arc::new(AtomicUsize::new(0));
        let tcache = cache_dir.clone();
        let tapp = app.clone();
        let tdb = db.clone();
        let ttotal = items.len();

        items.par_iter().for_each(|it| {
            let kind = if it.kind == "video" {
                MediaKind::Video
            } else {
                MediaKind::Photo
            };
            let src = Path::new(&it.path);
            if let Some(thumb) = thumbnails::ensure_thumb(&tcache, src, kind) {
                let _ = tdb.set_thumb(&it.path, &thumb.to_string_lossy());
            }
            let n = tprocessed.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 20 == 0 || n == ttotal {
                emit(
                    &tapp,
                    ScanProgress {
                        phase: "thumbnails".into(),
                        processed: n,
                        total: ttotal,
                        current: it.file_name.clone(),
                    },
                );
            }
        });
    }

    emit(
        app,
        ScanProgress {
            phase: "done".into(),
            processed: total,
            total,
            current: String::new(),
        },
    );

    Ok(total)
}
