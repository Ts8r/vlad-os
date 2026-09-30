import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";

export const meta = {"id": "projets", "titre": "Projets", "icone": "▦", "categorie": "Travail", "description": "Tes dossiers de projets (projects.json), clic = Finder.", "colonne": "left", "requiert": [], "perso": false};

export default function ProjectsWidget() {
  const [pr, setPr] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(BRIDGE + "/projects").then((r) => r.json()).then((d) => alive && setPr(d.projects || [])).catch(() => {});
    load();
    const iv = setInterval(load, 120000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const open = (p) => fetch(BRIDGE + "/project/open", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p.path }),
  }).catch(() => {});
  const age = (d) => d == null ? "" : d === 0 ? "aujourd'hui" : d === 1 ? "hier" : d < 30 ? `il y a ${d} j` : `${Math.floor(d / 30)} mois`;
  return (
    <Fold id="projets" title="Projets">
      {!pr && <p className="dim">connexion au pont…</p>}
      {pr?.filter((p) => !p.missing).map((p) => (
        <button className="proj" key={p.path} onClick={() => open(p)} title={"Ouvrir ~/" + p.path + " dans le Finder"}>
          <span className={`proj-dot ${p.days <= 7 ? "on" : ""}`} />
          <span className="proj-name">{p.name}</span>
          <i>{age(p.days)}</i>
        </button>
      ))}
    </Fold>
  );
}
