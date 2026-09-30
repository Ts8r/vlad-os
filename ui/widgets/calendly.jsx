import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";

export const meta = {"id": "calendly", "titre": "RDV clients", "icone": "☏", "categorie": "Connecteurs", "description": "Rendez-vous clients réservés sur Calendly.", "colonne": "right", "requiert": ["CALENDLY_TOKEN"], "perso": false};

export default function CalendlyWidget() {
  const [c, setC] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(BRIDGE + "/calendly").then((r) => r.json()).then((d) => alive && setC(d)).catch(() => {});
    load();
    const iv = setInterval(load, 300000);   // 5 min
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const fmt = (e) => {
    const d = new Date(e.start);
    return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };
  return (
    <Fold id="calendly" title="RDV clients">
      {!c && <p className="dim">chargement…</p>}
      {c && !c.configured && (
        <p className="dim">Colle ton jeton Calendly dans <code>.env</code> (CALENDLY_TOKEN) puis relance.</p>
      )}
      {c?.configured && c.error && <p className="dim">Calendly injoignable — je réessaie.</p>}
      {c?.configured && !c.error && (c.events || []).length === 0 && <p className="dim">aucun rendez-vous client à venir</p>}
      {(c?.events || []).map((e, i) => (
        <div className="cal-ev" key={i}>
          <span className="cal-when">{fmt(e)}</span>
          <span className="cal-title">{e.title}{e.who ? " · " + e.who : ""}</span>
        </div>
      ))}
    </Fold>
  );
}
