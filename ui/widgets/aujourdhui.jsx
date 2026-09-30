import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";
import { useTracker, Ring, DAY7 } from "../progres.jsx";

export const meta = {"id": "aujourdhui", "titre": "Aujourd'hui", "icone": "◎", "categorie": "Quotidien", "description": "Tâches et habitudes du jour, clic = page Cap.", "colonne": "left", "requiert": [], "perso": false};

export default function ProgresWidget() {
  const onOpen = useHud().ouvrirPage?.bind(null, "cap");
  const [t, act] = useTracker();
  const [draft, setDraft] = useState("");
  const tasks = t ? (t.tasks[t.today] || []) : [];
  const done = tasks.filter((x) => x.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const dow0 = t ? (new Date(t.today + "T12:00:00").getDay() + 6) % 7 : 0;
  const habits = t ? t.habits.filter((h) => !h.ouvres || dow0 < 5) : [], hDone = t ? (t.habitLog[t.today] || []) : [];
  const add = async () => { const txt = draft.trim(); if (!txt || !t) return; setDraft(""); await act("/tracker/task", { text: txt, date: t.today }); };
  const dow = t ? (new Date(t.today + "T12:00:00").getDay() + 6) % 7 : 0;
  return (
    <Fold id="progres" title="Aujourd'hui">
      {!t && <p className="dim">connexion au pont…</p>}
      {t && (
        <>
          <div className="pw-head" onClick={onOpen} title="Ouvrir Cap">
            <Ring size={56} pct={pct} stroke={6} color={DAY7[dow]} glow font={12} />
            <div>
              <div className="pw-n">{done} <span className="dim">/ {tasks.length} tâches</span></div>
              <div className="dim">{hDone.length} / {habits.length} habitudes</div>
            </div>
            <span className="pw-open">◎</span>
          </div>
          <input className="w-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ajouter une tâche…" />
          <div className="todos">
            {tasks.length === 0 && <p className="dim">rien pour aujourd'hui — dis-le à VLAD</p>}
            {tasks.map((x) => (
              <div key={x.id} className={`todo ${x.done ? "done" : ""}`}>
                <button onClick={() => act("/tracker/task/toggle", { id: x.id, done: !x.done })}>{x.done ? "↺" : "✓"}</button>
                <span>{x.text}{x.url && <a className="pw-url" href={x.url} target="_blank" rel="noopener" title="Ouvrir">↗</a>}</span>
                <button onClick={() => act("/tracker/task/delete", { id: x.id })}>×</button>
              </div>
            ))}
          </div>
          {[...new Set(habits.map((h) => h.groupe || ""))].map((g) => (
            <div key={g || "_"} className="pw-group">
              {g && <div className="pw-gname">{g}</div>}
              <div className="pw-habits">
                {habits.filter((h) => (h.groupe || "") === g).map((h) => { const on = hDone.includes(h.nom); return (
                  <button key={h.nom} className={`pw-hab ${on ? "on" : ""}`} onClick={() => act("/tracker/habit", { habit: h.nom, date: t.today, done: !on })}>{h.nom}</button>); })}
              </div>
            </div>))}
        </>
      )}
    </Fold>
  );
}
