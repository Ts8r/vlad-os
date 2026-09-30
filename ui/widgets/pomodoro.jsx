import React, { useEffect, useState } from "react";
import { Fold } from "./_base.jsx";

export const meta = {"id": "pomodoro", "titre": "Pomodoro", "icone": "◷", "categorie": "Travail", "description": "Minuteur de concentration 25/5 ou 50/10, un son en fin de cycle.", "colonne": "right", "requiert": [], "perso": false};

const MODES = { court: [25, 5], long: [50, 10] };
const CLE = "vlad_pomodoro";   // survit au rechargement (par appareil : c'est un minuteur local)
const lire = () => { try { return JSON.parse(localStorage.getItem(CLE)) || {}; } catch { return {}; } };

function bip() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.3);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.32);
    });
  } catch {}
}

export default function Pomodoro() {
  const [s, setS] = useState(() => ({ mode: "court", phase: "focus", fin: null, reste: null, cycles: 0, ...lire() }));
  const [, tick] = useState(0);
  useEffect(() => { try { localStorage.setItem(CLE, JSON.stringify(s)); } catch {} }, [s]);
  useEffect(() => { if (!s.fin) return; const iv = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(iv); }, [s.fin]);

  const duree = (phase, mode = s.mode) => MODES[mode][phase === "focus" ? 0 : 1] * 60000;
  const restant = s.fin ? Math.max(0, s.fin - Date.now()) : (s.reste ?? duree(s.phase));
  useEffect(() => {
    if (s.fin && restant === 0) {
      bip();
      const suite = s.phase === "focus" ? "pause" : "focus";
      setS((x) => ({ ...x, phase: suite, fin: null, reste: null, cycles: x.cycles + (x.phase === "focus" ? 1 : 0) }));
    }
  });

  const lancer = () => setS((x) => ({ ...x, fin: Date.now() + restant, reste: null }));
  const pause = () => setS((x) => ({ ...x, fin: null, reste: restant }));
  const reset = () => setS((x) => ({ ...x, phase: "focus", fin: null, reste: null }));
  const mode = (m) => setS((x) => ({ ...x, mode: m, phase: "focus", fin: null, reste: null }));
  const mm = String(Math.floor(restant / 60000)).padStart(2, "0"), ss = String(Math.floor((restant % 60000) / 1000)).padStart(2, "0");
  const pct = 100 - (restant / duree(s.phase)) * 100;

  return (
    <Fold id="pomodoro" title="Pomodoro">
      <div className="pomo">
        <div className={`pomo-temps ${s.phase}`}>{mm}:{ss}</div>
        <div className="dim">{s.phase === "focus" ? "concentration" : "pause"} · {s.cycles} cycle{s.cycles > 1 ? "s" : ""} aujourd'hui</div>
        <div className="gauge-rail pomo-rail"><div className="gauge-fill" style={{ width: pct + "%" }} /></div>
        <div className="reu-actions">
          {s.fin ? <button className="reu-btn" onClick={pause}>❚❚ Pause</button> : <button className="reu-btn rec" onClick={lancer}>▶ {s.reste ? "Reprendre" : "Lancer"}</button>}
          <button className="reu-btn" onClick={reset}>↺</button>
          {Object.keys(MODES).map((k) => (
            <button key={k} className={`reu-btn ${s.mode === k ? "on" : ""}`} onClick={() => mode(k)}>{MODES[k].join("/")}</button>
          ))}
        </div>
      </div>
    </Fold>
  );
}
