//! Thumbnail (onizleme) uretimi ve disk onbellegi + ffmpeg cozumleme/indirme.
//! ONEMLI: Orijinal medya ASLA kopyalanmaz. Burada uretilen sey yalnizca
//! kucuk boyutlu turetilmis onizleme goruntusudur ve cache klasorunde tutulur.

use crate::metadata::MediaKind;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use walkdir::WalkDir;

const THUMB_MAX: u32 = 256;

// Cozumlenmis ffmpeg yolu onbellegi (basari halinde).
static FFMPEG_CACHE: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

// Windows icin tasinabilir (static) ffmpeg indirme adresi.
const FFMPEG_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

/// Bir kaynak yol icin deterministik thumbnail dosya yolu (cache).
pub fn thumb_path_for(cache_dir: &Path, src: &Path) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(src.to_string_lossy().as_bytes());
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
    let sub = &name[..2];
    cache_dir.join(sub).join(name)
}

fn make_photo_thumb(src: &Path, dst: &Path) -> bool {
    let img = match image::open(src) {
        Ok(i) => i,
        Err(_) => return false,
    };
    // thumbnail() hizli bir kucultme filtresi kullanir; en-boy oranini korur.
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    thumb.to_rgb8().save_with_format(dst, image::ImageFormat::Jpeg).is_ok()
}

/// Video icin thumbnail — verilen ffmpeg ile bir kareyi al.
fn make_video_thumb(ff: &Path, src: &Path, dst: &Path) -> bool {
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let run = |ss: &str| -> bool {
        let _ = std::fs::remove_file(dst);
        let status = Command::new(ff)
            .args(["-y", "-ss", ss, "-i"])
            .arg(src)
            .args(["-frames:v", "1", "-vf", "scale=256:-1:force_original_aspect_ratio=decrease", "-q:v", "4"])
            .arg(dst)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        matches!(status, Ok(s) if s.success()) && dst.exists()
    };
    // Once 1sn'den kare al; cok kisa videolar icin 0'a dus.
    run("1") || run("0")
}

/// Thumbnail'i (gerekiyorsa) uret, cache yolunu don. ff = video icin ffmpeg yolu.
pub fn ensure_thumb(cache_dir: &Path, src: &Path, kind: MediaKind, ff: Option<&Path>) -> Option<PathBuf> {
    let dst = thumb_path_for(cache_dir, src);
    if dst.exists() {
        return Some(dst);
    }
    let ok = match kind {
        MediaKind::Photo => make_photo_thumb(src, &dst),
        MediaKind::Video => match ff {
            Some(f) => make_video_thumb(f, src, &dst),
            None => false,
        },
    };
    if ok { Some(dst) } else { None }
}

fn ffmpeg_works(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Olasi ffmpeg konumlari (PATH + uygulama yani + winget/choco/Program Files).
fn candidate_paths(extra_bin_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    // 1) Uygulamanin kendi bin klasoru (indirilen ffmpeg)
    if let Some(dir) = extra_bin_dir {
        v.push(dir.join("ffmpeg.exe"));
        v.push(dir.join("ffmpeg"));
    }
    // 2) Uygulama .exe'sinin yani (sidecar)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("ffmpeg.exe"));
            v.push(dir.join("ffmpeg"));
        }
    }
    // 3) Windows'a ozgu yaygin konumlar
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(&local);
            v.push(base.join(r"Microsoft\WinGet\Links\ffmpeg.exe"));
            // winget paket klasoru: <Packages>\Gyan.FFmpeg...\ffmpeg-*\bin\ffmpeg.exe
            let pkgs = base.join(r"Microsoft\WinGet\Packages");
            if let Ok(rd) = std::fs::read_dir(&pkgs) {
                for e in rd.flatten() {
                    if e.file_name().to_string_lossy().to_lowercase().contains("ffmpeg") {
                        if let Ok(sub) = std::fs::read_dir(e.path()) {
                            for s in sub.flatten() {
                                v.push(s.path().join(r"bin\ffmpeg.exe"));
                            }
                        }
                        v.push(e.path().join(r"bin\ffmpeg.exe"));
                    }
                }
            }
        }
        for p in [r"C:\ffmpeg\bin\ffmpeg.exe", r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"] {
            v.push(PathBuf::from(p));
        }
        if let Ok(choco) = std::env::var("ChocolateyInstall") {
            v.push(PathBuf::from(choco).join(r"bin\ffmpeg.exe"));
        }
    }
    v
}

/// ffmpeg'i cozumle (onbellekli). PATH'teki "ffmpeg" de denenir.
pub fn resolve_ffmpeg(extra_bin_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = FFMPEG_CACHE.lock().unwrap().as_ref() {
        if ffmpeg_works(p) {
            return Some(p.clone());
        }
    }
    // PATH ("ffmpeg") once
    let path_cmd = PathBuf::from("ffmpeg");
    if ffmpeg_works(&path_cmd) {
        *FFMPEG_CACHE.lock().unwrap() = Some(path_cmd.clone());
        return Some(path_cmd);
    }
    for c in candidate_paths(extra_bin_dir) {
        if c.exists() && ffmpeg_works(&c) {
            *FFMPEG_CACHE.lock().unwrap() = Some(c.clone());
            return Some(c);
        }
    }
    None
}

/// ffmpeg mevcut mu? (cozumleme sonucu)
pub fn ffmpeg_available(extra_bin_dir: Option<&Path>) -> bool {
    resolve_ffmpeg(extra_bin_dir).is_some()
}

/// ffmpeg'i uygulamanin kendi klasorune indir (Windows'ta hazir curl/tar ile).
/// Kullanici harici bir sey KURMAZ. Basarida ffmpeg yolunu doner.
pub fn download_ffmpeg(bin_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(bin_dir).map_err(|e| e.to_string())?;
    let target = bin_dir.join("ffmpeg.exe");
    if target.exists() && ffmpeg_works(&target) {
        return Ok(target);
    }
    let zip = bin_dir.join("ffmpeg_download.zip");

    // 1) Indir (curl.exe Windows 10/11'de yerlesik)
    let curl = Command::new("curl")
        .args(["-L", "--fail", "--silent", "--show-error", "-o"])
        .arg(&zip)
        .arg(FFMPEG_URL)
        .status()
        .map_err(|e| format!("curl calistirilamadi: {e}"))?;
    if !curl.success() || !zip.exists() {
        return Err("ffmpeg indirilemedi (ag baglantisini kontrol edin).".into());
    }

    // 2) Cikar (tar.exe Windows 10/11'de zip acabilir)
    let extract_dir = bin_dir.join("_extract");
    let _ = std::fs::remove_dir_all(&extract_dir);
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    let tar = Command::new("tar")
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(&extract_dir)
        .status()
        .map_err(|e| format!("tar calistirilamadi: {e}"))?;
    if !tar.success() {
        return Err("Arsiv acilamadi.".into());
    }

    // 3) ffmpeg.exe'yi bul ve bin klasorune kopyala
    let mut found: Option<PathBuf> = None;
    for entry in WalkDir::new(&extract_dir).into_iter().flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case("ffmpeg.exe") {
            found = Some(entry.path().to_path_buf());
            break;
        }
    }
    let src = found.ok_or_else(|| "Arsivde ffmpeg.exe bulunamadi.".to_string())?;
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;

    // 4) Temizlik
    let _ = std::fs::remove_file(&zip);
    let _ = std::fs::remove_dir_all(&extract_dir);

    // Onbellegi sifirla ve dogrula
    *FFMPEG_CACHE.lock().unwrap() = None;
    if ffmpeg_works(&target) {
        *FFMPEG_CACHE.lock().unwrap() = Some(target.clone());
        Ok(target)
    } else {
        Err("Indirilen ffmpeg calistirilamadi.".into())
    }
}
