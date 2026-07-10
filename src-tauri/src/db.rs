//! SQLite metadata index. Yalnizca metadata saklanir; medya dosyalari ASLA
//! kopyalanmaz. Bu veritabani uygulama veri klasorunde tutulur ve sadece
//! hizli filtreleme/siralama icin bir onbellek gorevi gorur.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// Grid'e/filtreye gonderilen medya kaydi.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: i64,
    pub path: String,
    pub root: String,
    pub file_name: String,
    pub ext: String,
    pub kind: String, // "photo" | "video"
    pub size_bytes: i64,
    pub modified_at: Option<String>,
    pub taken_at: Option<String>,
    pub year: Option<i64>,
    pub month: Option<i64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_s: Option<f64>,
    pub orientation: Option<i64>,
    pub thumb_path: Option<String>,
}

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        // Performans PRAGMA'lari
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA cache_size = -20000;
             PRAGMA foreign_keys = ON;",
        )?;
        let db = Db {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS media (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                path          TEXT NOT NULL UNIQUE,
                root          TEXT NOT NULL,
                file_name     TEXT NOT NULL,
                ext           TEXT NOT NULL,
                kind          TEXT NOT NULL,
                size_bytes    INTEGER NOT NULL,
                modified_at   TEXT,
                taken_at      TEXT,
                year          INTEGER,
                month         INTEGER,
                gps_lat       REAL,
                gps_lon       REAL,
                camera_make   TEXT,
                camera_model  TEXT,
                width         INTEGER,
                height        INTEGER,
                duration_s    REAL,
                orientation   INTEGER,
                thumb_path    TEXT,
                content_hash  TEXT,
                indexed_at    TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_media_kind    ON media(kind);
            CREATE INDEX IF NOT EXISTS idx_media_taken   ON media(taken_at);
            CREATE INDEX IF NOT EXISTS idx_media_ym      ON media(year, month);
            CREATE INDEX IF NOT EXISTS idx_media_root    ON media(root);
            CREATE INDEX IF NOT EXISTS idx_media_camera  ON media(camera_model);
            CREATE INDEX IF NOT EXISTS idx_media_gps     ON media(gps_lat, gps_lon);
            ",
        )?;
        Ok(())
    }

    /// Bir kok dizinin daha once indekslenmis kayitlarini temizle (yeniden tarama icin).
    pub fn clear_root(&self, root: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM media WHERE root = ?1", params![root])?;
        Ok(())
    }

    /// Toplu ekleme (transaction ile). Var olan path guncellenir.
    pub fn upsert_batch(&self, items: &[MediaItem]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO media
                    (path, root, file_name, ext, kind, size_bytes, modified_at,
                     taken_at, year, month, gps_lat, gps_lon, camera_make,
                     camera_model, width, height, duration_s, orientation, thumb_path)
                 VALUES
                    (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
                 ON CONFLICT(path) DO UPDATE SET
                    root=excluded.root, file_name=excluded.file_name, ext=excluded.ext,
                    kind=excluded.kind, size_bytes=excluded.size_bytes,
                    modified_at=excluded.modified_at, taken_at=excluded.taken_at,
                    year=excluded.year, month=excluded.month, gps_lat=excluded.gps_lat,
                    gps_lon=excluded.gps_lon, camera_make=excluded.camera_make,
                    camera_model=excluded.camera_model, width=excluded.width,
                    height=excluded.height, duration_s=excluded.duration_s,
                    orientation=excluded.orientation",
            )?;
            for it in items {
                stmt.execute(params![
                    it.path, it.root, it.file_name, it.ext, it.kind, it.size_bytes,
                    it.modified_at, it.taken_at, it.year, it.month, it.gps_lat,
                    it.gps_lon, it.camera_make, it.camera_model, it.width, it.height,
                    it.duration_s, it.orientation, it.thumb_path
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Bir kaydin thumbnail yolunu guncelle.
    pub fn set_thumb(&self, path: &str, thumb: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET thumb_path = ?2 WHERE path = ?1",
            params![path, thumb],
        )?;
        Ok(())
    }

    /// Bir dosyanin yeni yolunu yaz (tasima/merge sonrasi). Metadata degismez.
    pub fn update_path(&self, old: &str, new: &str, new_root: &str, new_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET path=?2, root=?3, file_name=?4 WHERE path=?1",
            params![old, new, new_root, new_name],
        )?;
        Ok(())
    }
}
