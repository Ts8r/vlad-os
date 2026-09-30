import React, { useEffect, useState } from "react";
import { Fold, useWidgetConfig } from "./_base.jsx";

export const meta = {"id": "meteo", "titre": "Météo", "icone": "☀", "categorie": "Quotidien", "description": "Maintenant et 3 jours, pour la ville de ton choix. Open-Meteo, sans clé.", "colonne": "right", "requiert": [], "perso": false};

// codes WMO → pictogramme + libellé court
const WMO = [[0, "☀", "dégagé"], [1, "🌤", "peu nuageux"], [2, "⛅", "nuageux"], [3, "☁", "couvert"], [45, "🌫", "brouillard"],
  [51, "🌦", "bruine"], [61, "🌧", "pluie"], [66, "🌧", "pluie verglaçante"], [71, "🌨", "neige"], [80, "🌦", "averses"], [85, "🌨", "averses de neige"], [95, "⛈", "orage"]];
const ciel = (c) => [...WMO].reverse().find(([k]) => c >= k) || WMO[0];

export default function Meteo() {
  const [lieu, setLieu] = useWidgetConfig("meteo", null);   // { nom, lat, lon }
  const [reglage, setReglage] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [m, setM] = useState(null);

  useEffect(() => {
    if (!lieu) return;
    let alive = true;
    const load = () => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lieu.lat}&longitude=${lieu.lon}` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4")
      .then((r) => r.json()).then((d) => alive && setM(d)).catch(() => {});
    load();
    const iv = setInterval(load, 900000);   // 15 min
    return () => { alive = false; clearInterval(iv); };
  }, [lieu?.lat, lieu?.lon]);

  const chercher = async () => {
    setErr("");
    try {
      const d = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=" + encodeURIComponent(q.trim())).then((r) => r.json());
      const r = d.results?.[0];
      if (!r) return setErr("ville introuvable");
      setLieu({ nom: r.name, lat: r.latitude, lon: r.longitude }); setReglage(false); setM(null);
    } catch { setErr("recherche impossible"); }
  };

  const edit = !lieu || reglage;
  return (
    <Fold id="meteo" title="Météo"
      extra={lieu && <button className="w-fold" onClick={() => setReglage((r) => !r)} title="Changer de ville">⚙</button>}>
      {edit && (
        <div className="w-reglages">
          <input className="w-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && chercher()} placeholder="Ta ville, puis ↵" />
          {err && <p className="dim">{err}</p>}
        </div>
      )}
      {!edit && !m && <p className="dim">chargement…</p>}
      {!edit && m?.current && (() => {
        const [, ic, lib] = ciel(m.current.weather_code);
        return (
          <>
            <div className="met-now">
              <span className="met-ic">{ic}</span>
              <b>{Math.round(m.current.temperature_2m)}°</b>
              <span className="dim">{lieu.nom} · {lib} · ressenti {Math.round(m.current.apparent_temperature)}° · vent {Math.round(m.current.wind_speed_10m)} km/h</span>
            </div>
            <div className="met-jours">
              {m.daily.time.slice(1, 4).map((t, i) => (
                <div key={t} className="met-j">
                  <span>{new Date(t + "T12:00").toLocaleDateString("fr-FR", { weekday: "short" })}</span>
                  <span className="met-ic sm">{ciel(m.daily.weather_code[i + 1])[1]}</span>
                  <b>{Math.round(m.daily.temperature_2m_max[i + 1])}°</b>
                  <i>{Math.round(m.daily.temperature_2m_min[i + 1])}° · {m.daily.precipitation_probability_max[i + 1] ?? 0}%</i>
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </Fold>
  );
}
