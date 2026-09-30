/* ═══ HORLOGE GRAVÉE — bloc titre des pages Agenda / Progrès / Vault (port fidèle
   du CodePen « Clocktober Day 22 : Etched » : grille 2×2, capsules gravées) ═══ */
import React, { useEffect, useState } from "react";

export function HorlogeSegments() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  const d = String(t.getHours()).padStart(2, "0") + String(t.getMinutes()).padStart(2, "0");
  return (
    <div className="hseg" role="img" aria-label={d.slice(0, 2) + ":" + d.slice(2)} title="heure">
      {d.split("").map((c, i) => (
        <div key={i} className="hseg-digit" data-digit={c}>{Array.from({ length: 7 }, (_, k) => <div key={k} className="hseg-stroke" />)}</div>))}
    </div>
  );
}
