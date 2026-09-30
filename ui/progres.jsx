/* ═══════════════════════════════════════════════════════════════
   VLAD — SUIVI : tâches de travail (semaine) + habitudes (mois) + rapport,
   affichés en onglets dans la page Agenda.
   Structure = template de référence « Quiet Progress », bloc par bloc, dans
   l'identité porcelaine VLAD. Données : tracker.json via le pont (partagées
   Mac / iPhone / Telegram — la voix écrit au même endroit).
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { HorlogeSegments } from "./horloge-segments.jsx";
import "./progres.css";

const BRIDGE = "/api";
const WEEK = ["#a3aed2", "#7f8dbe", "#5c6ea8", "#3f5488", "#2a3a66"];
export const DAY7 = ["#a3aed2", "#8d9ac5", "#7887b7", "#6273a9", "#4d5f99", "#3b4d84", "#2a3a66"];
const ENE = "#c0507f", FOC = "#c4892a", MOT = "#3f5fa8";
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = (k) => { const d = new Date(k + "T12:00:00"); return addDays(k, -((d.getDay() + 6) % 7)); };
const fmtDate = (k) => k.slice(8, 10) + "." + k.slice(5, 7) + "." + k.slice(0, 4);

async function post(path, body) {
  const r = await fetch(BRIDGE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export function Ring({ size, pct, stroke, color = "#4b6398", glow, font }) {
  const r = size / 2 - stroke - 2, c = 2 * Math.PI * r, fs = font || Math.max(11, Math.round(size * 0.19));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pg-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(75,99,152,.14)" strokeWidth={stroke} />
      {pct > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={glow ? { filter: "drop-shadow(0 0 6px rgba(75,99,152,.45))" } : undefined} />}
      <text x={size / 2} y={size / 2 + fs * 0.36} textAnchor="middle" fontSize={fs} fill={pct ? "#38406A" : "#7a84a6"}>{pct}%</text>
    </svg>
  );
}
const Tick = ({ s = 9 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>;

/* ── hook données : polling 4 s (la voix / Telegram écrivent côté serveur) ── */
export function useTracker() {
  const [t, setT] = useState(null);
  const load = () => fetch(BRIDGE + "/tracker").then((r) => r.json()).then(setT).catch(() => {});
  useEffect(() => { load(); const iv = setInterval(load, 4000); return () => clearInterval(iv); }, []);
  const act = async (path, body) => { await post(path, body).catch(() => {}); load(); };
  return [t, act];
}

/* ── agenda : Google (pro / perso…) + Calendly, groupés par jour local — la page
   montre ainsi qu'un mardi de cours n'a « pas grand-chose à remplir » ── */
function useAgenda() {
  const [ev, setEv] = useState({});
  useEffect(() => {
    const load = async () => {
      const out = {};
      const push = (e, cal) => {
        const d = new Date(e.start); const k = iso(d);
        const hm = (x) => new Date(x).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
        const normRdv = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 40);
        (out[k] ||= []).push({ time: e.allDay ? "journée" : hm(e.start) + (e.end ? "–" + hm(e.end) : ""), title: e.title + (e.who ? " · " + e.who : ""), cal, t: d.getTime(), cle: k + "|" + normRdv(e.title), titre: e.title });
      };
      try { const c = await (await fetch(BRIDGE + "/calendar")).json(); (c.events || []).forEach((e) => push(e, e.cal || "pro")); } catch {}
      try { const c = await (await fetch(BRIDGE + "/calendly")).json(); (c.events || []).forEach((e) => push(e, "client")); } catch {}
      Object.values(out).forEach((l) => l.sort((a, b) => a.t - b.t));
      setEv(out);
    };
    load(); const iv = setInterval(load, 300000); return () => clearInterval(iv);
  }, []);
  return ev;
}

/* ═══ VUE SEMAINE — fidèle au « Task Tracker » ═══ */
function Semaine({ t, act, week, setWeek }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const agenda = useAgenda();
  const [draft, setDraft] = useState(""); const [draftDay, setDraftDay] = useState(t.today);
  const [freq, setFreq] = useState("une fois");

  const tasksOf = (k) => t.tasks[k] || [];
  const done = days.reduce((n, k) => n + tasksOf(k).filter((x) => x.done).length, 0);
  const total = days.reduce((n, k) => n + tasksOf(k).length, 0);
  const pctW = total ? Math.round((done / total) * 100) : 0;
  const mind = (k) => t.mind[k];
  const add = async () => { const txt = draft.trim(); if (!txt) return; setDraft(""); await act("/tracker/task", { text: txt, date: draftDay, freq }); setFreq("une fois"); };
  // uniquement les jours renseignés : pas de retombée à zéro entre deux check-ins
  const pts = (key) => days.map((k, i) => (mind(k) ? [12 + i * 44, 78 - mind(k)[key] * 6.4] : null)).filter(Boolean);
  const daysRef = React.useRef(null);
  useEffect(() => {   // mobile : ouvrir le défilement des jours sur aujourd'hui
    const el = daysRef.current; if (!el || window.innerWidth > 760) return;
    const i = days.indexOf(t.today); const card = el.children[i]; if (card) el.scrollLeft = card.offsetLeft - 20;
  }, [week]);
  const hasMind = days.some((k) => mind(k));
  return (
    <>
      <div className="pg-top">
        <div className="pg-card pg-title">
          <div className="pg-big">Suivi des tâches</div>
          <div className="pg-sub">Semaine du</div>
          <div className="pg-weeknav">
            <button onClick={() => setWeek(addDays(week, -7))} title="Semaine précédente">‹</button>
            <span className="pg-badge">{fmtDate(week)}</span>
            <button onClick={() => setWeek(addDays(week, 7))} title="Semaine suivante">›</button>
          </div>
        </div>
        <div className="pg-card pg-overall">
          <div style={{ flex: 1 }}>
            <p className="pg-h">Progression globale</p>
            <div className="pg-bars">
              {days.map((k, i) => { const n = tasksOf(k).filter((x) => x.done).length; return (
                <div key={k}><span>{n || ""}</span><i style={{ height: 8 + n * 11, background: n ? DAY7[i] : "rgba(75,99,152,.18)" }} /><span>{JOURS[i][0]}</span></div>); })}
            </div>
          </div>
          <div className="pg-center"><Ring size={112} pct={pctW} stroke={10} glow font={22} /><span className="pg-mono">{done} / {total} faites</span></div>
        </div>
        <div className="pg-card">
          <div className="pg-legendrow"><p className="pg-h" style={{ margin: 0 }}>État d'esprit</p>
            <div className="pg-legend"><span><i style={{ background: ENE }} />Énergie</span><span><i style={{ background: FOC }} />Focus</span><span><i style={{ background: MOT }} />Motivation</span></div></div>
          <svg width="100%" height="96" viewBox="0 0 290 96" preserveAspectRatio="none" className="pg-chart">
            <line x1="8" y1="82" x2="282" y2="82" stroke="rgba(75,99,152,.14)" />
            {hasMind && [["e", ENE], ["f", FOC], ["m", MOT]].map(([key, col]) => { const p = pts(key); return (
              <React.Fragment key={key}>
                {p.length > 1 && <polyline points={p.map(([x, y]) => x + "," + y).join(" ")} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />}
                {p.map(([x, y]) => <circle key={x} cx={x} cy={y} r="3" fill="#fff" stroke={col} strokeWidth="2" />)}
              </React.Fragment>); })}
            {!hasMind && <text x="145" y="48" textAnchor="middle" fontSize="10" fill="#7a84a6">pas encore de check-in cette semaine</text>}
            {JOURS.map((j, i) => <text key={j} x={12 + i * 44} y="94" textAnchor="middle" fontSize="9" fill="#6e799d">{j[0]}</text>)}
          </svg>
        </div>
      </div>

      <div className="pg-days" ref={daysRef}>
        {days.map((k, i) => {
          const ts = tasksOf(k), nd = ts.filter((x) => x.done).length, pct = ts.length ? Math.round((nd / ts.length) * 100) : 0, m = mind(k) || {};
          return (
            <div key={k} className={`pg-card pg-day ${k === t.today ? "today" : ""}`}>
              <div><div className="pg-dn">{JOURS[i]}</div><div className="pg-dd">{fmtDate(k)}{k === t.today ? " · aujourd'hui" : ""}</div></div>
              <div className="pg-center"><Ring size={96} pct={pct} stroke={9} color={DAY7[i]} glow={k === t.today} font={17} /></div>
              {(agenda[k] || []).length > 0 && (
                <div className="pg-agenda">
                  {agenda[k].slice(0, 4).map((e, j) => {
                    const r = (t.rdv || {})[e.cle]; const passe = e.t <= Date.now();
                    return (
                      <div key={j} className={`pg-ev ${e.cal} ${r ? r.statut : ""} ${passe ? "passe" : ""}`}
                        title={passe ? (r ? "re-cliquer pour décocher" : "cliquer si tu y as assisté") : e.title}
                        onClick={() => { if (passe) act("/tracker/rdv", { cle: e.cle, titre: e.titre, statut: r ? "off" : "fait", note: r?.note || "" }); }}>
                        <span>{r ? (r.statut === "rate" ? "✗ " : "✓ ") : ""}{e.time}</span><i>{e.cal !== "pro" ? e.cal : ""}</i><b>{e.title}</b>
                        {r && r.note && <em className="pg-rdvnote">{r.note}</em>}
                      </div>);
                  })}
                </div>)}
              <div className="pg-sub">Tâches</div>
              <div className="pg-tasks">
                {ts.map((x) => (
                  <div key={x.id} className={`pg-task ${x.done ? "done" : ""}`} style={x.done ? { background: DAY7[i] + "38" } : undefined}>
                    {x.rid && <i className="pg-rep" title="tâche répétée">↻</i>}
                    <span onClick={() => act("/tracker/task/toggle", { id: x.id, done: !x.done })}>{x.text}</span>
                    {x.url && <a className="pg-url" href={x.url} target="_blank" rel="noopener" title="Ouvrir">↗</a>}
                    <button className="pg-del" title="Supprimer" onClick={() => {
                      if (!x.rid) return act("/tracker/task/delete", { id: x.id });
                      if (confirm("Tâche répétée — la retirer seulement CE jour ?")) return act("/tracker/recurrent/skip", { rid: x.rid, date: k });
                      if (confirm("Supprimer TOUTE la répétition (ce jour et les suivants) ?")) act("/tracker/recurrent/delete", { rid: x.rid });
                    }}>×</button>
                    <button className={`pg-box ${x.done ? "on" : ""}`} style={x.done ? { background: DAY7[i], borderColor: DAY7[i] } : undefined}
                      onClick={() => act("/tracker/task/toggle", { id: x.id, done: !x.done })}>{x.done && <Tick />}</button>
                  </div>
                ))}
                {ts.length === 0 && <div className="pg-empty">—</div>}
              </div>
              <div className="pg-cnt"><span>Faites <b>{nd}</b></span><span>Restantes <b>{ts.length - nd}</b></span></div>
              <div className="pg-sub">Check-in mental</div>
              <div className="pg-mind">
                {[["Énergie", "e", ENE], ["Focus", "f", FOC], ["Motivation", "m", MOT]].map(([lab, key, col]) => (
                  <div key={key} style={{ background: col }}>{lab}
                    <select value={m[key] ?? ""} onChange={(e) => act("/tracker/mind", { date: k, e: key === "e" ? e.target.value : m.e ?? 0, f: key === "f" ? e.target.value : m.f ?? 0, m: key === "m" ? e.target.value : m.m ?? 0 })}>
                      <option value="">–</option>{Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
                    </select>
                  </div>))}
              </div>
            </div>
          );
        })}
      </div>

      <form className="pg-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <select value={draftDay} onChange={(e) => setDraftDay(e.target.value)}>{days.map((k, i) => <option key={k} value={k}>{JOURS[i]} {k.slice(8)}</option>)}</select>
        <select className="pg-freq" value={freq} onChange={(e) => setFreq(e.target.value)} title="Répétition">
          <option value="une fois">une fois</option><option value="jour">tous les jours</option>
          <option value="semaine">chaque semaine</option><option value="mois">chaque mois</option>
        </select>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Ajouter une tâche…" enterKeyHint="done" />
        <button type="submit">Ajouter</button>
        <span className="pg-mono pg-hint">ou dis-le à VLAD</span>
      </form>
    </>
  );
}

// liste → texte de l'éditeur (groupes en « # », « (7j) » quand tout le groupe l'est)
function habitsText(habits) {
  const out = []; let g = null;
  for (const h of habits) {
    const grp = h.groupe || "";
    if (grp !== g) { g = grp; if (grp) { const all7 = habits.filter((x) => (x.groupe || "") === grp).every((x) => !x.ouvres); out.push("# " + grp + (all7 ? " (7j)" : "")); } }
    const grp7 = grp && habits.filter((x) => (x.groupe || "") === grp).every((x) => !x.ouvres);
    out.push(h.nom + (!h.ouvres && !grp7 ? " (7j)" : ""));
  }
  return out.join("\n");
}
export { habitsText };

/* ═══ VUE HABITUDES — fidèle au « Habit Tracker » (mois) ═══ */
function Habitudes({ t, act, month, setMonth }) {
  const [y, mo] = month.split("-").map(Number);
  const nDays = new Date(y, mo, 0).getDate();
  const keys = Array.from({ length: nDays }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const dowOf = (k) => (new Date(k + "T12:00:00").getDay() + 6) % 7;
  // bandes hebdo : découpage lundi→dimanche à l'intérieur du mois
  const bands = []; let start = 0;
  keys.forEach((k, i) => { if (i > 0 && dowOf(k) === 0) { bands.push([start, i - 1]); start = i; } });
  bands.push([start, nDays - 1]);
  const bandOf = (i) => bands.findIndex(([a, b]) => i >= a && i <= b);
  const past = (k) => k <= t.today;
  // routine PRO (ouvres) = lun→ven seulement ; habitude PERSO = 7 j — les jours non
  // applicables ne comptent ni dans l'analyse ni dans les séries (sinon chaque week-end pénalise)
  const app = (h, k) => !h.ouvres || dowOf(k) < 5;
  const names = t.habits.map((h) => h.nom);
  const doneOn = (k, h) => (t.habitLog[k] || []).includes(h.nom);
  const doneCount = (k) => t.habits.filter((h) => app(h, k) && doneOn(k, h)).length;
  const dueCount = (k) => t.habits.filter((h) => app(h, k)).length;
  const H = t.habits.length;
  const totalDone = keys.filter(past).reduce((n, k) => n + doneCount(k), 0);
  const totalDue = keys.filter(past).reduce((n, k) => n + dueCount(k), 0);
  const pctMonth = totalDue ? Math.round((totalDone / totalDue) * 100) : 0;
  const rate = (h) => { const ks = keys.filter((k) => past(k) && app(h, k)); return ks.length ? ks.filter((k) => doneOn(k, h)).length / ks.length : 0; };
  const color = (r) => (r >= 0.65 ? "#2fae72" : r >= 0.35 ? "#c9a24f" : "#c94f63");
  const streak = (h) => { let n = 0, k = t.today; if (!doneOn(k, h)) k = addDays(k, -1); for (let g = 0; g < 400; g++) { if (app(h, k)) { if (!doneOn(k, h)) break; n++; } k = addDays(k, -1); } return n; };
  const best = t.habits.map((h) => [h.nom, streak(h)]).sort((a, b) => b[1] - a[1])[0] || ["—", 0];
  const monthLabel = new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const [editing, setEditing] = useState(false); const [habDraft, setHabDraft] = useState("");
  useEffect(() => {   // grilles ouvertes sur MAINTENANT : mobile → aujourd'hui, bureau → lundi de la semaine
    if (!keys.includes(t.today)) return;
    const cible = window.innerWidth <= 760 ? t.today : mondayOf(t.today);
    const idx = Math.max(0, keys.indexOf(cible));
    requestAnimationFrame(() => document.querySelectorAll(".pg-gridcard").forEach((card) => {
      const day = card.querySelectorAll(".pg-dow")[idx]; if (!day) return;
      const ancre = card.querySelector(".pg-grid .pg-corner, .pg-grid .pg-hab, .pg-grid .pg-pl"); if (!ancre) return;
      card.scrollLeft += day.getBoundingClientRect().left - ancre.getBoundingClientRect().right;
    }));
  }, [month, t.today]);
  useEffect(() => {   // glisser les jours à la SOURIS (le trackpad défile nativement) sans casser les clics
    const nettoyages = Array.from(document.querySelectorAll(".pg-gridcard")).map((card) => {
      let x0 = 0, s0 = 0, appui = false, glisse = false;
      const dn = (e) => { if (e.button !== 0) return; appui = true; glisse = false; x0 = e.clientX; s0 = card.scrollLeft; };
      const mv = (e) => { if (!appui) return; const dx = e.clientX - x0; if (!glisse && Math.abs(dx) > 6) glisse = true; if (glisse) card.scrollLeft = s0 - dx; };
      const up = () => { appui = false; setTimeout(() => (glisse = false), 0); };
      const ck = (e) => { if (glisse) { e.stopPropagation(); e.preventDefault(); } };
      card.addEventListener("pointerdown", dn); window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up); card.addEventListener("click", ck, true);
      return () => { card.removeEventListener("pointerdown", dn); window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up); card.removeEventListener("click", ck, true); };
    });
    return () => nettoyages.forEach((f) => f());
  }, []);
  const sx = (i) => 10 + i * (1352 / Math.max(1, nDays - 1));
  const line = keys.filter(past).map((k, i) => `${sx(i).toFixed(0)},${(118 - (dueCount(k) ? doneCount(k) / dueCount(k) : 0) * 96).toFixed(0)}`);
  const mindPts = (key) => keys.filter(past).map((k, i) => t.mind[k] ? `${sx(i).toFixed(0)},${(112 - t.mind[k][key] * 10).toFixed(0)}` : null).filter(Boolean);
  return (
    <>
      <div className="pg-kpis">
        <div className="pg-card pg-title">
          <div className="pg-weeknav"><button onClick={() => setMonth(mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`)}>‹</button>
            <div className="pg-big" style={{ textTransform: "capitalize" }}>{monthLabel}</div>
            <button onClick={() => setMonth(mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`)}>›</button></div>
          <div className="pg-mono pg-hint">— suivi d'habitudes —</div>
        </div>
        <div className="pg-card pg-kpi"><span>Nombre d'habitudes</span><b>{H}</b></div>
        <div className="pg-card pg-kpi"><span>Habitudes faites</span><b>{totalDone}</b></div>
        <div className="pg-card pg-kpi"><span>Progression</span><div className="pg-rail"><i style={{ width: pctMonth + "%" }} /></div></div>
        <div className="pg-card pg-kpi"><span>Meilleure série</span><b>{best[1]} j <small>{best[0]}</small></b></div>
      </div>

      <div className="pg-main">
        <div className="pg-card pg-gridcard">
          <div className="pg-legendrow"><p className="pg-h" style={{ margin: 0 }}>Mes habitudes</p>
            <button className="pg-lnk" onClick={() => { setHabDraft(habitsText(t.habits)); setEditing(!editing); }}>{editing ? "fermer" : "modifier la liste"}</button></div>
          {editing && (
            <div className="pg-edit">
              <textarea value={habDraft} onChange={(e) => setHabDraft(e.target.value)} rows={8} />
              <p className="pg-mono pg-hint">une par ligne · « # Groupe » ouvre un groupe · jours ouvrés par défaut · « (7j) » sur une ligne ou un groupe = tous les jours</p>
              <button onClick={async () => { await act("/tracker/habits", { habits: habDraft.split("\n") }); setEditing(false); }}>Enregistrer</button>
            </div>)}
          <div className="pg-grid" style={{ gridTemplateColumns: `var(--lblw, 210px) repeat(${nDays}, minmax(var(--cellw, 46px), 1fr))` }}>
            <div className="pg-corner" />
            {bands.map(([a, b], i) => <div key={i} className="pg-band" style={{ gridColumn: `span ${b - a + 1}`, background: WEEK[i % 5], color: i % 5 === 0 ? "#38406A" : "#fff" }}>Semaine {i + 1}</div>)}
            <div className="pg-corner" />
            {keys.map((k, i) => <div key={k} className={`pg-dow ${k === t.today ? "today" : ""}`}>{"LMMJVSD"[dowOf(k)]}<br />{i + 1}</div>)}
            {t.habits.map((h, hi) => (
              <React.Fragment key={h.nom}>
                {h.groupe && (hi === 0 || t.habits[hi - 1].groupe !== h.groupe) && <div className="pg-group" style={{ gridColumn: `span ${nDays + 1}` }}><span className="pg-gin">{h.groupe}<small>{t.habits.filter((x) => x.groupe === h.groupe).every((x) => x.ouvres) ? "lun – ven" : t.habits.filter((x) => x.groupe === h.groupe).every((x) => !x.ouvres) ? "7 jours" : "mixte"}</small></span></div>}
                <div className="pg-hab">{h.nom}</div>
                {keys.map((k, i) => {
                  const on = doneOn(k, h), col = WEEK[bandOf(i) % 5], na = !app(h, k);
                  return <button key={k} className={`pg-c ${!past(k) ? "f" : ""} ${na ? "na" : ""} ${k === t.today ? "td" : ""}`} disabled={!past(k) || na} style={on ? { background: col, borderColor: col } : undefined}
                    onClick={() => act("/tracker/habit", { habit: h.nom, date: k, done: !on })}>{on && <Tick s={8} />}</button>;
                })}
              </React.Fragment>))}
          </div>
          <div className="pg-grid pg-prog" style={{ gridTemplateColumns: `var(--lblw, 210px) repeat(${nDays}, minmax(var(--cellw, 46px), 1fr))` }}>
            <div className="pg-pl">Progression</div>{keys.map((k) => <div key={k} className={`pg-pv ${k === t.today ? "td" : ""}`}>{past(k) && dueCount(k) ? Math.round((doneCount(k) / dueCount(k)) * 100) + "%" : "·"}</div>)}
            <div className="pg-pl">Faites</div>{keys.map((k) => <div key={k} className={`pg-pv ${k === t.today ? "td" : ""}`}>{past(k) ? doneCount(k) : "·"}</div>)}
            <div className="pg-pl">Manquées</div>{keys.map((k) => <div key={k} className={`pg-pv ${k === t.today ? "td" : ""}`}>{past(k) ? dueCount(k) - doneCount(k) : "·"}</div>)}
          </div>
        </div>
        <div className="pg-card pg-analyse">
          <p className="pg-h">Analyse</p>
          {t.habits.map((h, hi) => { const r = rate(h); return (<React.Fragment key={h.nom}>
            {h.groupe && (hi === 0 || t.habits[hi - 1].groupe !== h.groupe) && <div className="pg-pl" style={{ margin: "6px 0 2px" }}>{h.groupe}</div>}
            <div className="pg-bar"><span>{h.nom}</span><i style={{ width: r * 100 + "%", background: color(r) }} /><em>{Math.round(r * 100)}%</em></div></React.Fragment>); })}
        </div>
      </div>

      <div className="pg-card"><p className="pg-h">Progression quotidienne</p>
        <svg width="100%" height="132" viewBox="0 0 1372 132" preserveAspectRatio="none" className="pg-chart">
          {[1, 2, 3, 4].map((k) => <React.Fragment key={k}><line x1="10" y1={118 - k * 24} x2="1362" y2={118 - k * 24} stroke="rgba(75,99,152,.10)" /><text x="0" y={121 - k * 24} fontSize="8" fill="#6e799d">{k * 25}%</text></React.Fragment>)}
          {line.length > 1 && <><polygon points={`10,118 ${line.join(" ")} ${line[line.length - 1].split(",")[0]},118`} fill="rgba(75,99,152,.16)" /><polyline points={line.join(" ")} fill="none" stroke="#4b6398" strokeWidth="2" strokeLinejoin="round" /></>}
        </svg></div>

      <div className="pg-main">
        <div className="pg-card pg-gridcard"><p className="pg-h">État mental</p>
          <div className="pg-grid" style={{ gridTemplateColumns: `var(--lblw, 210px) repeat(${nDays}, minmax(var(--cellw, 46px), 1fr))` }}>
            <div className="pg-corner" />{bands.map(([a, b], i) => <div key={i} className="pg-band" style={{ gridColumn: `span ${b - a + 1}`, background: WEEK[i % 5], color: i % 5 === 0 ? "#38406A" : "#fff" }}>Semaine {i + 1}</div>)}
            <div className="pg-corner" />{keys.map((k, i) => <div key={k} className={`pg-dow ${k === t.today ? "today" : ""}`}>{"LMMJVSD"[dowOf(k)]}<br />{i + 1}</div>)}
            {[["Énergie", "e"], ["Focus", "f"], ["Motivation", "m"]].map(([lab, key]) => <React.Fragment key={key}><div className="pg-pl">{lab}</div>{keys.map((k) => <div key={k} className={`pg-pv ${k === t.today ? "td" : ""}`}>{t.mind[k] ? t.mind[k][key] : "·"}</div>)}</React.Fragment>)}
            <div className="pg-pl">Score</div>{keys.map((k) => <div key={k} className={`pg-pv ${k === t.today ? "td" : ""}`}>{t.mind[k] ? Math.round(((t.mind[k].e + t.mind[k].f + t.mind[k].m) / 3) * 10) + "%" : "·"}</div>)}
          </div></div>
        <div className="pg-card pg-analyse"><p className="pg-h">Analyse</p>
          {[["Énergie", "e", ENE], ["Focus", "f", FOC], ["Motivation", "m", MOT]].map(([lab, key, col]) => (
            <React.Fragment key={key}><div className="pg-pl" style={{ margin: "6px 0 4px" }}>{lab}</div>
              {bands.map(([a, b], i) => { const vs = keys.slice(a, b + 1).filter((k) => t.mind[k]).map((k) => t.mind[k][key]); const v = vs.length ? Math.round((vs.reduce((s, x) => s + x, 0) / vs.length) * 10) : 0;
                return <div key={i} className="pg-bar pg-bar-s"><span>Semaine {i + 1}</span><i style={{ width: v + "%", background: v ? col : "transparent" }} /><em>{v ? v + "%" : "–"}</em></div>; })}
            </React.Fragment>))}
        </div>
      </div>

      <div className="pg-card">
        <div className="pg-legendrow"><p className="pg-h" style={{ margin: 0 }}>Énergie · focus · motivation</p>
          <div className="pg-legend"><span><i style={{ background: ENE }} />Énergie</span><span><i style={{ background: FOC }} />Focus</span><span><i style={{ background: MOT }} />Motivation</span></div></div>
        <svg width="100%" height="124" viewBox="0 0 1372 124" preserveAspectRatio="none" className="pg-chart">
          {[1, 2, 3, 4].map((k) => <React.Fragment key={k}><line x1="10" y1={112 - k * 25} x2="1362" y2={112 - k * 25} stroke="rgba(75,99,152,.10)" /><text x="0" y={115 - k * 25} fontSize="8" fill="#6e799d">{k * 25}%</text></React.Fragment>)}
          {[["e", ENE], ["f", FOC], ["m", MOT]].map(([key, col]) => mindPts(key).length > 1 && <polyline key={key} points={mindPts(key).join(" ")} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />)}
        </svg></div>
    </>
  );
}

/* ═══ VUE RAPPORT ═══ */
function Rapport() {
  const [r, setR] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => fetch(BRIDGE + "/rapport").then((x) => x.json()).then(setR).catch(() => {});
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);
  return (
    <div className="pg-card pg-rapport">
      <div className="pg-legendrow"><p className="pg-h" style={{ margin: 0 }}>Bilan de la semaine</p>
        <button className="pg-btn" disabled={busy} onClick={async () => { setBusy(true); await post("/rapport", {}); setTimeout(() => setBusy(false), 20000); }}>{busy ? "VLAD rédige…" : "Générer maintenant"}</button></div>
      <p className="pg-mono pg-hint">Automatique chaque dimanche à 20 h — texte ici, et voix sur Telegram.</p>
      {r?.texte ? <p className="pg-text">{r.texte}</p> : <p className="pg-empty">Aucun bilan encore. Le premier arrivera dimanche soir.</p>}
      {r?.at && <p className="pg-mono pg-hint">{new Date(r.at).toLocaleString("fr-FR")}</p>}
    </div>
  );
}

/* ═══ VUES DE SUIVI, affichées en onglets dans la page Agenda ═══ */
export const VUES_SUIVI = [["semaine", "SEMAINE"], ["habitudes", "HABITUDES"], ["rapport", "RAPPORT"]];
export function Suivi({ vue }) {
  const [t, act] = useTracker();
  const [week, setWeek] = useState(() => mondayOf(iso(new Date())));
  const [month, setMonth] = useState(() => iso(new Date()).slice(0, 7));
  if (vue === "rapport") return <Rapport />;
  if (!t) return <p className="pg-empty">chargement…</p>;
  return vue === "habitudes" ? <Habitudes t={t} act={act} month={month} setMonth={setMonth} /> : <Semaine t={t} act={act} week={week} setWeek={setWeek} />;
}
