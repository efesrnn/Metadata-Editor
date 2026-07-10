//! Thumbnail (onizleme) uretimi ve disk onbellegi.
//! ONEMLI: Orijinal medya ASLA kopyalanmaz. Burada uretilen sey yalnizca
//! kucuk boyutlu turetilmis onizleme goruntusudur (Google Photos'un yaptigi gibi)
//! ve uygulamanin cache klasorunde tutulur.

use crate::metadata::MediaKind;
use image::imageops::FilterType;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;

const THUMB_MAX: u32 = 320; // uzun kenar

/// Bir kaynak yol icin deterministik thumbnail dosya yolu (cache).
pub fn thumb_path_for(cache_dir: &Path, src: &Path) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(src.to_string_lossy().as_bytes());
    // Degisiklik algilama icin son degistirme zamanini da kat
    if let Ok(meta) = std::fs::metadata(src) {
        if let Ok(modt) = meta.modified() {
            if let Ok(dur) = modt.duration_since(std::time::UNIX_EPOCH) {
                hasher.update(dur.as_secs().to_le_bytes());
            }
        }
        hasher.update(meta.len().to_le_bytes());
    }
    let hash = hasher.finalize();
    let name = format!("{:x}.jpg", hash);
    // Klasoru sisman tutmamak icin iki karakterlik alt klasor
    let sub = &name[..2];
    cache_dir.join(sub).join(name)
}

/// Foto icin thumbnail uret. Basari durumunda true.
fn make_photo_thumb(src: &Path, dst: &Path) -> bool {
    let img = match image::open(src) {
        Ok(i) => i,
        Err(_) => return false,
    };
    let thumb = img.resize(THUMB_MAX, THUMB_MAX, FilterType::Triangle);
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    thumb.to_rgb8().save_with_format(dst, image::ImageFormat::Jpeg).is_ok()
}

/// Video icin thumbnail — ffmpeg varsa ilk kareyi al. Yoksa false.
fn make_video_thumb(src: &Path, dst: &Path) -> bool {
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // ffmpeg -ss 1 -i input -frames:v 1 -vf scale=320:-1 out.jpg
    let status = Command::new("ffmpeg")
        .args(["-y", "-ss", "1", "-i"])
        .arg(src)
        .args([
            "-frames:v", "1",
            "-vf", "scale=320:-1",
            "-q:v", "3",
        ])
        .arg(dst)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    matches!(status, Ok(s) if s.success()) && dst.exists()
}

/// Thumbnail'i (gerekiyorsa) uret, cache yolunu don. None => onizleme yok.
pub fn ensure_thumb(cache_dir: &Path, src: &Path, kind: MediaKind) -> Option<PathBuf> {
    let dst = thumb_path_for(cache_dir, src);
    if dst.exists() {
        return Some(dst);
    }
    let ok = match kind {
        MediaKind::Photo => make_photo_thumb(src, &dst),
        MediaKind::Video => make_video_thumb(src, &dst),
    };
    if ok {
        Some(dst)
    } else {
        None
    }
}

/// ffmpeg sistemde var mi? (video thumbnail/oynatma bilgisi icin)
pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
