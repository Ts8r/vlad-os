/* ═══════════════════════════════════════════════════════════════
   VLAD — « Remplir le vault » : choisir les sources à indexer (skills, agents,
   CLAUDE.md, mémoires, coffres Obsidian, dossiers), glisser des fichiers,
   synchroniser. Une fiche-index par fichier ; les originaux ne bougent pas.
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from "react";

const BRIDGE = "/api";
const post = (p, o) => fetch(BRIDGE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }).then((r) => r.json());

export default function RemplirVault({ onClose, onFait }) {
  const [e, setE] = useState(null);
  const [dossier, setDossier] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [survol, setSurvol] = useState(false);

  useEffect(() => { fetch(BRIDGE + "/vault/sources").then((r) => r.json()).then(setE).catch(() => setMsg("pont injoignable")); }, []);
  // Échap ferme ce panneau SEULEMENT (pas la page Vault derrière) : écoute en capture + arrêt
  useEffect(() => { const k = (ev) => { if (ev.key === "Escape") { ev.stopImmediatePropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);

  const regler = async (o) => { const r = await post("/vault/sources", o); if (r.error) setMsg(r.error); else { setE(r); setMsg(""); } };
  const basculer = (id) => regler({ actifs: e.sources.filter((s) => (s.id === id ? !s.actif : s.actif)).map((s) => s.id) });
  const ajouter = async () => { if (!dossier.trim()) return; await regler({ ajouter: dossier.trim() }); setDossier(""); };
  const synchro = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await post("/vault/import", {});
      if (r.error) throw new Error(r.error);
      const n = Object.values(r.stats || {}).reduce((t, x) => t + x, 0);
      setMsg(`✓ ${n} fiches à jour${r.retirees ? ` · ${r.retirees} retirées` : ""}`);
      setE(await fetch(BRIDGE + "/vault/sources").then((x) => x.json()));
      onFait?.();
    } catch (err) { setMsg("échec : " + err.message); }
    setBusy(false);
  };
  const deposer = async (files) => {
    const ok = [];
    for (const f of files) {
      const b64 = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(",")[1]); rd.readAsDataURL(f); });
      const r = await post("/vault/deposer", { name: f.name, dataB64: b64 });
      if (r.error) { setMsg(`${f.name} : ${r.error}`); return; }
      ok.push(r.fichier);
    }
    setMsg(`✓ ${ok.length} fichier${ok.length > 1 ? "s" : ""} rangé${ok.length > 1 ? "s" : ""} dans vault/inbox`);
    onFait?.();
  };

  const total = (e?.sources || []).filter((s) => s.actif).reduce((t, s) => t + s.fichiers, 0);
  return (
    <div className="bib-fond" onClick={onClose}>
      <div className="bib vr" onClick={(ev) => ev.stopPropagation()}>
        <div className="bib-tete">
          <div>
            <div className="bib-titre">Remplir le vault</div>
            <div className="dim">une fiche-index par fichier (résumé + chemin) · tes fichiers d'origine ne sont ni copiés ni modifiés</div>
          </div>
          <button className="w-fold" onClick={onClose} title="Fermer (Échap)">✕</button>
        </div>

        <h4 className="bib-cat">Sources détectées</h4>
        {!e && !msg && <p className="dim">recherche sur ton Mac…</p>}
        {(e?.sources || []).map((s) => (
          <label key={s.id} className={`vr-ligne ${s.actif ? "on" : ""}`}>
            <input type="checkbox" checked={s.actif} onChange={() => basculer(s.id)} />
            <span className="vr-txt"><b>{s.label}</b><i>{s.aide}</i></span>
            <span className="vr-n">{s.fichiers}</span>
            {s.retirable && <button className="w-fold" title="Retirer ce dossier" onClick={(ev) => { ev.preventDefault(); regler({ retirer: s.retirable }); }}>×</button>}
          </label>
        ))}

        <h4 className="bib-cat">Ajouter un dossier de notes</h4>
        <div className="vr-ajout">
          <input className="w-input" value={dossier} onChange={(ev) => setDossier(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && ajouter()}
            placeholder="~/Documents/Notes" />
          <button className="reu-btn" onClick={ajouter}>Ajouter</button>
        </div>

        <h4 className="bib-cat">Déposer des documents</h4>
        <div className={`vr-depot ${survol ? "on" : ""}`}
          onDragOver={(ev) => { ev.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
          onDrop={(ev) => { ev.preventDefault(); setSurvol(false); deposer([...ev.dataTransfer.files]); }}>
          Glisse ici des fichiers .md, .txt ou .pdf — ils sont copiés dans vault/inbox
          <label className="reu-btn">choisir…<input type="file" multiple accept=".md,.markdown,.txt,.pdf" hidden onChange={(ev) => deposer([...ev.target.files])} /></label>
        </div>

        <div className="vr-pied">
          <span className="dim">
            {e?.derniere ? `dernière synchro : ${new Date(e.derniere.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ` : "jamais synchronisé · "}
            puis automatiquement toutes les 6 h
          </span>
          <button className="bib-btn" disabled={busy || !e} onClick={synchro}>{busy ? "…" : `Synchroniser (${total})`}</button>
        </div>
        {msg && <p className="vr-msg">{msg}</p>}
      </div>
    </div>
  );
}
