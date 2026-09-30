import React, { useState } from "react";
import { Fold, ListeReglages, usePoll, useWidgetConfig } from "./_base.jsx";

export const meta = {"id": "rss", "titre": "Flux RSS", "icone": "≋", "categorie": "Veille", "description": "Les derniers titres de tes sources (blogs, actus, veille). N'importe quel flux RSS ou Atom.", "colonne": "right", "requiert": [], "perso": false};

const DEFAUT = ["https://hnrss.org/frontpage", "https://www.lemonde.fr/pixels/rss_full.xml"];

export default function Rss() {
  const [flux, setFlux] = useWidgetConfig("rss", DEFAUT);
  const [reglage, setReglage] = useState(false);
  const [i, setI] = useState(0);
  const actif = flux[Math.min(i, flux.length - 1)];
  const d = usePoll(actif ? "/rss?url=" + encodeURIComponent(actif) : null, 900000);
  const court = (u) => { try { return new URL(u).host.replace(/^(www|rss|feeds?)\./, "").split(".")[0]; } catch { return u; } };
  const age = (s) => { const t = Date.parse(s); if (!t) return ""; const h = Math.round((Date.now() - t) / 3600000); return h < 1 ? "à l'instant" : h < 24 ? `${h} h` : `${Math.round(h / 24)} j`; };
  return (
    <Fold id="rss" title="Flux RSS" extra={<button className="w-fold" onClick={() => setReglage((x) => !x)} title="Choisir les flux">⚙</button>}>
      {(reglage || !flux.length) && (
        <ListeReglages valeurs={flux} aide="Une adresse de flux par ligne" placeholder="https://exemple.com/feed.xml"
          onSave={(v) => { setFlux(v); setI(0); setReglage(false); }} />
      )}
      {!reglage && flux.length > 1 && (
        <div className="rss-onglets">
          {flux.map((f, k) => <button key={f} className={`pw-hab ${f === actif ? "on" : ""}`} onClick={() => setI(k)}>{court(f)}</button>)}
        </div>
      )}
      {!reglage && actif && d?.url !== actif && <p className="dim">chargement…</p>}
      {!reglage && d?.url === actif && d.error && <p className="dim">flux injoignable ({d.error})</p>}
      {!reglage && d?.url === actif && (d.items || []).slice(0, 6).map((it, k) => (
        <a key={k} className="mail-row rss-item" href={it.lien} target="_blank" rel="noopener">
          <b>{age(it.date) || d.titre}</b><span>{it.titre}</span>
        </a>
      ))}
    </Fold>
  );
}
