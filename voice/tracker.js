// VLAD — Cap : tâches de travail + habitudes + check-in mental.
// Données : ~/vlad-os/tracker.json (partagé Mac/iPhone/Telegram, sauvegardé
// chaque jour par vlad-backup.sh). Module utilisé par le pont ET petit CLI pour
// l'exécuteur du mode action (suppression = confirmation vocale).
//   node voice/tracker.js add "Appeler Martin" 2026-09-18
//   node voice/tracker.js done|undone "Martin"        (recherche floue, jour courant d'abord)
//   node voice/tracker.js del "Martin"
//   node voice/tracker.js habit "Sport" [done|undone] [date]
//   node voice/tracker.js mind 8 9 7 [date]
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "tracker.json");
// Exemples de départ : routines PRO (jours ouvrés, lun→ven) et habitudes PERSO (7 j).
// Chacun les remplace depuis la page Cap (onglet Habitudes).
const DEFAULT_HABITS = [
  { nom: "Point mails du matin", ouvres: true },
  { nom: "Bloc de concentration 2 h", ouvres: true },
  { nom: "Revue des tâches du lendemain", ouvres: true },
  { nom: "Sport", ouvres: false },
  { nom: "Journal du soir", ouvres: false },
];
// Édition = un texte, une ligne par habitude. « # Groupe » ouvre un groupe
// (Travail, Perso…) ; « (7j) » sur une ligne ou sur un groupe = tous les jours,
// sinon jours ouvrés. Ex. :  # Perso (7j)  /  Lever 7 h
function parseHabit(x, ctx) {
  if (x && typeof x === "object") return { nom: String(x.nom || "").trim(), ouvres: x.ouvres !== false, groupe: x.groupe || "" };
  const m = String(x || "").trim().match(/^(.*?)\s*\((7\s*j|tous les jours)\)$/i);
  const nom = (m ? m[1] : String(x || "")).trim();
  return { nom, ouvres: m ? false : (ctx ? ctx.ouvres : true), groupe: ctx ? ctx.groupe : "" };
}
function parseHabitList(lines) {
  const out = []; let ctx = { groupe: "", ouvres: true };
  for (const raw of lines) {
    const l = String(raw).trim(); if (!l) continue;
    const g = l.match(/^#\s*(.*?)\s*(\((7\s*j|tous les jours)\))?$/i);
    if (g) { ctx = { groupe: g[1].trim(), ouvres: !g[2] }; continue; }
    const h = parseHabit(l, ctx); if (h.nom) out.push(h);
  }
  return out;
}
const ouvre = (k) => { const d = new Date(k + "T12:00:00").getDay(); return d >= 1 && d <= 5; };
const applicable = (h, k) => !h.ouvres || ouvre(k);

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function load() {
  let t;
  try { t = JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { t = { habits: DEFAULT_HABITS.slice(), tasks: {}, habitLog: {}, mind: {} }; }
  t.habits = (t.habits || []).map(parseHabit).filter((h) => h.nom);
  return t;
}
function save(t) { fs.writeFileSync(FILE, JSON.stringify(t, null, 1)); }
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// « jeudi », « demain », « 18/09 », « 2026-09-18 » → AAAA-MM-JJ (jamais dans le passé pour un jour nommé)
function parseDate(s) {
  const t = norm(s);
  if (!t || t === "aujourd'hui" || t === "aujourdhui") return today();
  const base = new Date(today() + "T12:00:00");
  if (t === "demain") { base.setDate(base.getDate() + 1); return base.toISOString().slice(0, 10); }
  if (t === "apres-demain") { base.setDate(base.getDate() + 2); return base.toISOString().slice(0, 10); }
  const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const j = jours.indexOf(t);
  if (j >= 0) { const diff = (j - base.getDay() + 7) % 7 || 7; base.setDate(base.getDate() + (t === jours[base.getDay()] ? 0 : diff)); return base.toISOString().slice(0, 10); }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return t;
  m = t.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(base.getFullYear()); return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return today();
}

function addTask(text, date, extra) {
  const t = load(); const d = parseDate(date);
  const task = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: String(text).trim(), done: false, ...(extra || {}) };
  if (!task.text) throw new Error("tâche vide");
  (t.tasks[d] ||= []).push(task); save(t);
  return { ...task, date: d };
}
// ── tâches RÉPÉTÉES : la règle vit dans t.recurrents, materialiser() crée les
// occurrences 14 jours d'avance comme de VRAIES tâches (cochables, supprimables
// une à une) — « sauf » garde les jours retirés à l'unité
function addRecurrent(text, freq, date) {
  if (!["jour", "semaine", "mois"].includes(freq)) throw new Error("répétition inconnue : " + freq);
  const t = load(); const d = parseDate(date);
  const rec = { id: "r" + Date.now().toString(36), text: String(text).trim(), freq, depuis: d, sauf: [] };
  if (!rec.text) throw new Error("tâche vide");
  (t.recurrents ||= []).push(rec); save(t);
  materialiser();
  return { ...rec };
}
function materialiser() {
  const t = load(); if (!(t.recurrents || []).length) return t;
  const addJ = (k, n) => { const x = new Date(k + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const fin = addJ(today(), 14);
  let ecrit = false;
  for (const r of t.recurrents) {
    const dep = new Date(r.depuis + "T12:00:00");
    for (let k = r.depuis; k <= fin; k = addJ(k, 1)) {
      if ((r.sauf || []).includes(k)) continue;
      const d = new Date(k + "T12:00:00");
      if (r.freq === "semaine" && d.getDay() !== dep.getDay()) continue;
      if (r.freq === "mois" && d.getDate() !== dep.getDate()) continue;
      if ((t.tasks[k] || []).some((x) => x.rid === r.id)) continue;
      (t.tasks[k] ||= []).push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: r.text, done: false, rid: r.id, source: "recurrent" });
      ecrit = true;
    }
  }
  if (ecrit) save(t);
  return t;
}
function delRecurrent(rid) {
  const t = load(); const avant = (t.recurrents || []).length;
  t.recurrents = (t.recurrents || []).filter((r) => r.id !== rid);
  if (t.recurrents.length === avant) throw new Error("répétition introuvable");
  const auj = today();   // l'historique reste, aujourd'hui-non-fait et le futur partent
  for (const d of Object.keys(t.tasks)) {
    t.tasks[d] = t.tasks[d].filter((x) => x.rid !== rid || d < auj || (d === auj && x.done));
    if (!t.tasks[d].length) delete t.tasks[d];
  }
  save(t); return { supprimee: true };
}
function sauterRecurrent(rid, date) {
  const t = load(); const r = (t.recurrents || []).find((x) => x.id === rid);
  if (!r) throw new Error("répétition introuvable");
  const d = parseDate(date);
  (r.sauf ||= []).push(d);
  if (t.tasks[d]) { t.tasks[d] = t.tasks[d].filter((x) => x.rid !== rid); if (!t.tasks[d].length) delete t.tasks[d]; }
  save(t); return { saute: d };
}

// recherche floue : jour courant d'abord, puis la semaine, puis tout
function findTask(t, query, preferDate) {
  const q = norm(query);
  const dates = Object.keys(t.tasks).sort((a, b) => (a === preferDate ? -1 : b === preferDate ? 1 : a < b ? 1 : -1));
  for (const d of dates) for (const task of t.tasks[d]) if (norm(task.text).includes(q)) return { task, date: d };
  return null;
}
function setTask(query, done, preferDate) {
  const t = load(); const f = findTask(t, query, preferDate || today());
  if (!f) throw new Error("tâche introuvable : " + query);
  f.task.done = done; save(t); return { ...f.task, date: f.date };
}
function setTaskById(id, done) {
  const t = load();
  for (const d of Object.keys(t.tasks)) for (const task of t.tasks[d]) if (task.id === id) { task.done = done; save(t); return { ...task, date: d }; }
  throw new Error("id inconnu");
}
function delTask(query) {
  const t = load(); const f = findTask(t, query, today());
  if (!f) throw new Error("tâche introuvable : " + query);
  t.tasks[f.date] = t.tasks[f.date].filter((x) => x.id !== f.task.id);
  if (!t.tasks[f.date].length) delete t.tasks[f.date];
  save(t); return { ...f.task, date: f.date };
}
function delTaskById(id) {
  const t = load();
  for (const d of Object.keys(t.tasks)) {
    const i = t.tasks[d].findIndex((x) => x.id === id);
    if (i >= 0) { const [task] = t.tasks[d].splice(i, 1); if (!t.tasks[d].length) delete t.tasks[d]; save(t); return { ...task, date: d }; }
  }
  throw new Error("id inconnu");
}
function setHabit(name, done, date) {
  const t = load(); const d = parseDate(date);
  const h = t.habits.find((x) => norm(x.nom) === norm(name)) || t.habits.find((x) => norm(x.nom).includes(norm(name)));
  if (!h) throw new Error("habitude inconnue : " + name);
  const set = new Set(t.habitLog[d] || []);
  done ? set.add(h.nom) : set.delete(h.nom);
  t.habitLog[d] = [...set]; save(t); return { habit: h.nom, date: d, done };
}
function setHabits(lines) {
  const t = load(); t.habits = parseHabitList(lines); save(t); return t.habits;
}
function setMind(e, f, m, date) {
  const t = load(); const d = parseDate(date);
  const clamp = (v) => Math.max(0, Math.min(10, parseInt(v, 10) || 0));
  t.mind[d] = { e: clamp(e), f: clamp(f), m: clamp(m) }; save(t); return { date: d, ...t.mind[d] };
}
// série en cours d'une habitude (jours consécutifs jusqu'à aujourd'hui ou hier)
function streak(t, h) {
  let n = 0; const d = new Date(today() + "T12:00:00");
  const has = (k) => (t.habitLog[k] || []).includes(h.nom);
  if (!has(today())) d.setDate(d.getDate() - 1);
  for (let guard = 0; guard < 400; guard++) {
    const k = d.toISOString().slice(0, 10);
    if (applicable(h, k)) { if (!has(k)) break; n++; }
    d.setDate(d.getDate() - 1);
  }
  return n;
}
// ── JOURNÉE TYPE : le déroulé d'une journée (lever, travail, pauses, repas…)
// en trois gabarits ; la page Agenda l'intercale entre les vrais rendez-vous ──
const JOURNEE_DEFAUT = `# Jour ouvré
07:00 Lever · café et préparation
08:30 Travail · bloc de concentration
10:30 Pause café
12:30 Déjeuner
13:30 Travail · réunions et mails
16:00 Pause
18:00 Fin du travail
18:30 Sport
20:00 Dîner
22:30 Journal du soir · notes VLAD
23:30 Coucher
# Jour d'école
07:00 Lever · café et préparation
09:00 Cours
12:30 Déjeuner
13:30 Cours
17:00 Fin des cours · révisions
20:00 Dîner
22:30 Journal du soir · notes VLAD
23:30 Coucher
# Week-end
09:00 Lever · café
10:30 Projet perso
12:30 Déjeuner
14:00 Temps libre
17:00 Marche · sortie
20:00 Dîner
22:30 Journal du soir · notes VLAD
00:00 Coucher`;
// durée par défaut d'un bloc (minutes) d'après ses mots ; sinon il dure jusqu'au bloc suivant
const DUREES = [[/lever|réveil|reveil|coucher/i, null], [/journal/i, 10], [/parking/i, 15], [/préparation du repas|cuisine/i, 45],
  [/pause|café|cafe|clope/i, 15], [/petit.?déj|déjeuner|dejeuner|dîner|diner|repas\b/i, 60], [/douche|bain/i, 30],
  [/marche|sortie|sport/i, 45], [/lecture|histoire/i, 30]];   // ordre = priorité (le premier motif qui matche gagne)
const CLES_JOURNEE = { "jour ouvre": "ouvre", "mardi ecole": "ecole", "jour d ecole": "ecole", "week-end": "weekend", "weekend": "weekend" };
function parseJournee(texte) {
  const out = { ouvre: [], ecole: [], weekend: [] }; let cur = "ouvre";
  for (const l of String(texte).split("\n")) {
    const t = l.trim(); if (!t) continue;
    if (t.startsWith("#")) { const k = norm(t.slice(1)); cur = CLES_JOURNEE[k] || (k.includes("ecole") ? "ecole" : k.includes("week") ? "weekend" : "ouvre"); continue; }
    // « 12:30 Déjeuner » ou « 12:30-13:30 Déjeuner » (fin explicite) ; « 01:30 Coucher » = après minuit
    const m = t.match(/^(\d{1,2})[:h](\d{2})?\s*(?:[-–→]\s*(\d{1,2})[:h](\d{2})?)?\s+(.+)$/); if (!m) continue;
    const h = `${m[1].padStart(2, "0")}:${m[2] || "00"}`, texte = m[5].trim();
    let d = m[3] ? (parseInt(m[3], 10) * 60 + parseInt(m[4] || "0", 10)) - (parseInt(m[1], 10) * 60 + parseInt(m[2] || "0", 10)) : null;
    if (d === null) { const r = DUREES.find(([re]) => re.test(texte)); if (r) d = r[1]; }
    out[cur].push({ h, texte, d: d && d > 0 ? d : null, nuit: h < "05:00" });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => ((a.nuit ? "1" : "0") + a.h).localeCompare((b.nuit ? "1" : "0") + b.h));
  return out;
}
function setJournee(texte) { const t = load(); t.journeeTexte = String(texte); t.journeeType = parseJournee(texte); save(t); return t.journeeType; }
function journee(t) { return { texte: t.journeeTexte || JOURNEE_DEFAUT, type: t.journeeType || parseJournee(JOURNEE_DEFAUT) }; }

// ── pointage des RENDEZ-VOUS (agenda Google/Calendly, en lecture seule par
// ailleurs) : clé = date|titre normalisé, statut fait|rate + note libre ──
const normRdv = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 40);
function setRdv(cle, statut, note, titre) {
  if (!cle) throw new Error("rendez-vous sans clé");
  const t = load();
  if (statut === "off") { if (t.rdv) delete t.rdv[cle]; save(t); return { cle, off: true }; }
  (t.rdv ||= {})[cle] = { statut: statut === "rate" ? "rate" : "fait", note: String(note || "").trim(), titre: String(titre || "").slice(0, 120), at: Date.now() };
  save(t); return { cle, ...t.rdv[cle] };
}

// résumé LISIBLE pour le cerveau (Read) : aujourd'hui + semaine + séries
function snapshot() {
  const t = load(); const td = today();
  const base = new Date(td + "T12:00:00"); const dow = (base.getDay() + 6) % 7;
  const monday = new Date(base); monday.setDate(base.getDate() - dow);
  const semaine = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i); const k = d.toISOString().slice(0, 10);
    semaine.push({ date: k, jour: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][i], taches: (t.tasks[k] || []).map((x) => (x.done ? "✓ " : "☐ ") + x.text + (x.url ? " (lien)" : "")), habitudesFaites: t.habitLog[k] || [], mental: t.mind[k] || null });
  }
  return {
    aujourdHui: td,
    habitudes: t.habits.map((h) => ({ nom: h.nom, groupe: h.groupe || "", joursOuvresSeulement: h.ouvres, applicableAujourdHui: applicable(h, td), faiteAujourdHui: (t.habitLog[td] || []).includes(h.nom), serieJours: streak(t, h) })),
    semaine,
    aVenir: Object.keys(t.tasks).filter((k) => k > semaine[6].date).sort().slice(0, 5).map((k) => ({ date: k, taches: t.tasks[k].filter((x) => !x.done).map((x) => x.text) })),
    rendezVousPointes: Object.entries(t.rdv || {}).filter(([c]) => c.slice(0, 10) >= semaine[0].date).map(([c, v]) => ({ date: c.slice(0, 10), titre: v.titre || c.slice(11), assiste: v.statut !== "rate", note: v.note || "" })),
  };
}

// Marqueur [[TACHE: …]] émis par le cerveau — exécuté SANS confirmation (jamais de suppression ici)
//   add|<date ou jour>|<texte>   done|<texte>   undone|<texte>   habit|<nom>|done|undone   mind|e|f|m
function runMarker(cmd) {
  const p = String(cmd).split("|").map((s) => s.trim());
  switch (p[0]) {
    case "add": {
      const freq = (p[3] || "").toLowerCase().replace(/s$/, "");
      if (["jour", "semaine", "mois"].includes(freq)) { const r = addRecurrent(p[2], freq, p[1]); return `tâche répétée (chaque ${r.freq}) dès le ${r.depuis} : ${r.text}`; }
      const r = addTask(p[2] || p[1], p[2] ? p[1] : ""); return `tâche ajoutée le ${r.date} : ${r.text}`;
    }
    case "done": return `cochée : ${setTask(p[1], true).text}`;
    case "undone": return `décochée : ${setTask(p[1], false).text}`;
    case "habit": { const r = setHabit(p[1], p[2] !== "undone", p[3]); return `${r.habit} ${r.done ? "fait" : "décoché"} le ${r.date}`; }
    case "mind": { const r = setMind(p[1], p[2], p[3], p[4]); return `check-in ${r.date} : ${r.e}/${r.f}/${r.m}`; }
    default: throw new Error("commande inconnue : " + p[0]);
  }
}

module.exports = { load, save, today, parseDate, applicable, ouvre, addTask, addRecurrent, materialiser, delRecurrent, sauterRecurrent, setTask, setTaskById, delTask, delTaskById, setHabit, setHabits, setMind, setRdv, normRdv, setJournee, journee, snapshot, runMarker, FILE };

if (require.main === module) {   // CLI (exécuteur du mode action)
  const [, , cmd, ...a] = process.argv;
  try {
    const out = cmd === "add" ? addTask(a[0], a[1]) : cmd === "done" ? setTask(a[0], true) : cmd === "undone" ? setTask(a[0], false)
      : cmd === "del" ? delTask(a[0]) : cmd === "habit" ? setHabit(a[0], a[1] !== "undone", a[2]) : cmd === "mind" ? setMind(a[0], a[1], a[2], a[3])
      : cmd === "habits" ? setHabits(a) : (() => { throw new Error("usage : add|done|undone|del|habit|mind|habits"); })();
    console.log(JSON.stringify(out));
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
