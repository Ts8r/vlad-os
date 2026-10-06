import React from "react";
import { Fold, usePoll, useHud } from "./_base.jsx";

export const meta = {"id": "cours", "titre": "Cours", "icone": "◈", "categorie": "Quotidien", "description": "Tes derniers cours lus par VLAD et une révision par QCM en un clic.", "colonne": "left", "requiert": [], "perso": false};

export default function CoursWidget() {
  const d = usePoll("/cours", 60000);
  const { ouvrirPage } = useHud();
  const total = (d?.cours || []).reduce((t, c) => t + c.qcm.length, 0);
  const aRevoir = (d?.parCours || []).reduce((t, s) => t + s.aRevoir, 0);
  return (
    <Fold id="cours" title={aRevoir ? `Cours · ${aRevoir} à revoir` : "Cours"}>
      {!d && <p className="dim">chargement…</p>}
      {d && d.cours.length === 0 && <p className="dim">Dépose un support de cours (PDF) : VLAD le résume et prépare un QCM.</p>}
      {(d?.cours || []).slice(0, 4).map((c) => (
        <button key={c.id} className="proj" onClick={() => ouvrirPage("cours")} title={c.resume?.slice(0, 200)}>
          <span className="proj-dot on" />
          <span className="proj-name">{c.titre}</span>
          <i>{c.matiere}</i>
        </button>
      ))}
      <div className="reu-actions">
        {total > 0 && <button className="reu-btn rec" onClick={() => ouvrirPage("revision")}>▶ Réviser ({total} q.)</button>}
        <button className="reu-btn" onClick={() => ouvrirPage("cours")}>Ajouter un cours</button>
      </div>
    </Fold>
  );
}
