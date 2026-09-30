import React, { useState } from "react";
import { Fold, postJson } from "./_base.jsx";

export const meta = {"id": "note", "titre": "Note rapide", "icone": "✎", "categorie": "Assistant", "description": "Capture une idée en une ligne : elle part dans le vault (inbox), VLAD la retrouvera.", "colonne": "left", "requiert": [], "perso": false};

export default function NoteRapide() {
  const [txt, setTxt] = useState("");
  const [faites, setFaites] = useState([]);
  const [err, setErr] = useState("");
  const envoyer = async () => {
    const t = txt.trim(); if (!t) return;
    setErr("");
    try {
      const r = await postJson("/note", { texte: t });
      if (!r.ok) throw new Error(r.error);
      setTxt(""); setFaites((f) => [{ t, h: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), f: r.fichier }, ...f].slice(0, 3));
    } catch { setErr("non enregistrée — le pont répond-il ?"); }
  };
  return (
    <Fold id="note" title="Note rapide">
      <textarea className="w-input w-area" rows={2} value={txt} onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); } }}
        placeholder="Une idée, un nom, un lien… puis ↵" />
      {err && <p className="dim" style={{ color: "var(--warn)" }}>{err}</p>}
      {faites.map((n, i) => (
        <div key={i} className="mail-row"><b>{n.h} · {n.f}</b><span>{n.t}</span></div>
      ))}
    </Fold>
  );
}
