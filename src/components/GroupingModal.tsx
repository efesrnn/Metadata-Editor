import { useState } from "react";
import type { Filter, GroupBy, OpMode, GroupPlan, ApplyResult } from "../types";
import { planGroup, applyLastPlan, pickSingleDirectory } from "../api";
import { useI18n } from "../i18n";

interface Props {
  filter: Filter;
  defaultDest: string;
  onClose: () => void;
  onApplied: () => void;
}

export default function GroupingModal({ filter, defaultDest, onClose, onApplied }: Props) {
  const { t, lang } = useI18n();
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [mode, setMode] = useState<OpMode>("copy");
  const [dest, setDest] = useState(defaultDest);
  const [alsoSplitType, setAlsoSplitType] = useState(false);
  const [gap, setGap] = useState(12);
  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const GROUPS: { key: GroupBy; t: string; d: string }[] = [
    { key: "month", t: t("grp.month"), d: t("grp.month.d") },
    { key: "year", t: t("grp.year"), d: t("grp.year.d") },
    { key: "type", t: t("grp.byType"), d: t("grp.byType.d") },
    { key: "camera", t: t("grp.camera"), d: t("grp.camera.d") },
    { key: "location", t: t("grp.location"), d: t("grp.location.d") },
    { key: "event", t: t("grp.event"), d: t("grp.event.d") },
  ];

  const preview = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      setPlan(await planGroup({ filter, groupBy, mode, destBase: dest, alsoSplitType, eventGapHours: gap, lang }));
    } catch (e) { setError(String(e)); }
    setBusy(false);
  };
  const apply = async () => {
    setBusy(true); setError(null);
    try { setResult(await applyLastPlan()); onApplied(); }
    catch (e) { setError(String(e)); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("grp.title")}>
        <header>{t("grp.title")} <button className="ghost" onClick={onClose} aria-label={t("btn.close")}>✕</button></header>
        <div className="content">
          <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 0 }}>{t("grp.desc")}</p>

          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("grp.type")}</label>
          <div className="opt-grid">
            {GROUPS.map((g) => (
              <div key={g.key} role="button" tabIndex={0} className={`opt${groupBy === g.key ? " active" : ""}`}
                onClick={() => { setGroupBy(g.key); setPlan(null); }}
                onKeyDown={(e) => e.key === "Enter" && (setGroupBy(g.key), setPlan(null))}>
                <div className="t">{g.t}</div><div className="d">{g.d}</div>
              </div>
            ))}
          </div>

          {groupBy === "event" && (
            <div className="field">
              <label>{t("grp.eventThreshold", { n: gap })}</label>
              <input type="range" min={1} max={72} value={gap} onChange={(e) => { setGap(Number(e.target.value)); setPlan(null); }} />
            </div>
          )}

          <label style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("grp.mode")}</label>
          <div className="opt-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div role="button" tabIndex={0} className={`opt${mode === "copy" ? " active" : ""}`}
              onClick={() => { setMode("copy"); setPlan(null); }} onKeyDown={(e) => e.key === "Enter" && (setMode("copy"), setPlan(null))}>
              <div className="t">{t("grp.copy")}</div><div className="d">{t("grp.copy.d")}</div>
            </div>
            <div role="button" tabIndex={0} className={`opt${mode === "move" ? " active" : ""}`}
              onClick={() => { setMode("move"); setPlan(null); }} onKeyDown={(e) => e.key === "Enter" && (setMode("move"), setPlan(null))}>
              <div className="t">{t("grp.move")}</div><div className="d">{t("grp.move.d")}</div>
            </div>
          </div>

          {groupBy !== "type" && (
            <label className="check">
              <input type="checkbox" checked={alsoSplitType} onChange={(e) => { setAlsoSplitType(e.target.checked); setPlan(null); }} />
              {t("grp.alsoSplit")}
            </label>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label>{t("grp.dest")}</label>
            <div className="row" style={{ alignItems: "stretch" }}>
              <input value={dest} onChange={(e) => { setDest(e.target.value); setPlan(null); }} style={{ flex: 3 }} aria-label={t("grp.dest")} />
              <button onClick={async () => { const d = await pickSingleDirectory(t("grp.dest")); if (d) { setDest(d); setPlan(null); } }} style={{ flex: 1 }}>{t("btn.selectShort")}</button>
            </div>
          </div>

          {plan && (
            <div className="plan-summary">
              {t("grp.summary", { total: plan.total, groups: plan.groupCounts.length, mode: t(`mode.${plan.mode}`) })}
              <div style={{ marginTop: 8 }}>
                {plan.groupCounts.slice(0, 12).map(([g, n]) => (
                  <div className="grp" key={g}><span>{g}</span><span>{n}</span></div>
                ))}
                {plan.groupCounts.length > 12 && <div className="grp"><span>{t("grp.moreGroups", { n: plan.groupCounts.length - 12 })}</span><span /></div>}
              </div>
              {plan.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
            </div>
          )}
          {result && (
            <div className="plan-summary" style={{ borderColor: "var(--ok)" }}>
              {t("grp.resultOk", { ok: result.succeeded, fail: result.failed })}
              {result.errors.slice(0, 5).map((e, i) => <div className="err" key={i}>{e}</div>)}
            </div>
          )}
          {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <footer>
          <button className="ghost" onClick={onClose}>{t("btn.close")}</button>
          <button onClick={preview} disabled={busy || !dest}>{t("btn.preview")}</button>
          <button className="primary" onClick={apply} disabled={busy || !plan || plan.total === 0}>
            {busy ? t("btn.working") : t("btn.apply")}
          </button>
        </footer>
      </div>
    </div>
  );
}
