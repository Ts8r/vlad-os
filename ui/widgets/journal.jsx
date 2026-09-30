import React from "react";
import { Fold, useHud } from "./_base.jsx";

export const meta = {"id": "journal", "titre": "Journal", "icone": "☰", "categorie": "Assistant", "description": "La conversation avec VLAD, partagée entre le Mac et l'iPhone.", "colonne": "left", "requiert": [], "perso": false};

export default function Journal() {
  const { messages, logOpen, toggleLog, clearLog, logRef } = useHud();
  return (
    <Fold id="journal" title="Journal" className={logOpen ? "grow" : ""} open={logOpen} onToggle={toggleLog}
      extra={<button className="w-fold" onClick={clearLog} title="Vider la conversation">🗑</button>}>
      <div className="journal" ref={logRef}>
        {messages.length === 0 && <p className="dim">La conversation s'affichera ici.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`jmsg ${m.from}`}><b>{m.from === "you" ? "TOI" : "VLAD"}</b>{m.text}</div>
        ))}
      </div>
    </Fold>
  );
}
