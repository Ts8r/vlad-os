/* ═══════════════════════════════════════════════════════════════
   VLAD — tableau de l'accueil : quels widgets, dans quelle colonne, dans quel ordre.
   Disposition PARTAGÉE Mac / iPhone : layout.json via le pont (/layout),
   recopiée en localStorage pour un affichage immédiat au chargement.
   Mode édition : ↑ ↓ ⇄ × sur chaque carte, glisser-déposer, « + Ajouter » ouvre la bibliothèque.
   ═══════════════════════════════════════════════════════════════ */
import React, { Component, useCallback, useEffect, useMemo, useState } from "react";
import { BRIDGE, BoardCtx, SlotCtx } from "./widgets/_base.jsx";
import { WIDGETS, DISPOSITION_DEFAUT, CATEGORIES } from "./widgets/index.js";

const CLE = "vlad_layout";
const nettoie = (l) => {
  const vus = new Set();
  const garde = (ids) => (ids || []).filter((id) => WIDGETS[id] && !vus.has(id) && vus.add(id));
  return { left: garde(l?.left), right: garde(l?.right), config: l?.config || {} };
};
const lireCache = () => { try { return JSON.parse(localStorage.getItem(CLE)); } catch { return null; } };

export function useBoard() {
  const [layout, setLayout] = useState(() => nettoie(lireCache() || DISPOSITION_DEFAUT));
  const [editing, setEditing] = useState(false);

  // la version du pont fait foi (elle vient peut-être de l'autre appareil)
  useEffect(() => {
    const tire = () => fetch(BRIDGE + "/layout").then((r) => r.json()).then((d) => {
      if (!d) return;
      setLayout(nettoie(d)); try { localStorage.setItem(CLE, JSON.stringify(d)); } catch {}
    }).catch(() => {});
    tire();
    const vis = () => document.visibilityState === "visible" && tire();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  const save = useCallback((maj) => setLayout((l) => {
    const n = nettoie(maj(l));
    try { localStorage.setItem(CLE, JSON.stringify(n)); } catch {}
    fetch(BRIDGE + "/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(n) }).catch(() => {});
    return n;
  }), []);

  const sans = (l, id) => ({ ...l, left: l.left.filter((x) => x !== id), right: l.right.filter((x) => x !== id) });
  const board = useMemo(() => ({
    layout, editing, setEditing,
    config: layout.config,
    setConfig: (id, v) => save((l) => ({ ...l, config: { ...l.config, [id]: v } })),
    placer: (id, col, idx) => save((l) => {
      const avant = l[col].indexOf(id);
      const n = sans(l, id);
      const i = avant >= 0 && avant < idx ? idx - 1 : idx;
      n[col] = [...n[col].slice(0, i), id, ...n[col].slice(i)];
      return n;
    }),
    deplacer: (id, dir) => save((l) => {
      const col = l.left.includes(id) ? "left" : "right", a = [...l[col]], i = a.indexOf(id), j = i + dir;
      if (j < 0 || j >= a.length) return l;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...l, [col]: a };
    }),
    changerCol: (id) => save((l) => {
      const vers = l.left.includes(id) ? "right" : "left";
      const n = sans(l, id); n[vers] = [...n[vers], id]; return n;
    }),
    retirer: (id) => save((l) => sans(l, id)),
    ajouter: (id, col) => save((l) => { const n = sans(l, id); n[col] = [...n[col], id]; return n; }),
    reinitialiser: () => save((l) => ({ ...DISPOSITION_DEFAUT, config: l.config })),   // garde les réglages (flux, sites…)
  }), [layout, editing, save]);
  return board;
}

/* Un widget qui plante ne doit pas éteindre tout l'accueil (widgets écrits par d'autres). */
class Isole extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="widget"><h3 className="w-head">{this.props.titre}</h3><p className="dim">Ce widget a rencontré une erreur : {String(this.state.err.message || this.state.err)}</p></div>;
  }
}

export function Colonne({ board, col, className, onAjouter }) {
  const ids = board.layout[col];
  return (
    <aside className={className}
      onDragOver={board.editing ? (e) => e.preventDefault() : undefined}
      onDrop={board.editing ? (e) => { const w = e.dataTransfer.getData("text/vlad-widget"); if (w) board.placer(w, col, ids.length); } : undefined}>
      {ids.map((id, idx) => {
        const W = WIDGETS[id];
        return (
          <SlotCtx.Provider key={id} value={{ id, col, idx }}>
            <Isole titre={W.titre}><W.Composant /></Isole>
          </SlotCtx.Provider>
        );
      })}
      {board.editing && <button className="w-ajout" onClick={() => onAjouter(col)}>+ Ajouter un widget</button>}
    </aside>
  );
}

/* ── Bibliothèque : tous les widgets connus, rangés par catégorie ── */
export function Bibliotheque({ board, col, onClose }) {
  const [env, setEnv] = useState({});
  useEffect(() => { fetch(BRIDGE + "/widgets/env").then((r) => r.json()).then(setEnv).catch(() => {}); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const surAccueil = new Set([...board.layout.left, ...board.layout.right]);
  const tous = Object.values(WIDGETS);
  const cats = [...CATEGORIES, ...new Set(tous.map((w) => w.categorie).filter((c) => !CATEGORIES.includes(c)))];
  return (
    <div className="bib-fond" onClick={onClose}>
      <div className="bib" onClick={(e) => e.stopPropagation()}>
        <div className="bib-tete">
          <div><div className="bib-titre">Bibliothèque de widgets</div>
            <div className="dim">ajout dans la colonne {col === "left" ? "de gauche" : "de droite"} · {surAccueil.size} / {tous.length} sur l'accueil</div></div>
          <button className="w-fold" onClick={onClose} title="Fermer (Échap)">✕</button>
        </div>
        {cats.map((c) => {
          const ws = tous.filter((w) => w.categorie === c);
          if (!ws.length) return null;
          return (
            <section key={c}>
              <h4 className="bib-cat">{c}</h4>
              <div className="bib-grille">
                {ws.map((w) => {
                  const on = surAccueil.has(w.id);
                  const manque = w.requiert.filter((k) => env[k] === false);
                  return (
                    <div key={w.id} className={`bib-carte ${on ? "on" : ""}`}>
                      <div className="bib-ic">{w.icone || "◇"}</div>
                      <div className="bib-txt">
                        <b>{w.titre}</b>
                        <span>{w.description}</span>
                        {manque.length > 0 && <em>à configurer : {manque.join(", ")} dans .env</em>}
                      </div>
                      {on
                        ? <button className="bib-btn off" onClick={() => board.retirer(w.id)}>Retirer</button>
                        : <button className="bib-btn" onClick={() => { board.ajouter(w.id, col); onClose(); }}>Ajouter</button>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        <button className="bib-reset" onClick={() => confirm("Revenir à l'accueil d'origine ?") && board.reinitialiser()}>Revenir à l'accueil d'origine</button>
      </div>
    </div>
  );
}

export { BoardCtx };
