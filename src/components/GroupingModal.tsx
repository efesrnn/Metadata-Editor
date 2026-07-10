import { useState } from "react";
import type { Filter, GroupBy, OpMode, GroupPlan, ApplyResult } from "../types";
import { planGroup, applyLastPlan, pickSingleDirectory } from "../api";

interface Props {
  filter: Filter;
  defaultDest: string;
  onClose: () => void;
  onApplied: () => void;
}

const GROUPS: { key: GroupBy; t: string; d: string }[] = [
  { key: "month", t: "Ay ay", d: "Yil / Ay-Adi" },
  { key: "year", t: "Yil", d: "2023, 2024 ..." },
  { key: "type", t: "Foto/Video", d: "Fotograflar / Videolar" },
  { key: "camera", t: "Kamera", d: "Cihaz modeline gore" },
  { key: "location", t: "Konum", d: "Konumlu / Konumsuz" },
  { key: "event", t: "Etkinlik", d: "Zaman bosluguna gore" },
];

export default function GroupingModal({ filter, defaultDest, onClose, onApplied }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [mode, setMode] = useState<OpMode>("copy");
  const [dest, setDest] = useState(defaultDest);
  const [alsoSplitType, setAlsoSplitType] = useState(false);
  const [gap, setGap] = useState(12);
  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const p = await planGroup({ filter, groupBy, mode, destBase: dest, alsoSplitType, eventGapHours: gap });
      setPlan(p);
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const r = await applyLastPlan();
      setResult(r);
      onApplied();
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <header>Gruplama & Klasorlere bolme <button className="ghost" onClick={onClose}>✕</button></header>
        <div className="content">
          <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 0 }}>
            Su an <b>filtrelenmis</b> ogeler uzerinde calisir. Once onizleme olustur, sonra uygula.
          </p>

          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>Gruplama turu</label>
          <div className="opt-grid">
            {GROUPS.map((g) => (
              <div key={g.key} className={`opt${groupBy === g.key ? " active" : ""}`} onClick={() => { setGroupBy(g.key); setPlan(null); }}>
                <div className="t">{g.t}</div><div className="d">{g.d}</div>
              </div>
            ))}
          </div>

          {groupBy === "event" && (
            <div className="field">
              <label>Etkinlik esigi (saat): {gap}</label>
              <input type="range" min={1} max={72} value={gap} onChange={(e) => { setGap(Number(e.target.value)); setPlan(null); }} />
            </div>
          )}

          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>Islem modu</label>
          <div className="opt-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className={`opt${mode === "copy" ? " active" : ""}`} onClick={() => { setMode("copy"); setPlan(null); }}>
              <div className="t">Kopyala</div><div className="d">Orijinaller kalir</div>
            </div>
            <div className={`opt${mode === "move" ? " active" : ""}`} onClick={() => { setMode("move"); setPlan(null); }}>
              <div className="t">Tasi</div><div className="d">Dosya yeni yere gider</div>
            </div>
          </div>

          {groupBy !== "type" && (
            <label className="check">
              <input type="checkbox" checked={alsoSplitType} onChange={(e) => { setAlsoSplitType(e.target.checked); setPlan(null); }} />
              Ayrica her grupta foto/video olarak da ayir
            </label>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>Hedef klasor</label>
            <div className="row" style={{ alignItems: "stretch" }}>
              <input value={dest} onChange={(e) => { setDest(e.target.value); setPlan(null); }} style={{ flex: 3 }} />
              <button onClick={async () => { const d = await pickSingleDirectory("Hedef klasor sec"); if (d) { setDest(d); setPlan(null); } }} style={{ flex: 1 }}>Sec…</button>
            </div>
          </div>

          {plan && (
            <div className="plan-summary">
              <b>{plan.total}</b> dosya, <b>{plan.groupCounts.length}</b> grup ({plan.mode === "move" ? "tasima" : "kopyalama"})
              <div style={{ marginTop: 8 }}>
                {plan.groupCounts.slice(0, 12).map(([g, n]) => (
                  <div className="grp" key={g}><span>{g}</span><span>{n}</span></div>
                ))}
                {plan.groupCounts.length > 12 && <div className="grp"><span>… +{plan.groupCounts.length - 12} grup</span><span /></div>}
              </div>
              {plan.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
            </div>
          )}

          {result && (
            <div className="plan-summary" style={{ borderColor: "var(--ok)" }}>
              ✓ {result.succeeded} basarili, {result.failed} atlandi/hata.
              {result.errors.slice(0, 5).map((e, i) => <div className="err" key={i}>{e}</div>)}
            </div>
          )}
          {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <footer>
          <button className="ghost" onClick={onClose}>Kapat</button>
          <button onClick={preview} disabled={busy || !dest}>Onizleme</button>
          <button className="primary" onClick={apply} disabled={busy || !plan || plan.total === 0}>
            {busy ? "Calisiyor…" : "Uygula"}
          </button>
        </footer>
      </div>
    </div>
  );
}
