import { useState } from "react";
import type { GroupPlan, ApplyResult } from "../types";
import { planMerge, applyLastPlan, pickDirectories, pickSingleDirectory } from "../api";
import { useI18n } from "../i18n";

interface Props {
  onClose: () => void;
  onApplied: () => void;
}

export default function MergeModal({ onClose, onApplied }: Props) {
  const { t } = useI18n();
  const [sources, setSources] = useState<string[]>([]);
  const [dest, setDest] = useState("");
  const [flatten, setFlatten] = useState(false);
  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addSources = async () => {
    const dirs = await pickDirectories();
    if (dirs.length) { setSources([...new Set([...sources, ...dirs])]); setPlan(null); }
  };
  const preview = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setPlan(await planMerge({ sources, dest, flatten })); }
    catch (e) { setError(String(e)); }
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("mrg.title")}>
        <header>{t("mrg.title")} <button className="ghost" onClick={onClose} aria-label={t("btn.close")}>✕</button></header>
        <div className="content">
          <div className="badge-note">{t("mrg.badge")}</div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>{t("mrg.sources")}</label>
            {sources.map((s) => (
              <div key={s} className="row" style={{ alignItems: "center" }}>
                <span className="path-box" style={{ flex: 5 }}>{s}</span>
                <button className="ghost" style={{ flex: 1 }} onClick={() => { setSources(sources.filter((x) => x !== s)); setPlan(null); }}>{t("btn.remove")}</button>
              </div>
            ))}
            <button onClick={addSources}>{t("mrg.addSource")}</button>
          </div>

          <div className="field">
            <label>{t("mrg.dest")}</label>
            <div className="row" style={{ alignItems: "stretch" }}>
              <input value={dest} onChange={(e) => { setDest(e.target.value); setPlan(null); }} style={{ flex: 3 }} placeholder={t("mrg.destPlaceholder")} aria-label={t("mrg.dest")} />
              <button onClick={async () => { const d = await pickSingleDirectory(t("mrg.dest")); if (d) { setDest(d); setPlan(null); } }} style={{ flex: 1 }}>{t("btn.selectShort")}</button>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={flatten} onChange={(e) => { setFlatten(e.target.checked); setPlan(null); }} />
            {t("mrg.flatten")}
          </label>

          {plan && (
            <div className="plan-summary">
              {t("mrg.summary", { total: plan.total, sources: plan.groupCounts.length })}
              <div style={{ marginTop: 8 }}>
                {plan.groupCounts.map(([g, n]) => <div className="grp" key={g}><span>{g}</span><span>{n}</span></div>)}
              </div>
              {plan.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
            </div>
          )}
          {result && (
            <div className="plan-summary" style={{ borderColor: "var(--ok)" }}>
              {t("mrg.resultOk", { ok: result.succeeded, fail: result.failed })}
              {result.errors.slice(0, 5).map((e, i) => <div className="err" key={i}>{e}</div>)}
            </div>
          )}
          {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <footer>
          <button className="ghost" onClick={onClose}>{t("btn.close")}</button>
          <button onClick={preview} disabled={busy || sources.length === 0 || !dest}>{t("btn.preview")}</button>
          <button className="primary" onClick={apply} disabled={busy || !plan || plan.total === 0}>
            {busy ? t("btn.working") : t("btn.mergeAction")}
          </button>
        </footer>
      </div>
    </div>
  );
}
