import type { Filter, LibraryStats } from "../types";
import { useI18n, MONTHS } from "../i18n";

interface Props {
  stats: LibraryStats | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  visibleCount: number;
}

export default function Sidebar({ stats, filter, setFilter, visibleCount }: Props) {
  const { t, lang } = useI18n();
  const set = (patch: Partial<Filter>) => setFilter({ ...filter, ...patch });
  const toggleRoot = (r: string) => {
    const cur = new Set(filter.roots ?? []);
    cur.has(r) ? cur.delete(r) : cur.add(r);
    set({ roots: cur.size ? [...cur] : undefined });
  };
  const hasFilters = !!(filter.kind || filter.dateFrom || filter.dateTo || filter.year ||
    filter.month || filter.camera || filter.hasGps || filter.roots);

  return (
    <aside className="sidebar" aria-label={t("side.library")}>
      <h3>{t("side.library")}</h3>
      <div className="stat-grid">
        <div className="stat"><div className="n">{stats?.total ?? 0}</div><div className="l">{t("stat.total")}</div></div>
        <div className="stat"><div className="n">{visibleCount}</div><div className="l">{t("stat.shown")}</div></div>
        <div className="stat"><div className="n">{stats?.photos ?? 0}</div><div className="l">{t("stat.photos")}</div></div>
        <div className="stat"><div className="n">{stats?.videos ?? 0}</div><div className="l">{t("stat.videos")}</div></div>
      </div>

      {hasFilters && (
        <button className="ghost" style={{ width: "100%", marginTop: 12 }} onClick={() => setFilter({ sortBy: filter.sortBy, sortDir: filter.sortDir })}>
          ✕ {t("btn.clearFilters")}
        </button>
      )}

      <h3>{t("side.type")}</h3>
      <div className="chips" role="group" aria-label={t("side.type")}>
        <span role="button" tabIndex={0} className={`chip${!filter.kind ? " active" : ""}`}
          onClick={() => set({ kind: undefined })} onKeyDown={(e) => e.key === "Enter" && set({ kind: undefined })}>{t("type.all")}</span>
        <span role="button" tabIndex={0} className={`chip${filter.kind === "photo" ? " active" : ""}`}
          onClick={() => set({ kind: "photo" })} onKeyDown={(e) => e.key === "Enter" && set({ kind: "photo" })}>{t("type.photo")}</span>
        <span role="button" tabIndex={0} className={`chip${filter.kind === "video" ? " active" : ""}`}
          onClick={() => set({ kind: "video" })} onKeyDown={(e) => e.key === "Enter" && set({ kind: "video" })}>{t("type.video")}</span>
      </div>

      <h3>{t("side.dateRange")}</h3>
      <div className="row">
        <input type="date" aria-label={t("side.dateRange")} value={filter.dateFrom ?? ""} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
        <input type="date" aria-label={t("side.dateRange")} value={filter.dateTo ?? ""} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
      </div>

      {stats && stats.years.length > 0 && (
        <>
          <h3>{t("side.year")}</h3>
          <div className="chips" role="group" aria-label={t("side.year")}>
            <span role="button" tabIndex={0} className={`chip${!filter.year ? " active" : ""}`}
              onClick={() => set({ year: undefined, month: undefined })} onKeyDown={(e) => e.key === "Enter" && set({ year: undefined, month: undefined })}>{t("type.all")}</span>
            {stats.years.map((y) => (
              <span role="button" tabIndex={0} key={y} className={`chip${filter.year === y ? " active" : ""}`}
                onClick={() => set({ year: y })} onKeyDown={(e) => e.key === "Enter" && set({ year: y })}>{y}</span>
            ))}
          </div>
        </>
      )}

      <h3>{t("side.month")}</h3>
      <select aria-label={t("side.month")} value={filter.month ?? ""} onChange={(e) => set({ month: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">{t("month.all")}</option>
        {MONTHS[lang].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>

      {stats && stats.cameras.length > 0 && (
        <>
          <h3>{t("side.camera")}</h3>
          <select aria-label={t("side.camera")} value={filter.camera ?? ""} onChange={(e) => set({ camera: e.target.value || undefined })}>
            <option value="">{t("camera.all")}</option>
            {stats.cameras.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </>
      )}

      <h3>{t("side.location")}</h3>
      <label className="check">
        <input type="checkbox" checked={!!filter.hasGps} onChange={(e) => set({ hasGps: e.target.checked || undefined })} />
        {t("location.only", { n: stats?.withGps ?? 0 })}
      </label>

      <h3>{t("side.sort")}</h3>
      <div className="row">
        <select aria-label={t("side.sort")} value={filter.sortBy ?? "taken_at"} onChange={(e) => set({ sortBy: e.target.value as Filter["sortBy"] })}>
          <option value="taken_at">{t("sort.taken")}</option>
          <option value="modified_at">{t("sort.modified")}</option>
          <option value="file_name">{t("sort.name")}</option>
          <option value="size_bytes">{t("sort.size")}</option>
          <option value="camera_model">{t("sort.camera")}</option>
        </select>
        <select aria-label={t("side.sort")} value={filter.sortDir ?? "desc"} onChange={(e) => set({ sortDir: e.target.value as Filter["sortDir"] })}>
          <option value="desc">{t("sort.desc")}</option>
          <option value="asc">{t("sort.asc")}</option>
        </select>
      </div>

      {stats && stats.roots.length > 0 && (
        <>
          <h3>{t("side.folders")}</h3>
          <div className="roots-list">
            {stats.roots.map((r) => (
              <label className="check" key={r}>
                <input type="checkbox" checked={filter.roots ? filter.roots.includes(r) : true} onChange={() => toggleRoot(r)} />
                <span className="root-item">{r}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
