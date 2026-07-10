import type { Filter, LibraryStats } from "../types";

interface Props {
  stats: LibraryStats | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  visibleCount: number;
}

const MONTHS = ["Ocak","Subat","Mart","Nisan","Mayis","Haziran","Temmuz","Agustos","Eylul","Ekim","Kasim","Aralik"];

export default function Sidebar({ stats, filter, setFilter, visibleCount }: Props) {
  const set = (patch: Partial<Filter>) => setFilter({ ...filter, ...patch });
  const toggleRoot = (r: string) => {
    const cur = new Set(filter.roots ?? []);
    cur.has(r) ? cur.delete(r) : cur.add(r);
    set({ roots: cur.size ? [...cur] : undefined });
  };

  return (
    <aside className="sidebar">
      <h3>Kutuphane</h3>
      <div className="stat-grid">
        <div className="stat"><div className="n">{stats?.total ?? 0}</div><div className="l">Toplam</div></div>
        <div className="stat"><div className="n">{visibleCount}</div><div className="l">Gorunen</div></div>
        <div className="stat"><div className="n">{stats?.photos ?? 0}</div><div className="l">Fotograf</div></div>
        <div className="stat"><div className="n">{stats?.videos ?? 0}</div><div className="l">Video</div></div>
      </div>

      <h3>Tur</h3>
      <div className="chips">
        <span className={`chip${!filter.kind ? " active" : ""}`} onClick={() => set({ kind: undefined })}>Tumu</span>
        <span className={`chip${filter.kind === "photo" ? " active" : ""}`} onClick={() => set({ kind: "photo" })}>Fotograf</span>
        <span className={`chip${filter.kind === "video" ? " active" : ""}`} onClick={() => set({ kind: "video" })}>Video</span>
      </div>

      <h3>Tarih araligi</h3>
      <div className="row">
        <input type="date" value={filter.dateFrom ?? ""} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
        <input type="date" value={filter.dateTo ?? ""} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
      </div>

      {stats && stats.years.length > 0 && (
        <>
          <h3>Yil</h3>
          <div className="chips">
            <span className={`chip${!filter.year ? " active" : ""}`} onClick={() => set({ year: undefined, month: undefined })}>Tumu</span>
            {stats.years.map((y) => (
              <span key={y} className={`chip${filter.year === y ? " active" : ""}`} onClick={() => set({ year: y })}>{y}</span>
            ))}
          </div>
        </>
      )}

      <h3>Ay</h3>
      <select value={filter.month ?? ""} onChange={(e) => set({ month: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">Tum aylar</option>
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>

      {stats && stats.cameras.length > 0 && (
        <>
          <h3>Kamera</h3>
          <select value={filter.camera ?? ""} onChange={(e) => set({ camera: e.target.value || undefined })}>
            <option value="">Tum kameralar</option>
            {stats.cameras.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </>
      )}

      <h3>Konum</h3>
      <label className="check">
        <input type="checkbox" checked={!!filter.hasGps} onChange={(e) => set({ hasGps: e.target.checked || undefined })} />
        Yalnizca konumu olanlar ({stats?.withGps ?? 0})
      </label>

      <h3>Siralama</h3>
      <div className="row">
        <select value={filter.sortBy ?? "taken_at"} onChange={(e) => set({ sortBy: e.target.value as Filter["sortBy"] })}>
          <option value="taken_at">Cekim tarihi</option>
          <option value="modified_at">Degistirme tarihi</option>
          <option value="file_name">Dosya adi</option>
          <option value="size_bytes">Dosya boyutu</option>
          <option value="camera_model">Kamera</option>
        </select>
        <select value={filter.sortDir ?? "desc"} onChange={(e) => set({ sortDir: e.target.value as Filter["sortDir"] })}>
          <option value="desc">Azalan</option>
          <option value="asc">Artan</option>
        </select>
      </div>

      {stats && stats.roots.length > 0 && (
        <>
          <h3>Klasorler</h3>
          <div className="roots-list">
            {stats.roots.map((r) => (
              <label className="check" key={r}>
                <input type="checkbox"
                  checked={filter.roots ? filter.roots.includes(r) : true}
                  onChange={() => toggleRoot(r)} />
                <span className="root-item">{r}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
