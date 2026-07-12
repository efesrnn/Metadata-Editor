//! Medya metadata cikarimi — SADECE OKUMA.
//! Bu modul hicbir dosyaya yazmaz, hicbir metadata alanini degistirmez.
//! nom-exif v3 API'si kullanilir.

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::path::Path;
use little_exif::{exif_tag::ExifTag as WritableTag, metadata::Metadata, rational::uR64};

use nom_exif::{
    Exif, ExifDateTime, ExifTag, MediaParser, MediaSource, TrackInfo, TrackInfoTag,
};

thread_local! {
    // Her calisma thread'i kendi parser'ini yeniden kullanir (tampon geri donusumu).
    // Boylece rayon paralelinde Send/paylasim sorunu olmaz.
    static PARSER: RefCell<MediaParser> = RefCell::new(MediaParser::new());
}

/// Desteklenen medya turleri.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MediaKind {
    Photo,
    Video,
}

impl MediaKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MediaKind::Photo => "photo",
            MediaKind::Video => "video",
        }
    }
}

/// Foto uzantilari.
pub const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif",
    "dng", "cr2", "cr3", "nef", "arw", "raf", "rw2", "orf", "srw", "avif",
];

/// Video uzantilari.
pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp", "mts", "m2ts", "wmv",
    "flv", "mpg", "mpeg", "hevc",
];

/// Uzantidan medya turunu belirle.
pub fn kind_from_ext(ext: &str) -> Option<MediaKind> {
    let e = ext.to_ascii_lowercase();
    if PHOTO_EXTS.contains(&e.as_str()) {
        Some(MediaKind::Photo)
    } else if VIDEO_EXTS.contains(&e.as_str()) {
        Some(MediaKind::Video)
    } else {
        None
    }
}

/// Bir medya dosyasindan cikarilan metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaMeta {
    pub taken_at: Option<String>, // "2023-08-14T19:32:05"
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_s: Option<f64>,
    pub orientation: Option<u16>,
}

/// ExifDateTime -> "YYYY-MM-DDTHH:MM:SS"
fn fmt_dt(dt: ExifDateTime) -> String {
    match dt {
        ExifDateTime::Aware(d) => d.format("%Y-%m-%dT%H:%M:%S").to_string(),
        ExifDateTime::Naive(n) => n.format("%Y-%m-%dT%H:%M:%S").to_string(),
    }
}

/// Foto EXIF metadata oku (yazma yok).
fn read_photo_meta(parser: &mut MediaParser, path: &Path) -> MediaMeta {
    let mut meta = MediaMeta::default();

    let ms = match MediaSource::open(path) {
        Ok(ms) => ms,
        Err(_) => return meta,
    };
    let iter = match parser.parse_exif(ms) {
        Ok(it) => it,
        Err(_) => return meta,
    };
    let exif: Exif = iter.into();

    // Tarih: once cekim tarihi, sonra CreateDate
    meta.taken_at = exif
        .get(ExifTag::DateTimeOriginal)
        .and_then(|v| v.as_datetime())
        .map(fmt_dt)
        .or_else(|| {
            exif.get(ExifTag::CreateDate)
                .and_then(|v| v.as_datetime())
                .map(fmt_dt)
        });

    meta.camera_make = exif.get(ExifTag::Make).and_then(|v| v.as_str()).map(|s| s.trim().to_string());
    meta.camera_model = exif.get(ExifTag::Model).and_then(|v| v.as_str()).map(|s| s.trim().to_string());

    meta.width = exif
        .get(ExifTag::ExifImageWidth)
        .and_then(|v| v.as_u32())
        .or_else(|| exif.get(ExifTag::ImageWidth).and_then(|v| v.as_u32()));
    meta.height = exif
        .get(ExifTag::ExifImageHeight)
        .and_then(|v| v.as_u32())
        .or_else(|| exif.get(ExifTag::ImageHeight).and_then(|v| v.as_u32()));

    meta.orientation = exif.get(ExifTag::Orientation).and_then(|v| v.as_u16());

    if let Some(gps) = exif.gps_info() {
        if let (Some(lat), Some(lon)) = (gps.latitude_decimal(), gps.longitude_decimal()) {
            meta.gps_lat = Some(lat);
            meta.gps_lon = Some(lon);
        }
    }

    meta
}

/// Video metadata oku (mp4/mov vb.) — yazma yok.
fn read_video_meta(parser: &mut MediaParser, path: &Path) -> MediaMeta {
    let mut meta = MediaMeta::default();

    let ms = match MediaSource::open(path) {
        Ok(ms) => ms,
        Err(_) => return meta,
    };
    let info: TrackInfo = match parser.parse_track(ms) {
        Ok(i) => i,
        Err(_) => return meta,
    };

    meta.taken_at = info
        .get(TrackInfoTag::CreateDate)
        .and_then(|v| v.as_datetime())
        .map(fmt_dt);
    meta.camera_make = info.get(TrackInfoTag::Make).and_then(|v| v.as_str()).map(|s| s.trim().to_string());
    meta.camera_model = info.get(TrackInfoTag::Model).and_then(|v| v.as_str()).map(|s| s.trim().to_string());
    meta.width = info.get(TrackInfoTag::Width).and_then(|v| v.as_u32());
    meta.height = info.get(TrackInfoTag::Height).and_then(|v| v.as_u32());
    meta.duration_s = info
        .get(TrackInfoTag::DurationMs)
        .and_then(|v| v.as_u64())
        .map(|ms| ms as f64 / 1000.0);

    if let Some(gps) = info.gps_info() {
        if let (Some(lat), Some(lon)) = (gps.latitude_decimal(), gps.longitude_decimal()) {
            meta.gps_lat = Some(lat);
            meta.gps_lon = Some(lon);
        }
    }

    meta
}

/// Bir dosya icin metadata cikar. Thread-local parser yeniden kullanilir (performans).
pub fn extract(path: &Path, kind: MediaKind) -> MediaMeta {
    PARSER.with(|p| {
        let mut parser = p.borrow_mut();
        match kind {
            MediaKind::Photo => read_photo_meta(&mut parser, path),
            MediaKind::Video => read_video_meta(&mut parser, path),
        }
    })
}

fn dms(value: f64) -> Vec<uR64> {
    let absolute = value.abs();
    let degrees = absolute.floor();
    let minutes_full = (absolute - degrees) * 60.0;
    let minutes = minutes_full.floor();
    let seconds = (minutes_full - minutes) * 60.0;
    vec![degrees.into(), minutes.into(), seconds.into()]
}

pub fn write_photo_location(path: &Path, lat: f64, lon: f64) -> anyhow::Result<()> {
    let mut data = Metadata::new_from_path(path)?;
    data.set_tag(WritableTag::GPSVersionID(vec![2, 3, 0, 0]));
    data.set_tag(WritableTag::GPSLatitudeRef(if lat >= 0.0 { "N\0" } else { "S\0" }.to_string()));
    data.set_tag(WritableTag::GPSLatitude(dms(lat)));
    data.set_tag(WritableTag::GPSLongitudeRef(if lon >= 0.0 { "E\0" } else { "W\0" }.to_string()));
    data.set_tag(WritableTag::GPSLongitude(dms(lon)));
    data.set_tag(WritableTag::GPSMapDatum("WGS-84".to_string()));
    data.write_to_file(path)?;
    Ok(())
}

pub fn write_video_location(path: &Path, lat: f64, lon: f64, ffmpeg: &Path) -> anyhow::Result<()> {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("mp4");
    let tmp = path.with_extension(format!("sortedview-location.tmp.{ext}"));
    let iso6709 = format!("{lat:+.6}{lon:+.6}/");
    let status = crate::thumbnails::hidden_command(ffmpeg)
        .args(["-y", "-i"]).arg(path)
        .args(["-map", "0", "-c", "copy", "-metadata", &format!("location={iso6709}"), "-metadata", &format!("location-eng={iso6709}")])
        .arg(&tmp).status()?;
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        anyhow::bail!("Video konumu yazılamadı (FFmpeg hata kodu: {:?})", status.code());
    }
    let backup = path.with_extension(format!("sortedview-backup.{ext}"));
    std::fs::rename(path, &backup)?;
    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::rename(&backup, path);
        return Err(error.into());
    }
    std::fs::remove_file(backup)?;
    Ok(())
}

pub fn write_video_datetime(path: &Path, datetime: &str, ffmpeg: &Path) -> anyhow::Result<()> {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("mp4");
    let tmp = path.with_extension(format!("sortedview-date.tmp.{ext}"));
    let value = format!("{}Z", datetime.trim_end_matches('Z'));
    let status = crate::thumbnails::hidden_command(ffmpeg)
        .args(["-y", "-i"]).arg(path)
        .args(["-map", "0", "-c", "copy", "-metadata", &format!("creation_time={value}")])
        .arg(&tmp).status()?;
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        anyhow::bail!("Video tarih bilgisi yazılamadı (FFmpeg hata kodu: {:?})", status.code());
    }
    let backup = path.with_extension(format!("sortedview-date-backup.{ext}"));
    std::fs::rename(path, &backup)?;
    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::rename(&backup, path);
        return Err(error.into());
    }
    std::fs::remove_file(backup)?;
    Ok(())
}

pub fn write_photo_datetime(path: &Path, datetime: &str) -> anyhow::Result<()> {
    let exif_value = datetime.replace('T', " ").replace('-', ":");
    let mut data = Metadata::new_from_path(path)?;
    data.set_tag(WritableTag::DateTimeOriginal(exif_value.clone()));
    data.set_tag(WritableTag::CreateDate(exif_value));
    data.write_to_file(path)?;
    Ok(())
}

pub fn restore_photo_datetime(path: &Path, datetime: Option<&str>) -> anyhow::Result<()> {
    let mut data = Metadata::new_from_path(path)?;
    data.remove_tag(WritableTag::DateTimeOriginal(String::new()));
    data.remove_tag(WritableTag::CreateDate(String::new()));
    if let Some(datetime) = datetime {
        let value = datetime.replace('T', " ").replace('-', ":");
        data.set_tag(WritableTag::DateTimeOriginal(value.clone()));
        data.set_tag(WritableTag::CreateDate(value));
    }
    data.write_to_file(path)?;
    Ok(())
}

pub fn restore_photo_location(path: &Path, lat: Option<f64>, lon: Option<f64>) -> anyhow::Result<()> {
    let mut data = Metadata::new_from_path(path)?;
    for tag in [
        WritableTag::GPSVersionID(Vec::new()), WritableTag::GPSLatitudeRef(String::new()),
        WritableTag::GPSLatitude(Vec::new()), WritableTag::GPSLongitudeRef(String::new()),
        WritableTag::GPSLongitude(Vec::new()), WritableTag::GPSMapDatum(String::new()),
    ] { data.remove_tag(tag); }
    if let (Some(lat), Some(lon)) = (lat, lon) {
        data.set_tag(WritableTag::GPSVersionID(vec![2, 3, 0, 0]));
        data.set_tag(WritableTag::GPSLatitudeRef(if lat >= 0.0 { "N\0" } else { "S\0" }.to_string()));
        data.set_tag(WritableTag::GPSLatitude(dms(lat)));
        data.set_tag(WritableTag::GPSLongitudeRef(if lon >= 0.0 { "E\0" } else { "W\0" }.to_string()));
        data.set_tag(WritableTag::GPSLongitude(dms(lon)));
        data.set_tag(WritableTag::GPSMapDatum("WGS-84".to_string()));
    }
    data.write_to_file(path)?;
    Ok(())
}

fn clear_video_metadata(path: &Path, ffmpeg: &Path, args: &[&str], marker: &str) -> anyhow::Result<()> {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("mp4");
    let tmp = path.with_extension(format!("sortedview-{marker}.tmp.{ext}"));
    let mut command = crate::thumbnails::hidden_command(ffmpeg);
    command.args(["-y", "-i"]).arg(path).args(["-map", "0", "-c", "copy"]);
    command.args(args).arg(&tmp);
    if !command.status()?.success() { let _ = std::fs::remove_file(&tmp); anyhow::bail!("Video metadata geri alınamadı"); }
    let backup = path.with_extension(format!("sortedview-{marker}-backup.{ext}"));
    std::fs::rename(path, &backup)?;
    if let Err(error) = std::fs::rename(&tmp, path) { let _ = std::fs::rename(&backup, path); return Err(error.into()); }
    std::fs::remove_file(backup)?;
    Ok(())
}

pub fn clear_video_datetime(path: &Path, ffmpeg: &Path) -> anyhow::Result<()> {
    clear_video_metadata(path, ffmpeg, &["-metadata", "creation_time="], "undo-date")
}

pub fn clear_video_location(path: &Path, ffmpeg: &Path) -> anyhow::Result<()> {
    clear_video_metadata(path, ffmpeg, &["-metadata", "location=", "-metadata", "location-eng="], "undo-location")
}
