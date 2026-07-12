// Tauri IPC sarmalayicilari.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  MediaItem, Filter, LibraryStats, ScanProgress,
  GroupRequest, MergeRequest, GroupPlan, ApplyResult, FileOpResult, UndoPreview,
} from "./types";

export async function pickDirectories(): Promise<string[]> {
  const result = await open({ directory: true, multiple: true, title: "Klasor(ler) sec" });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export async function pickSingleDirectory(title = "Klasor sec"): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title });
  return (result as string) ?? null;
}

export function scanDirectories(roots: string[], makeThumbs = true): Promise<number> {
  return invoke<number>("scan_directories", { roots, makeThumbs });
}

export function getMedia(filter: Filter): Promise<MediaItem[]> {
  return invoke<MediaItem[]>("get_media", { filter });
}

export function getStats(): Promise<LibraryStats> {
  return invoke<LibraryStats>("get_stats");
}

export function checkRoots(roots: string[]): Promise<string[]> {
  return invoke<string[]>("check_roots", { roots });
}

export function removeRoots(roots: string[], deleteThumbs = true): Promise<number> {
  return invoke<number>("remove_roots", { roots, deleteThumbs });
}

export function copyFilesToClipboard(paths: string[]): Promise<void> {
  return invoke<void>("copy_files_to_clipboard", { paths });
}

export function planGroup(req: GroupRequest): Promise<GroupPlan> {
  return invoke<GroupPlan>("plan_group", { req });
}

export function planMerge(req: MergeRequest): Promise<GroupPlan> {
  return invoke<GroupPlan>("plan_merge", { req });
}

export function applyLastPlan(): Promise<ApplyResult> {
  return invoke<ApplyResult>("apply_last_plan");
}

export function ffmpegStatus(): Promise<boolean> {
  return invoke<boolean>("ffmpeg_status");
}

export function setMediaLocation(item: MediaItem, lat: number, lon: number): Promise<void> {
  return invoke<void>("set_media_location", {
    path: item.path, root: item.root, kind: item.kind, lat, lon,
    oldLat: item.gps_lat, oldLon: item.gps_lon, oldPlace: item.place_name,
    oldRegion: item.region, oldCountry: item.country,
  });
}

export function updateVideoDetails(item: MediaItem, fileName: string, takenAt: string): Promise<void> {
  return invoke<void>("update_video_details", {
    path: item.path, root: item.root, oldFileName: item.file_name,
    oldTakenAt: item.taken_at, fileName, takenAt,
  });
}

export function importTakeoutMetadata(items: MediaItem[]): Promise<FileOpResult> {
  return invoke<FileOpResult>("import_takeout_metadata", { items });
}

export function moveToTrash(items: MediaItem[]): Promise<FileOpResult> {
  return invoke<FileOpResult>("move_to_trash", { items });
}

export function restoreTrash(roots: string[]): Promise<FileOpResult> {
  return invoke<FileOpResult>("restore_trash", { roots });
}

export function peekUndo(roots: string[]): Promise<UndoPreview | null> {
  return invoke<UndoPreview | null>("peek_undo", { roots });
}

export function applyUndo(id: string): Promise<FileOpResult> {
  return invoke<FileOpResult>("apply_undo", { id });
}

/** Eksik onizlemeleri uret (yeniden taramaya gerek yok). Ilerleme olayi yayar. */
export function generateThumbs(): Promise<number> {
  return invoke<number>("generate_thumbs");
}

/** ffmpeg'i uygulamanin kendi klasorune indir (kullanici bir sey kurmaz). */
export function downloadFfmpeg(): Promise<string> {
  return invoke<string>("download_ffmpeg");
}

export function onScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan://progress", (e) => cb(e.payload));
}

export interface ThumbReady { path: string; thumb: string; }

/** Bir onizleme uretildiginde canli olarak tetiklenir. */
export function onThumbReady(cb: (t: ThumbReady) => void): Promise<UnlistenFn> {
  return listen<ThumbReady>("thumb://ready", (e) => cb(e.payload));
}

// Yerel dosyayi webview'de gostermek icin guvenli URL (kopyalama YOK).
export function fileSrc(path: string): string {
  return convertFileSrc(path);
}
