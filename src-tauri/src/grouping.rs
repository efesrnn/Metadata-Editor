//! Gruplama / bolme / merge motoru.
//!
//! GUVENLIK KURALLARI (degistirilemez):
//!  * Metadata ASLA degistirilmez (yalniz dosya tasima/kopyalama yapilir).
//!  * MERGE her zaman KOPYALAR — orijinaller korunur, hicbir sey silinmez.
//!  * Isim cakismasinda ustune YAZILMAZ; " (1)", " (2)" eklenir.
//!  * Once dry-run plan uretilir; kullanici onaylamadan hicbir sey yapilmaz.
//!  * Islemler yalnizca kullanicinin sectigi kok/hedef dizinler icinde olur.

use crate::db::{Db, MediaItem};
use crate::query::{query_media, Filter};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Gruplama semasi.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GroupBy {
    Month,   // <hedef>/2023/2023-08/
    Year,    // <hedef>/2023/
    Type,    // <hedef>/Fotograflar/  ve  <hedef>/Videolar/
    Camera,  // <hedef>/<kamera modeli>/
    Location, // <hedef>/Konumlu/ ve <hedef>/Konumsuz/
    Event,   // zaman bosluguna gore kumeler: <hedef>/Etkinlik 01/ ...
}

/// Islem modu.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OpMode {
    Move,
    Copy,
}

/// Bir gruplama plani istegi.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRequest {
    pub filter: Filter,        // hangi ogeler (uygulama ici filtre)
    pub group_by: GroupBy,
    pub mode: OpMode,          // move | copy
    pub dest_base: String,     // hedef kok dizin (secili dizin icinde/altinda)
    /// Ek foto/video ayrimi: her grup icinde ayrica alt klasore boler.
    #[serde(default)]
    pub also_split_type: bool,
    /// Event kumeleme icin saat cinsinden bosluk esigi (varsayilan 12).
    #[serde(default)]
    pub event_gap_hours: Option<f64>,
    /// Klasor adlari icin dil ("tr" | "en"). Varsayilan "en".
    #[serde(default)]
    pub lang: Option<String>,
}

/// Tek bir planlanan islem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOp {
    pub src: String,
    pub dst: String,
    pub group: String,
}

/// Plan sonucu (dry-run).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPlan {
    pub mode: String,
    pub ops: Vec<PlannedOp>,
    pub group_counts: Vec<(String, usize)>,
    pub total: usize,
    pub warnings: Vec<String>,
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let t = cleaned.trim().trim_end_matches('.').trim();
    if t.is_empty() {
        "Bilinmeyen".to_string()
    } else {
        t.to_string()
    }
}

// Klasor adlari icin ay isimleri (numara + isim). UTF-8 diakritikler NTFS'te sorunsuz.
const MONTHS_EN: [&str; 12] = [
    "01 - January", "02 - February", "03 - March", "04 - April", "05 - May", "06 - June",
    "07 - July", "08 - August", "09 - September", "10 - October", "11 - November", "12 - December",
];
const MONTHS_TR: [&str; 12] = [
    "01 - Ocak", "02 - Şubat", "03 - Mart", "04 - Nisan", "05 - Mayıs", "06 - Haziran",
    "07 - Temmuz", "08 - Ağustos", "09 - Eylül", "10 - Ekim", "11 - Kasım", "12 - Aralık",
];

struct Labels {
    photos: &'static str,
    videos: &'static str,
    with_loc: &'static str,
    no_loc: &'static str,
    no_cam: &'static str,
    no_date: &'static str,
    months: &'static [&'static str; 12],
}

fn labels_for(lang: &str) -> Labels {
    if lang == "tr" {
        Labels {
            photos: "Fotoğraflar", videos: "Videolar",
            with_loc: "Konumlu", no_loc: "Konumsuz",
            no_cam: "Kamerasız", no_date: "Tarihsiz", months: &MONTHS_TR,
        }
    } else {
        Labels {
            photos: "Photos", videos: "Videos",
            with_loc: "With location", no_loc: "No location",
            no_cam: "No camera", no_date: "No date", months: &MONTHS_EN,
        }
    }
}

/// Bir oge icin grup klasor yolunu (dest_base'e gore) hesapla.
fn group_folder(it: &MediaItem, group_by: &GroupBy, l: &Labels) -> String {
    match group_by {
        GroupBy::Year => it
            .year
            .map(|y| y.to_string())
            .unwrap_or_else(|| l.no_date.into()),
        GroupBy::Month => match (it.year, it.month) {
            (Some(y), Some(m)) if (1..=12).contains(&m) => {
                format!("{}/{}", y, l.months[(m - 1) as usize])
            }
            _ => l.no_date.into(),
        },
        GroupBy::Type => {
            if it.kind == "video" { l.videos.into() } else { l.photos.into() }
        }
        GroupBy::Camera => it
            .camera_model
            .as_deref()
            .map(sanitize)
            .unwrap_or_else(|| l.no_cam.into()),
        GroupBy::Location => {
            if it.gps_lat.is_some() && it.gps_lon.is_some() { l.with_loc.into() } else { l.no_loc.into() }
        }
        GroupBy::Event => String::new(), // ayrica hesaplanir
    }
}

/// Event (zaman boslugu) kumeleme: ogeleri tarihe gore siralar, esik ustu
/// bosluklarda yeni kume acar.
fn event_labels(items: &[MediaItem], gap_hours: f64, event_word: &str) -> Vec<String> {
    // (index, timestamp) — tarihe gore sirala
    let mut idxs: Vec<usize> = (0..items.len()).collect();
    let ts = |it: &MediaItem| -> Option<i64> {
        let s = it.taken_at.as_deref().or(it.modified_at.as_deref())?;
        // "YYYY-MM-DDTHH:MM:SS" -> kaba epoch (chrono ile)
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
            .ok()
            .map(|d| d.and_utc().timestamp())
    };
    idxs.sort_by_key(|&i| ts(&items[i]).unwrap_or(i64::MAX));

    let gap = (gap_hours * 3600.0) as i64;
    let mut labels = vec![String::new(); items.len()];
    let mut cluster = 1usize;
    let mut last: Option<i64> = None;
    for &i in &idxs {
        let t = ts(&items[i]);
        if let (Some(prev), Some(cur)) = (last, t) {
            if cur - prev > gap {
                cluster += 1;
            }
        }
        if t.is_some() {
            last = t;
        }
        labels[i] = format!("{} {:02}", event_word, cluster);
    }
    labels
}

/// Cakismayan bir hedef yol uret (ustune yazma yok).
fn unique_dest(dir: &Path, file_name: &str, planned: &mut std::collections::HashSet<PathBuf>) -> PathBuf {
    let base = Path::new(file_name);
    let stem = base.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = base.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();

    let mut candidate = dir.join(file_name);
    let mut n = 1;
    while candidate.exists() || planned.contains(&candidate) {
        candidate = dir.join(format!("{} ({}){}", stem, n, ext));
        n += 1;
    }
    planned.insert(candidate.clone());
    candidate
}

/// Dry-run plan uret. Hicbir dosya sistemine dokunmaz.
pub fn build_plan(db: &Db, req: &GroupRequest) -> anyhow::Result<GroupPlan> {
    let items = query_media(db, &req.filter)?;
    let dest_base = PathBuf::from(&req.dest_base);
    let lang = req.lang.as_deref().unwrap_or("en");
    let l = labels_for(lang);
    let event_word = if lang == "tr" { "Etkinlik" } else { "Event" };
    let mut warnings = Vec::new();

    if items.is_empty() {
        warnings.push(
            if lang == "tr" { "Seçili filtreye uyan öğe yok." } else { "No items match the current filter." }.into(),
        );
    }

    let event_labels = if req.group_by == GroupBy::Event {
        event_labels(&items, req.event_gap_hours.unwrap_or(12.0), event_word)
    } else {
        Vec::new()
    };

    let mut planned: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut ops: Vec<PlannedOp> = Vec::new();
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

    for (i, it) in items.iter().enumerate() {
        let mut group = if req.group_by == GroupBy::Event {
            event_labels[i].clone()
        } else {
            group_folder(it, &req.group_by, &l)
        };

        // Ek foto/video ayrimi
        if req.also_split_type && req.group_by != GroupBy::Type {
            let sub = if it.kind == "video" { l.videos } else { l.photos };
            group = format!("{}/{}", group, sub);
        }

        let target_dir = dest_base.join(&group);
        let dst = unique_dest(&target_dir, &it.file_name, &mut planned);

        // Ayni yerdeyse atla (kaynak zaten hedefte)
        if Path::new(&it.path) == dst {
            continue;
        }

        *counts.entry(group.clone()).or_insert(0) += 1;
        ops.push(PlannedOp {
            src: it.path.clone(),
            dst: dst.to_string_lossy().to_string(),
            group,
        });
    }

    let total = ops.len();
    Ok(GroupPlan {
        mode: match req.mode {
            OpMode::Move => "move".into(),
            OpMode::Copy => "copy".into(),
        },
        ops,
        group_counts: counts.into_iter().collect(),
        total,
        warnings,
    })
}

/// Merge istegi: birden fazla kaynak dizini tek hedefe KOPYALAR.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub sources: Vec<String>, // birlestirilecek dizinler
    pub dest: String,         // yeni merge klasoru
    /// Merge sonrasi tekrar tarama icin true.
    #[serde(default)]
    pub flatten: bool,        // alt klasor yapisini koru (false) / duzlestir (true)
}

/// Merge plani — HER ZAMAN kopyalama, silme yok.
pub fn build_merge_plan(req: &MergeRequest) -> anyhow::Result<GroupPlan> {
    use crate::metadata::kind_from_ext;
    use walkdir::WalkDir;

    let dest = PathBuf::from(&req.dest);
    let mut planned: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut ops = Vec::new();
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut warnings = vec![
        "Merge always COPIES — your original files stay where they are; nothing is deleted.".to_string(),
    ];

    for src_root in &req.sources {
        let src_root_path = PathBuf::from(src_root);
        let label = src_root_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "kaynak".into());

        for entry in WalkDir::new(src_root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let is_media = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| kind_from_ext(e).is_some())
                .unwrap_or(false);
            if !is_media {
                continue;
            }
            let file_name = path.file_name().unwrap().to_string_lossy().to_string();

            let target_dir = if req.flatten {
                dest.clone()
            } else {
                // Kaynak icindeki goreli yapiyi koru: dest/<kaynakadi>/<goreli>
                let rel = path.strip_prefix(&src_root_path).unwrap_or(path);
                let rel_parent = rel.parent().map(|p| p.to_path_buf()).unwrap_or_default();
                dest.join(&label).join(rel_parent)
            };

            let dst = unique_dest(&target_dir, &file_name, &mut planned);
            *counts.entry(label.clone()).or_insert(0) += 1;
            ops.push(PlannedOp {
                src: path.to_string_lossy().to_string(),
                dst: dst.to_string_lossy().to_string(),
                group: label.clone(),
            });
        }
    }

    if PathBuf::from(&req.dest).exists() {
        // Sorun degil ama kullaniciya bildir
        warnings.push("Destination folder already exists; files will be added into it (no overwrite).".into());
    }

    let total = ops.len();
    Ok(GroupPlan {
        mode: "copy".into(),
        ops,
        group_counts: counts.into_iter().collect(),
        total,
        warnings,
    })
}

/// Bir plani uygula. move => tasi (DB yolu guncellenir), copy => kopyala.
/// Basari sayisini ve hatalari doner.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub succeeded: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

pub fn apply_plan(db: Arc<Db>, plan: &GroupPlan) -> ApplyResult {
    let is_move = plan.mode == "move";
    let mut succeeded = 0;
    let mut failed = 0;
    let mut errors = Vec::new();

    for op in &plan.ops {
        let dst = PathBuf::from(&op.dst);
        if let Some(parent) = dst.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                failed += 1;
                errors.push(format!("{}: klasor olusturulamadi ({})", op.dst, e));
                continue;
            }
        }

        // Guvenlik: hedef zaten varsa ATLA (asla ustune yazma)
        if dst.exists() {
            failed += 1;
            errors.push(format!("{}: hedef zaten var, atlandi", op.dst));
            continue;
        }

        let result = if is_move {
            // Once rename dene (ayni surucude hizli). Basarisizsa kopyala+sil.
            match std::fs::rename(&op.src, &dst) {
                Ok(_) => Ok(()),
                Err(_) => std::fs::copy(&op.src, &dst).and_then(|_| std::fs::remove_file(&op.src)),
            }
        } else {
            std::fs::copy(&op.src, &dst).map(|_| ())
        };

        match result {
            Ok(_) => {
                succeeded += 1;
                if is_move {
                    // DB'deki yolu guncelle (metadata degismez, sadece konum)
                    let new_root = dst
                        .parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let new_name = dst
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let _ = db.update_path(&op.src, &op.dst, &new_root, &new_name);
                }
            }
            Err(e) => {
                failed += 1;
                errors.push(format!("{} -> {}: {}", op.src, op.dst, e));
            }
        }
    }

    ApplyResult {
        succeeded,
        failed,
        errors: errors.into_iter().take(50).collect(),
    }
}
