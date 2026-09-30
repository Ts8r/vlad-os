/* ═══════════════════════════════════════════════════════════════
   VLAD — socle commun des widgets de l'accueil.
   Un widget = un fichier ui/widgets/<id>.jsx qui exporte :
     export const meta = { id, titre, icone, categorie, description,
                           colonne: "left"|"right", requiert: ["GITHUB"], perso: false };
     export default function MonWidget() { return <Fold id=… title=…>…</Fold>; }
   Il est découvert tout seul (ui/widgets/index.js) : rien à toucher dans app.jsx.
   ═══════════════════════════════════════════════════════════════ */
import React, { createContext, useContext, useEffect, useState } from "react";

export const BRIDGE = "/api";   // même origine : proxy Vite en local, tunnel Cloudflare à distance

// HUD : ce que les widgets peuvent demander à l'accueil (poser une question, ouvrir une page, journal…)
export const HudCtx = createContext({});
export const useHud = () => useContext(HudCtx);

// Tableau : disposition + réglages par widget + mode édition (fourni par widget-board.jsx)
export const BoardCtx = createContext({ editing: false, config: {}, setConfig: () => {} });
export const SlotCtx = createContext(null);   // { id, col, idx } du widget rendu

/* Réglages d'un widget (liste de flux, sites à surveiller…), stockés dans layout.json
   → identiques sur le Mac et l'iPhone. */
export function useWidgetConfig(id, defaut) {
  const { config, setConfig } = useContext(BoardCtx);
  return [config[id] ?? defaut, (v) => setConfig(id, v)];
}

/* Rafraîchissement périodique d'une route du pont. */
export function usePoll(path, ms, deps = []) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = () => fetch(BRIDGE + path).then((r) => r.json()).then((x) => alive && setD(x)).catch(() => {});
    load();
    const iv = setInterval(load, ms);
    return () => { alive = false; clearInterval(iv); };
  }, [path, ms, ...deps]);
  return d;
}

export const postJson = (path, obj) => fetch(BRIDGE + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj),
}).then((r) => r.json());

/* ── Widget pliable : chaque carte se réduit d'un clic, état mémorisé.
   En mode édition, les boutons de pli laissent place à ↑ ↓ ⇄ × et la carte se glisse. ── */
export function Fold({ id, title, extra, children, className = "", open: openCtl, onToggle }) {
  const [openLoc, setOpenLoc] = useState(() => localStorage.getItem("vlad_fold_" + id) !== "0");
  const open = openCtl ?? openLoc;
  const toggle = onToggle ?? (() => setOpenLoc((o) => { try { localStorage.setItem("vlad_fold_" + id, o ? "0" : "1"); } catch {} return !o; }));
  const board = useContext(BoardCtx), slot = useContext(SlotCtx);
  const edit = board.editing && slot;
  const drag = edit ? {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData("text/vlad-widget", slot.id); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); const w = e.dataTransfer.getData("text/vlad-widget"); if (w) board.placer(w, slot.col, slot.idx); },
  } : {};
  return (
    <div className={`widget ${className} ${edit ? "w-editing" : ""}`} {...drag}>
      <h3 className="w-head">
        <span className="w-titre">{title}</span>
        <span className="w-btns">
          {edit ? <>
            <button className="w-fold" onClick={() => board.deplacer(slot.id, -1)} title="Monter">↑</button>
            <button className="w-fold" onClick={() => board.deplacer(slot.id, 1)} title="Descendre">↓</button>
            <button className="w-fold" onClick={() => board.changerCol(slot.id)} title="Changer de colonne">⇄</button>
            <button className="w-fold w-del" onClick={() => board.retirer(slot.id)} title="Retirer de l'accueil">×</button>
          </> : <>
            {extra}
            <button className="w-fold" onClick={toggle} title={open ? "Réduire" : "Déplier"}>{open ? "−" : "+"}</button>
          </>}
        </span>
      </h3>
      {open && !edit && children}
      {edit && <p className="dim w-drag">glisser pour déplacer</p>}
    </div>
  );
}

/* ── Jauge : barre branchée sur une valeur RÉELLE ── */
export function Gauge({ label, pct, text, warn }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className={`gauge ${warn && v >= warn ? "warn" : ""}`}>
      <div className="gauge-head"><span>{label}</span><b>{text ?? v + "%"}</b></div>
      <div className="gauge-rail"><div className="gauge-fill" style={{ width: v + "%" }} /></div>
    </div>
  );
}

/* ── Petit panneau de réglages (⚙) : une liste de lignes éditable (URLs, flux…) ── */
export function ListeReglages({ valeurs, onSave, placeholder, aide }) {
  const [txt, setTxt] = useState(valeurs.join("\n"));
  return (
    <div className="w-reglages">
      {aide && <p className="dim">{aide}</p>}
      <textarea className="w-input w-area" rows={4} value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} />
      <button className="reu-btn" onClick={() => onSave(txt.split("\n").map((s) => s.trim()).filter(Boolean))}>Enregistrer</button>
    </div>
  );
}
