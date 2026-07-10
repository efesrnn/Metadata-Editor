//! Filtreleme ve siralama sorgu olusturucu. Filtreleme yalnizca UYGULAMA ICINDE
//! etkilidir — hicbir dosya sistemine dokunmaz.

use crate::db::{Db, MediaItem};
use anyhow::Result;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

/// Frontend'den gelen filtre parametreleri. Hepsi opsiyonel.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub text: Option<String>,        // dosya adi / kamera arama
    pub kind: Option<String>,        // "photo" | "video"
    pub date_from: Option<String>,   // "2023-01-01"
    pub date_to: Option<String>,     // "2023-12-31"
    pub year: Option<i64>,
    pub month: Option<i64>,
    pub camera: Option<String>,
    pub has_gps: Option<bool>,
    pub roots: Option<Vec<String>>,  // yalnizca bu koklerden
    // Lokasyon (kaba bounding box) — harita/lokasyon aramasi icin
    pub lat_min: Option<f64>,
    pub lat_max: Option<f64>,
    pub lon_min: Option<f64>,
    pub lon_max: Option<f64>,
    // Siralama
    pub sort_by: Option<String>,     // "taken_at" | "size_bytes" | "file_name" | "modified_at"
    pub sort_dir: Option<String>,    // "asc" | "desc"
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn sort_column(s: &Option<String>) -> &'static str {
    match s.as_deref() {
        Some("size_bytes") => "size_bytes",
        Some("file_name") => "file_name COLLATE NOCASE",
        Some("modified_at") => "modified_at",
        Some("camera_model") => "camera_model",
        // Cekim tarihi yoksa degistirme tarihine dus
        _ => "COALESCE(taken_at, modified_at)",
    }
}

fn sort_dir(s: &Option<String>) -> &'static str {
    match s.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    }
}

/// Filtreye gore medya listesini getir.
pub fn query_media(db: &Db, f: &Filter) -> Result<Vec<MediaItem>> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if let Some(kind) = &f.kind {
        where_clauses.push(format!("kind = ?{}", args.len() + 1));
        args.push(Value::Text(kind.clone()));
    }
    if let Some(text) = &f.text {
        if !text.trim().is_empty() {
            let like = format!("%{}%", text.trim());
            where_clauses.push(format!(
                "(file_name LIKE ?{0} OR camera_model LIKE ?{0} OR camera_make LIKE ?{0} OR path LIKE ?{0})",
                args.len() + 1
            ));
            args.push(Value::Text(like));
        }
    }
    if let Some(df) = &f.date_from {
        where_clauses.push(format!("COALESCE(taken_at, modified_at) >= ?{}", args.len() + 1));
        args.push(Value::Text(df.clone()));
    }
    if let Some(dt) = &f.date_to {
        // Gun sonuna kadar dahil et
        where_clauses.push(format!("COALESCE(taken_at, modified_at) <= ?{}", args.len() + 1));
        args.push(Value::Text(format!("{}T23:59:59", dt)));
    }
    if let Some(y) = f.year {
        where_clauses.push(format!("year = ?{}", args.len() + 1));
        args.push(Value::Integer(y));
    }
    if let Some(m) = f.month {
        where_clauses.push(format!("month = ?{}", args.len() + 1));
        args.push(Value::Integer(m));
    }
    if let Some(cam) = &f.camera {
        where_clauses.push(format!("camera_model = ?{}", args.len() + 1));
        args.push(Value::Text(cam.clone()));
    }
    if let Some(true) = f.has_gps {
        where_clauses.push("gps_lat IS NOT NULL AND gps_lon IS NOT NULL".to_string());
    }
    if let (Some(a), Some(b), Some(c), Some(d)) = (f.lat_min, f.lat_max, f.lon_min, f.lon_max) {
        where_clauses.push(format!(
            "gps_lat BETWEEN ?{} AND ?{} AND gps_lon BETWEEN ?{} AND ?{}",
            args.len() + 1, args.len() + 2, args.len() + 3, args.len() + 4
        ));
        args.push(Value::Real(a));
        args.push(Value::Real(b));
        args.push(Value::Real(c));
        args.push(Value::Real(d));
    }
    if let Some(roots) = &f.roots {
        if !roots.is_empty() {
            let placeholders: Vec<String> = roots
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", args.len() + 1 + i))
                .collect();
            where_clauses.push(format!("root IN ({})", placeholders.join(",")));
            for r in roots {
                args.push(Value::Text(r.clone()));
            }
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let limit = f.limit.unwrap_or(100_000).clamp(1, 500_000);
    let offset = f.offset.unwrap_or(0).max(0);

    let sql = format!(
        "SELECT id, path, root, file_name, ext, kind, size_bytes, modified_at,
                taken_at, year, month, gps_lat, gps_lon, camera_make, camera_model,
                width, height, duration_s, orientation, thumb_path
         FROM media {where_sql}
         ORDER BY {} {}
         LIMIT {limit} OFFSET {offset}",
        sort_column(&f.sort_by),
        sort_dir(&f.sort_dir),
    );

    let conn = db.conn.lock().unwrap();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        Ok(MediaItem {
            id: r.get(0)?,
            path: r.get(1)?,
            root: r.get(2)?,
            file_name: r.get(3)?,
            ext: r.get(4)?,
            kind: r.get(5)?,
            size_bytes: r.get(6)?,
            modified_at: r.get(7)?,
            taken_at: r.get(8)?,
            year: r.get(9)?,
            month: r.get(10)?,
            gps_lat: r.get(11)?,
            gps_lon: r.get(12)?,
            camera_make: r.get(13)?,
            camera_model: r.get(14)?,
            width: r.get(15)?,
            height: r.get(16)?,
            duration_s: r.get(17)?,
            orientation: r.get(18)?,
            thumb_path: r.get(19)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Kenar cubugu icin ozet istatistikler (facet'ler).
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: i64,
    pub photos: i64,
    pub videos: i64,
    pub with_gps: i64,
    pub cameras: Vec<String>,
    pub years: Vec<i64>,
    pub roots: Vec<String>,
}

pub fn library_stats(db: &Db) -> Result<LibraryStats> {
    let conn = db.conn.lock().unwrap();
    let mut s = LibraryStats::default();

    s.total = conn.query_row("SELECT COUNT(*) FROM media", [], |r| r.get(0))?;
    s.photos = conn.query_row("SELECT COUNT(*) FROM media WHERE kind='photo'", [], |r| r.get(0))?;
    s.videos = conn.query_row("SELECT COUNT(*) FROM media WHERE kind='video'", [], |r| r.get(0))?;
    s.with_gps = conn.query_row(
        "SELECT COUNT(*) FROM media WHERE gps_lat IS NOT NULL",
        [],
        |r| r.get(0),
    )?;

    {
        let mut stmt = conn.prepare(
            "SELECT camera_model FROM media WHERE camera_model IS NOT NULL AND camera_model <> ''
             GROUP BY camera_model ORDER BY COUNT(*) DESC LIMIT 50",
        )?;
        s.cameras = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .filter_map(|x| x.ok())
            .collect();
    }
    {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT year FROM media WHERE year IS NOT NULL ORDER BY year DESC",
        )?;
        s.years = stmt
            .query_map([], |r| r.get::<_, i64>(0))?
            .filter_map(|x| x.ok())
            .collect();
    }
    {
        let mut stmt = conn.prepare("SELECT DISTINCT root FROM media ORDER BY root")?;
        s.roots = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .filter_map(|x| x.ok())
            .collect();
    }
    Ok(s)
}
