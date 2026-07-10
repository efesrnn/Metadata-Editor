// Tauri IPC sarmalayicilari.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  MediaItem, Filter, LibraryStats, ScanProgress,
  GroupRequest, MergeRequest, GroupPlan, ApplyResult,
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

export function onScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan://progress", (e) => cb(e.payload));
}

// Yerel dosyayi webview'de gostermek icin guvenli URL (kopyalama YOK).
export function fileSrc(path: string): string {
  return convertFileSrc(path);
}
