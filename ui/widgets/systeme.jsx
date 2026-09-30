import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";

export const meta = {"id": "systeme", "titre": "Système", "icone": "▤", "categorie": "Système", "description": "CPU, RAM, disque, batterie et état du cerveau, de l'oreille et de la voix.", "colonne": "right", "requiert": [], "perso": false};

export default function SystemWidget() {
  const [t, setT] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(BRIDGE + "/telemetry").then((r) => r.json()).then((d) => alive && setT(d)).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return (
    <Fold id="systeme" title="Système">
      {!t && <p className="dim">connexion au pont…</p>}
      {t && <>
      <Gauge label="CPU" pct={t.cpuLoad} warn={85} />
      <Gauge label="RAM" pct={t.ramUsedPct} warn={92} />
      <Gauge label="DISQUE" pct={t.diskUsedPct} text={t.diskFreeGb + " Go libres"} warn={90} />
      {t.battery != null && <Gauge label="BATTERIE" pct={t.battery} text={t.battery + "%" + (t.charging ? " ⚡" : "")} />}
      {t.authExpired && <p className="dim" style={{ color: "#c0392b" }}>⚠ session Claude expirée — « claude auth login » sur le Mac</p>}
      <div className="sys-row">
        <span className={`led ${t.authExpired ? "" : t.brain ? "on" : ""}`} />cerveau
        <span className={`led ${t.stt ? "on" : ""}`} />oreille
        <span className={`led ${t.tts ? "on" : ""}`} />voix
      </div>
      <div className="sys-meta">
        {t.model} · {t.turns} tours · {t.lastMs ? Math.round(t.lastMs / 100) / 10 + " s" : "—"} · {t.costUSD} $
      </div>
      <div className="sys-meta">vault : {t.vaultNotes} notes</div>
      </>}
    </Fold>
  );
}
