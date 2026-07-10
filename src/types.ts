// Backend ile paylasilan tipler.

export interface MediaItem {
  id: number;
  path: string;
  root: string;
  file_name: string;
  ext: string;
  kind: "photo" | "video";
  size_bytes: number;
  modified_at: string | null;
  taken_at: string | null;
  year: number | null;
  month: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  camera_make: string | null;
  camera_model: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  orientation: number | null;
  thumb_path: string | null;
}

export interface Filter {
  text?: string;
  kind?: "photo" | "video";
  dateFrom?: string;
  dateTo?: string;
  year?: number;
  month?: number;
  camera?: string;
  hasGps?: boolean;
  roots?: string[];
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  sortBy?: "taken_at" | "size_bytes" | "file_name" | "modified_at" | "camera_model";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface LibraryStats {
  total: number;
  photos: number;
  videos: number;
  withGps: number;
  cameras: string[];
  years: number[];
  roots: string[];
}

export interface ScanProgress {
  phase: "walking" | "reading" | "thumbnails" | "done";
  processed: number;
  total: number;
  current: string;
}

export type GroupBy = "month" | "year" | "type" | "camera" | "location" | "event";
export type OpMode = "move" | "copy";

export interface GroupRequest {
  filter: Filter;
  groupBy: GroupBy;
  mode: OpMode;
  destBase: string;
  alsoSplitType?: boolean;
  eventGapHours?: number;
}

export interface MergeRequest {
  sources: string[];
  dest: string;
  flatten?: boolean;
}

export interface PlannedOp {
  src: string;
  dst: string;
  group: string;
}

export interface GroupPlan {
  mode: string;
  ops: PlannedOp[];
  groupCounts: [string, number][];
  total: number;
  warnings: string[];
}

export interface ApplyResult {
  succeeded: number;
  failed: number;
  errors: string[];
}
