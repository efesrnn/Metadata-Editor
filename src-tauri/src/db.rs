//! SQLite metadata index. Yalnizca metadata saklanir; medya dosyalari ASLA
//! kopyalanmaz. Bu veritabani uygulama veri klasorunde tutulur ve sadece
//! hizli filtreleme/siralama icin bir onbellek gorevi gorur.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use uuid::Uuid;

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
    // Ters cografi kodlamadan (offline) gelen yer bilgisi
    pub place_name: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
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
                place_name    TEXT,
                region        TEXT,
                country       TEXT,
                content_hash  TEXT,
                indexed_at    TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_media_kind    ON media(kind);
            CREATE INDEX IF NOT EXISTS idx_media_taken   ON media(taken_at);
            CREATE INDEX IF NOT EXISTS idx_media_ym      ON media(year, month);
            CREATE INDEX IF NOT EXISTS idx_media_root    ON media(root);
            CREATE INDEX IF NOT EXISTS idx_media_camera  ON media(camera_model);
            CREATE INDEX IF NOT EXISTS idx_media_gps     ON media(gps_lat, gps_lon);
            CREATE TABLE IF NOT EXISTS undo_actions (
                id TEXT PRIMARY KEY,
                root TEXT NOT NULL,
                kind TEXT NOT NULL,
                label TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_undo_root_created ON undo_actions(root, created_at DESC);
            ",
        )?;
        // Eski veritabanlari icin gecis: kolon yoksa ekle (varsa hatayi yut).
        for col in ["place_name", "region", "country"] {
            let _ = conn.execute(&format!("ALTER TABLE media ADD COLUMN {} TEXT", col), []);
        }
        conn.execute_batch("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
        let thumb_version: Option<String> = conn.query_row(
            "SELECT value FROM app_meta WHERE key='thumb_version'", [], |row| row.get(0)
        ).ok();
        if thumb_version.as_deref() != Some("3") {
            conn.execute("UPDATE media SET thumb_path=NULL", [])?;
            conn.execute(
                "INSERT INTO app_meta(key,value) VALUES('thumb_version','3') ON CONFLICT(key) DO UPDATE SET value='3'", []
            )?;
        }
        Ok(())
    }

    /// Bir kok dizinin daha once indekslenmis kayitlarini temizle (yeniden tarama icin).
    pub fn clear_root(&self, root: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM media WHERE root = ?1", params![root])?;
        Ok(())
    }

    pub fn remove_roots(&self, roots: &[String]) -> Result<Vec<String>> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut thumbs = Vec::new();
        for root in roots {
            {
                let mut stmt = tx.prepare("SELECT thumb_path FROM media WHERE root=?1 AND thumb_path IS NOT NULL")?;
                let rows = stmt.query_map(params![root], |row| row.get::<_, String>(0))?;
                for row in rows { if let Ok(path) = row { thumbs.push(path); } }
            }
            tx.execute("DELETE FROM media WHERE root=?1", params![root])?;
        }
        tx.commit()?;
        Ok(thumbs)
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
                     camera_model, width, height, duration_s, orientation, thumb_path,
                     place_name, region, country)
                 VALUES
                    (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
                 ON CONFLICT(path) DO UPDATE SET
                    root=excluded.root, file_name=excluded.file_name, ext=excluded.ext,
                    kind=excluded.kind, size_bytes=excluded.size_bytes,
                    modified_at=excluded.modified_at, taken_at=excluded.taken_at,
                    year=excluded.year, month=excluded.month, gps_lat=excluded.gps_lat,
                    gps_lon=excluded.gps_lon, camera_make=excluded.camera_make,
                    camera_model=excluded.camera_model, width=excluded.width,
                    height=excluded.height, duration_s=excluded.duration_s,
                    orientation=excluded.orientation, place_name=excluded.place_name,
                    region=excluded.region, country=excluded.country",
            )?;
            for it in items {
                stmt.execute(params![
                    it.path, it.root, it.file_name, it.ext, it.kind, it.size_bytes,
                    it.modified_at, it.taken_at, it.year, it.month, it.gps_lat,
                    it.gps_lon, it.camera_make, it.camera_model, it.width, it.height,
                    it.duration_s, it.orientation, it.thumb_path,
                    it.place_name, it.region, it.country
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

    pub fn set_rendered_orientation(&self, path: &str, rendered_width: u32, rendered_height: u32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET orientation=CASE
                WHEN (width > height AND ?2 < ?3) OR (width < height AND ?2 > ?3) THEN 6
                ELSE NULL END
             WHERE path=?1",
            params![path, rendered_width, rendered_height],
        )?;
        Ok(())
    }

    pub fn set_location(&self, path: &str, lat: f64, lon: f64, place: Option<&str>, region: Option<&str>, country: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET gps_lat=?2, gps_lon=?3, place_name=?4, region=?5, country=?6 WHERE path=?1",
            params![path, lat, lon, place, region, country],
        )?;
        Ok(())
    }

    pub fn restore_location(&self, path: &str, lat: Option<f64>, lon: Option<f64>, place: Option<&str>, region: Option<&str>, country: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET gps_lat=?2, gps_lon=?3, place_name=?4, region=?5, country=?6 WHERE path=?1",
            params![path, lat, lon, place, region, country],
        )?;
        Ok(())
    }

    /// Onizlemesi (thumb) olmayan ogeleri getir: (path, kind).
    pub fn items_missing_thumb(&self) -> Result<Vec<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path, kind FROM media WHERE thumb_path IS NULL OR thumb_path = ''
             ORDER BY COALESCE(taken_at, modified_at) DESC",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
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

    pub fn update_video_details(&self, old_path: &str, new_path: &str, new_name: &str, taken_at: &str) -> Result<()> {
        let year = taken_at.get(0..4).and_then(|v| v.parse::<i64>().ok());
        let month = taken_at.get(5..7).and_then(|v| v.parse::<i64>().ok());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET path=?2, file_name=?3, taken_at=?4, year=?5, month=?6 WHERE path=?1",
            params![old_path, new_path, new_name, taken_at, year, month],
        )?;
        Ok(())
    }

    pub fn update_taken_at(&self, path: &str, taken_at: &str) -> Result<()> {
        let year = taken_at.get(0..4).and_then(|v| v.parse::<i64>().ok());
        let month = taken_at.get(5..7).and_then(|v| v.parse::<i64>().ok());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE media SET taken_at=?2, year=?3, month=?4 WHERE path=?1",
            params![path, taken_at, year, month],
        )?;
        Ok(())
    }

    pub fn restore_taken_at(&self, path: &str, taken_at: Option<&str>) -> Result<()> {
        let year = taken_at.and_then(|v| v.get(0..4)).and_then(|v| v.parse::<i64>().ok());
        let month = taken_at.and_then(|v| v.get(5..7)).and_then(|v| v.parse::<i64>().ok());
        self.conn.lock().unwrap().execute(
            "UPDATE media SET taken_at=?2, year=?3, month=?4 WHERE path=?1",
            params![path, taken_at, year, month],
        )?;
        Ok(())
    }

    pub fn restore_video_identity(&self, current_path: &str, old_path: &str, old_name: &str, taken_at: Option<&str>) -> Result<()> {
        let year = taken_at.and_then(|v| v.get(0..4)).and_then(|v| v.parse::<i64>().ok());
        let month = taken_at.and_then(|v| v.get(5..7)).and_then(|v| v.parse::<i64>().ok());
        self.conn.lock().unwrap().execute(
            "UPDATE media SET path=?2,file_name=?3,taken_at=?4,year=?5,month=?6 WHERE path=?1",
            params![current_path, old_path, old_name, taken_at, year, month],
        )?;
        Ok(())
    }

    pub fn remove_paths(&self, paths: &[String]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for path in paths { tx.execute("DELETE FROM media WHERE path=?1", params![path])?; }
        tx.commit()?;
        Ok(())
    }

    pub fn push_undo(&self, root: &str, kind: &str, label: &str, payload: &serde_json::Value) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO undo_actions(id,root,kind,label,payload,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, root, kind, label, payload.to_string(), now],
        )?;
        conn.execute(
            "DELETE FROM undo_actions WHERE root=?1 AND id NOT IN
             (SELECT id FROM undo_actions WHERE root=?1 ORDER BY created_at DESC LIMIT 5)",
            params![root],
        )?;
        Ok(id)
    }

    pub fn latest_undo(&self, roots: &[String]) -> Result<Option<(String, String, String, String, String)>> {
        if roots.is_empty() { return Ok(None); }
        let conn = self.conn.lock().unwrap();
        let placeholders = (0..roots.len()).map(|i| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id,root,kind,label,payload FROM undo_actions WHERE root IN ({placeholders}) ORDER BY created_at DESC LIMIT 1");
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(roots.iter()))?;
        let Some(row) = rows.next()? else { return Ok(None) };
        Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
    }

    pub fn get_undo(&self, id: &str) -> Result<Option<(String, String, String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id,root,kind,label,payload FROM undo_actions WHERE id=?1")?;
        let mut rows = stmt.query(params![id])?;
        let Some(row) = rows.next()? else { return Ok(None) };
        Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
    }

    pub fn delete_undo(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute("DELETE FROM undo_actions WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn root_for_path(&self, path: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT root FROM media WHERE path=?1", params![path], |row| row.get(0)).ok())
    }
}
