/* ═══════════════════════════════════════════════════════════════
   VLAD — AGENDA : horloge à segments (coin de TOUTES les pages), cadran
   circulaire jour/mois/date (accueil, haut-gauche), bandeau semaine
   interactif (accueil) et page Agenda complète (mois → jour, frise avec
   icônes). Références : CodePens, traduits dans la porcelaine.
   Données : /calendar (Google, multi-calendriers) + /calendly (clients) +
   pointage des rendez-vous du tracker (même clé que Progrès).
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from "react";
import { HorlogeSegments } from "./horloge-segments.jsx";
import "./agenda.css";

const BRIDGE = "/api";
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const dowOf = (k) => (new Date(k + "T12:00:00").getDay() + 6) % 7;
const mondayOf = (k) => addDays(k, -dowOf(k));
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const J3 = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const M3 = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛ", "SEP", "OCT", "NOV", "DÉC"];
const normRdv = (x) => String(x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 40);
const hm = (x) => new Date(x).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
const duree = (e) => {
  if (e.allDay) return "journée"; if (!e.end) return "";
  const m = Math.round((new Date(e.end) - new Date(e.start)) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`;
};
async function post(path, body) {
  const r = await fetch(BRIDGE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

/* ── banque d'icônes (trait, 24×24) choisies d'après le titre / le lieu ── */
const ICONES = {
  etude: <><path d="M2 9l10-5 10 5-10 5-10-5z" /><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" /><path d="M22 9v5" /></>,
  repas: <><path d="M7 3v9M5 3v5a2 2 0 0 0 4 0V3M7 12v9" /><path d="M17 3c-1.7 0-3 2.2-3 5v4h3v9" /></>,
  pause: <><path d="M4 9h12v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" /><path d="M16 11h2a2 2 0 0 1 0 4h-2M7 6c0-1 1-1.2 1-2.3M11 6c0-1 1-1.2 1-2.3M4 21h14" /></>,
  appel: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  visio: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 10l6-3v10l-6-3" /></>,
  client: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M17 3a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6" /></>,
  ordi: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>,
  sante: <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" />,
  marche: <><circle cx="13" cy="3.5" r="1.5" /><path d="M8 22l3-8 3 2v6M9 12l2-5 4 2 2 3h3M11 7l-3 2-2 4" /></>,
  fete: <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z" />,
  agenda: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /><circle cx="12" cy="14.5" r="1.2" fill="currentColor" /></>,
  lever: <><circle cx="12" cy="13" r="4" /><path d="M12 3v2M4.2 6.2l1.4 1.4M2 13h2M20 13h2M18.4 6.2L17 7.6M3 20h18" /></>,
  coucher: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /><path d="M17 3l.7 1.6L19.3 5l-1.6.7L17 7.3l-.7-1.6L14.7 5l1.6-.4z" /></>,
  trajet: <><path d="M4 15l1.6-5A2 2 0 0 1 7.5 8.5h9a2 2 0 0 1 1.9 1.5L20 15v4H4z" /><circle cx="7.5" cy="16" r="1.4" /><circle cx="16.5" cy="16" r="1.4" /><path d="M4 15h16" /></>,
  libre: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01" /></>,
  journal: <><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4v5h5M8 13h8M8 17h6" /></>,
  douche: <><path d="M4 21V7a4 4 0 0 1 4-4h1a3 3 0 0 1 3 3v1" /><path d="M8 8h8M10 11v1M13 11v1M16 11v1M9 14v1M12 14v1M15 14v1M11 17v1M14 17v1" /></>,
  famille: <path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.6 12 20 12 20z" />,
};
const REGLES = [
  [/\blever\b|réveil|reveil/i, "lever"],
  [/coucher|dodo|nuit\b/i, "coucher"],
  [/trajet|route|voiture|train|bus\b/i, "trajet"],
  [/journal/i, "journal"],
  [/temps libre|repos|détente|detente/i, "libre"],
  [/douche|bain\b/i, "douche"],
  [/histoire|enfant|famille/i, "famille"],
  [/marche|rando|vélo|velo|natation|sport|salle de sport/i, "marche"],
  [/école|ecole|cours|examen|révision|revision/i, "etude"],
  [/déjeuner|dejeuner|dîner|diner|repas|resto|petit.?déj|brunch|apéro|apero/i, "repas"],
  [/pause|clope|café|cafe|sieste/i, "pause"],
  [/teams|meet|zoom|visio|webinar/i, "visio"],
  [/appel|call|tél|tel\b|phone|téléphone/i, "appel"],
  [/client|calendly|devis|prospect|signature|contrat/i, "client"],
  [/dev|code|site|maintenance|déploiement|deploy|sprint|review|ordi|pc\b/i, "ordi"],
  [/médecin|medecin|dentiste|santé|sante|kiné|kine|ophtalmo|pharma/i, "sante"],
  [/anniversaire|fête|fete|mariage|soirée|soiree|concert/i, "fete"],
];
export const iconeDe = (e) => {
  const txt = `${e.title || ""} ${e.place || ""} ${e.cal || ""}`;
  if (e.cal === "client") return ICONES.client;
  if (e.cal === "école" || e.cal === "ecole") return ICONES.etude;
  for (const [re, k] of REGLES) if (re.test(txt)) return ICONES[k];
  return ICONES.agenda;
};

/* ── événements par jour (Google + Calendly), clé de pointage partagée avec Progrès ── */
export function useEvenements(mois) {
  const [ev, setEv] = useState({});
  useEffect(() => {
    let vivant = true;
    const load = async () => {
      const out = {};
      const push = (e, cal) => {
        const d = new Date(e.start); const k = iso(d);
        (out[k] ||= []).push({ ...e, cal, k, t: d.getTime(), cle: k + "|" + normRdv(e.title), titre: e.title,
          title: e.title + (e.who ? " · " + e.who : "") });
      };
      try { const c = await (await fetch(BRIDGE + (mois ? "/calendar/mois/" + mois : "/calendar"))).json(); (c.events || []).forEach((e) => push(e, e.cal || "pro")); } catch {}
      try { const c = await (await fetch(BRIDGE + "/calendly")).json(); (c.events || []).forEach((e) => push(e, "client")); } catch {}
      Object.values(out).forEach((l) => l.sort((a, b) => a.t - b.t));
      if (vivant) setEv(out);
    };
    load(); const iv = setInterval(load, 300000);
    return () => { vivant = false; clearInterval(iv); };
  }, [mois]);
  return ev;
}

export { HorlogeSegments };

/* ═══ BANDEAU SEMAINE — accueil, suivi réduit (réf. CodePen « calendar week ») ═══ */
export function AgendaSemaine({ onOpen }) {
  const evs = useEvenements();
  const today = iso(new Date()); const lundi = mondayOf(today);
  const mobile = typeof window !== "undefined" && window.innerWidth <= 760;
  const days = mobile ? Array.from({ length: 3 }, (_, i) => addDays(today, i)) : Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const [sel, setSel] = useState(null);
  const idx = sel ? days.indexOf(sel) : -1;
  return (
    <div className={`ags ${sel ? "active" : ""}`}>
      <div className="ags-head">
        <p>{JOURS[dowOf(today)]} {today.slice(8)}.{today.slice(5, 7)}.{today.slice(2, 4)}</p>
        <p><strong>Agenda</strong></p>
      </div>
      <div className="ags-mask">
        <div className="ags-week" style={{ marginLeft: !mobile && idx > 0 ? -idx * 138 : 0 }}>
          {days.map((k, i) => { const l = evs[k] || []; const on = sel === k; return (
            <button key={k} className={`ags-day ${on ? "on" : ""} ${k === today ? "today" : ""}`} onClick={() => setSel(on ? null : k)}>
              <p><span className="dotw">{J3[dowOf(k)]}</span><span className="date">{k.slice(8)}</span></p>
              <div className="ags-list">
                {l.slice(0, on ? 6 : 2).map((e, j) => <span key={j} className={"ags-ev " + e.cal}><i />{e.allDay ? "" : hm(e.start) + " "}{e.title}</span>)}
                {l.length === 0 && <span className="ags-ev vide">rien de prévu</span>}
                {!on && l.length > 2 && <span className="ags-ev vide">+{l.length - 2}</span>}
              </div>
            </button>); })}
        </div>
      </div>
      <button className="ags-btn" onClick={onOpen}>◉ Agenda complet</button>
    </div>
  );
}

/* ═══ PAGE AGENDA — mois (grille de cartes) → jour (frise horaire) ═══ */
export default function AgendaPage({ onClose, jourInitial }) {
  const today = iso(new Date());
  const [jour, setJour] = useState(jourInitial || null);
  const [mois, setMois] = useState((jourInitial || today).slice(0, 7));
  const evs = useEvenements(mois);
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(false); const [texte, setTexte] = useState("");
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setTick(Date.now()), 60000); return () => clearInterval(i); }, []);
  const loadT = () => fetch(BRIDGE + "/tracker").then((r) => r.json()).then(setT).catch(() => {});
  useEffect(() => { loadT(); const iv = setInterval(loadT, 5000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") jour ? setJour(null) : onClose?.(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [jour]);
  const [y, m] = mois.split("-").map(Number);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(mondayOf(`${mois}-01`), i));
  const nav = (n) => { const d = new Date(y, m - 1 + n, 1); setMois(iso(d).slice(0, 7)); };
  const allerAu = (k) => { setJour(k); if (k.slice(0, 7) !== mois) setMois(k.slice(0, 7)); };
  const pointer = async (e) => { const r = (t?.rdv || {})[e.cle]; await post("/tracker/rdv", { cle: e.cle, titre: e.titre, statut: r ? "off" : "fait", note: r?.note || "" }).catch(() => {}); loadT(); };
  const fmtLong = (k) => `${JOURS[dowOf(k)]} ${+k.slice(8)} ${MOIS[+k.slice(5, 7) - 1].toLowerCase()}`;
  // ── déroulé du jour : gabarit (jour ouvré / jour d’école / week-end) + vrais rendez-vous ──
  const catDe = (x) => Object.keys(ICONES).find((k) => ICONES[k] === iconeDe(x));
  // descriptif d'un événement long : séances « 09:00–12:30 et 13:30–17:00 », pauses « 12:30–13:30 », salles, formateur
  const lireDesc = (e) => {
    const out = { seances: [], pauses: [], salle: {}, formateur: "" };
    const jour = e.k; const heure = (h, m) => new Date(`${jour}T${h.padStart(2, "0")}:${m}:00`).getTime();
    for (const l of String(e.desc || "").split("\n")) {
      const t = l.trim(); if (!t) continue;
      let m;
      if ((m = t.match(/salle le matin\s*:\s*(.+)/i))) { out.salle.matin = m[1].trim(); continue; }
      if ((m = t.match(/salle l.après-midi\s*:\s*(.+)/i))) { out.salle.aprem = m[1].trim(); continue; }
      if ((m = t.match(/formateur[^:]*:\s*(.+)/i))) { out.formateur = m[1].trim(); continue; }
      const plages = [...t.matchAll(/(\d{1,2})[:h](\d{2})\s*[–\-—]\s*(\d{1,2})[:h](\d{2})/g)];
      if (!plages.length) continue;
      const label = t.replace(/(\d{1,2})[:h](\d{2})\s*[–\-—]\s*(\d{1,2})[:h](\d{2})/g, "").replace(/^[^:]*:/, "").replace(/\bet\b/g, "").replace(/[\s,;·]+/g, " ").trim();
      const cible = /pause|déjeuner|dejeuner|repas/i.test(t) ? out.pauses : out.seances;
      for (const p of plages) cible.push({ de: heure(p[1], p[2]), a: heure(p[3], p[4]), label: /horaires|pause/i.test(t) ? "" : label, texte: (t.match(/^[^:]*/) || [""])[0].trim() });
    }
    return out;
  };
  const deroule = (k) => {
    const reels = (evs[k] || []).map((e) => ({ ...e, reel: true }));
    const dow = dowOf(k);
    const type = reels.some((e) => e.cal === "école" || e.cal === "ecole") ? "ecole" : dow >= 5 ? "weekend" : "ouvre";
    const gab = ((t?.journee?.type || {})[type] || []).map((b) => {
      const start = new Date((b.nuit ? addDays(k, 1) : k) + "T" + b.h + ":00");   // « 01:30 Coucher » = la nuit qui suit
      return { title: b.texte, titre: b.texte, start: start.toISOString(), end: b.d ? new Date(start.getTime() + b.d * 60000).toISOString() : null, allDay: false, cal: "type", t: start.getTime(), k, reel: false, d: b.d || null };
    }).filter((b) => {   // un bloc générique (travail, cours) s'efface sous un vrai rendez-vous ; pauses, repas, marche restent
      const generique = ["ordi", "etude", "agenda"].includes(catDe(b));
      return !(generique && reels.some((e) => !e.allDay && e.t <= b.t && new Date(e.end || e.start).getTime() > b.t));
    });
    // événements longs : séances du descriptif (sinon tout l'événement), redécoupées AUTOUR des pauses
    const pieces = [], pausesDesc = [];
    for (const e of reels) {
      const fin = e.end ? new Date(e.end).getTime() : e.t + 3600000;
      if (e.allDay || fin - e.t < 2 * 3600000) { pieces.push({ ...e, fin, premier: true }); continue; }
      const d = lireDesc(e);
      for (const p of d.pauses) pausesDesc.push({ title: p.texte || "Pause", titre: p.texte || "Pause", start: new Date(p.de).toISOString(), end: new Date(p.a).toISOString(), allDay: false, cal: "type", t: p.de, fin: p.a, d: (p.a - p.de) / 60000, k, reel: false });
      const seances = d.seances.length ? d.seances : [{ de: e.t, a: fin, label: "" }];
      const coupes = [...pausesDesc, ...gab.filter((b) => b.d)].filter((b) => b.t > e.t && b.t < fin).sort((a, b) => a.t - b.t);
      let premier = true;
      for (const se of seances) {
        let cur = se.de;
        const bornes = coupes.filter((b) => b.t > se.de && b.t < se.a);
        for (const b of [...bornes, { t: se.a, d: 0 }]) {
          if (b.t - cur >= 10 * 60000) {
            const salle = cur < new Date(`${k}T12:30:00`).getTime() ? d.salle.matin : d.salle.aprem;
            pieces.push({ ...e, t: cur, start: new Date(cur).toISOString(), fin: b.t, end: new Date(b.t).toISOString(), premier,
              title: e.title + (se.label ? " — " + se.label : ""), place: [salle || e.place, d.formateur].filter(Boolean).join(" · ") });
            premier = false;
          }
          cur = b.t + (b.d || 0) * 60000;
        }
      }
    }
    // une pause du descriptif remplace le bloc du gabarit de même nature à la même heure (± 1 h 30)
    const gab2 = gab.filter((b) => !pausesDesc.some((p) => catDe(p) === catDe(b) && Math.abs(p.t - b.t) < 90 * 60000));
    const all = [...gab2, ...pausesDesc, ...pieces].sort((a, b) => a.t - b.t);
    return all.map((x, i) => ({ ...x, fin: x.fin || (x.d ? x.t + x.d * 60000 : (all[i + 1] ? all[i + 1].t : null)) }));
  };
  const dureeBloc = (x) => { if (x.allDay) return "journée"; if (!x.fin) return ""; const m = Math.round((x.fin - x.t) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`; };
  return (
    <div className="ag">
      <div className="ag-top">
        <div className="pg-titre"><div><div className="pg-brand">V.L.A.D</div><div className="pg-brandsub">AGENDA · {jour ? "JOUR" : "MOIS"}</div></div><HorlogeSegments /></div>
        <div className="ag-nav">
          <button onClick={() => (jour ? allerAu(addDays(jour, -1)) : nav(-1))} title={jour ? "Jour précédent" : "Mois précédent"}>‹</button>
          <span className="ag-title">{jour ? fmtLong(jour) : `${MOIS[m - 1]} ${y}`}</span>
          <button onClick={() => (jour ? allerAu(addDays(jour, 1)) : nav(1))} title={jour ? "Jour suivant" : "Mois suivant"}>›</button>
        </div>
        <div className="ag-actions">
          {jour && <button className="pg-btn" onClick={() => setJour(null)}>← Mois</button>}
          {!jour && mois !== today.slice(0, 7) && <button className="pg-btn" onClick={() => setMois(today.slice(0, 7))}>Aujourd'hui</button>}
          <button className="pg-ic" onClick={onClose} title="Fermer">✕</button>
        </div>
      </div>

      {!jour && (
        <div className="ag-grid">
          {J3.map((d) => <div key={d} className="ag-dow">{d}</div>)}
          {cells.map((k) => { const l = evs[k] || []; const inM = k.slice(0, 7) === mois; return (
            <button key={k} className={`ag-cell ${inM ? "in" : "out"} ${k === today ? "today" : ""} ${k < today ? "passe" : ""}`} onClick={() => allerAu(k)}>
              <div className="ag-num"><b>{+k.slice(8)}</b><span>{J3[dowOf(k)]}</span></div>
              <div className="ag-evs">
                {l.slice(0, 3).map((e, i) => <div key={i} className={"ag-ev " + e.cal} title={e.title}><i /><span>{e.title}</span></div>)}
                {l.length > 3 && <div className="ag-more">+{l.length - 3}</div>}
              </div>
              {k === today && <div className="ag-today-bar" />}
            </button>); })}
        </div>)}

      {jour && (
        <div className="ag-jour">
          <div className="pg-card ag-tl">
            {deroule(jour).map((x, i, all) => {
              const r = x.reel ? (t?.rdv || {})[x.cle] : null; const passe = x.t <= tick;
              const now = jour === today && x.t <= tick && (!all[i + 1] || all[i + 1].t > tick);
              return (
                <React.Fragment key={i}>
                  <div className={`ag-item ${x.reel ? x.cal : "type"} ${r ? r.statut : ""} ${passe && !now ? "passe" : ""}`}>
                    <div className="ag-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconeDe(x)}</svg></div>
                    <div className="ag-info">
                      <div className="ag-meta"><span>{x.allDay ? "Journée" : hm(x.start) + (x.end ? " – " + hm(x.end) : "")}</span><span>{dureeBloc(x)}</span></div>
                      <h3>{x.title}</h3>
                      {x.place && <p className="ag-place">{x.place}</p>}
                      {r?.note && <p className="ag-note">{r.note}</p>}
                    </div>
                    {x.reel && x.premier && passe && <button className={`ag-check ${r ? "on " + r.statut : ""}`} onClick={() => pointer(x)} title={r ? "re-cliquer pour décocher" : "cliquer si tu y as assisté"}>{r ? (r.statut === "rate" ? "✗" : "✓") : "○"}</button>}
                  </div>
                  {now && <div className="ag-now"><i /><span>maintenant · {new Date(tick).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h")}</span></div>}
                </React.Fragment>);
            })}
            {deroule(jour).length === 0 && <p className="pg-empty">Journée libre — dis à VLAD « ajoute à mon agenda… »</p>}
          </div>
          <div className="ag-foot">
            <p className="pg-mono pg-hint">rendez-vous passé : un clic = assisté · re-clic = décoché · la note se dicte à VLAD</p>
            <button className="pg-lnk" onClick={() => { setTexte(t?.journee?.texte || ""); setEdit(!edit); }}>{edit ? "fermer" : "modifier ma journée type"}</button>
          </div>
          {edit && (
            <div className="pg-card pg-edit ag-edit">
              <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={16} spellCheck={false} />
              <p className="pg-mono pg-hint">« # Jour ouvré », « # Jour d’école », « # Week-end » ouvrent chaque gabarit · une ligne = « HH:MM Ce que je fais » · l'icône se choisit d'après les mots (pause, déjeuner, ordi, marche, trajet, lever, coucher…)</p>
              <button className="pg-btn" onClick={async () => { await post("/tracker/journee", { texte }); setEdit(false); loadT(); }}>Enregistrer</button>
            </div>)}
        </div>)}
    </div>
  );
}
