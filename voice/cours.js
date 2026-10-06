/* ═══════════════════════════════════════════════════════════════
   VLAD — COURS : chaque support de cours (PDF) est lu une fois par la voie
   document, qui en tire un résumé, les notions clés, les points à savoir ET un
   QCM. Les QCM s'accumulent au fil de l'année ; la révision ramène en priorité
   les questions ratées ou jamais vues.
   Fichiers : cours/ (supports déposés, non versionnés), cours.json (fiches),
   .cours-progression.json (maîtrise par question).
   ═══════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "cours");
const FILE = path.join(ROOT, "cours.json");
const PROG = path.join(ROOT, ".cours-progression.json");
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { cours: [] }; } };
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
const lireProg = () => { try { return JSON.parse(fs.readFileSync(PROG, "utf8")); } catch { return { questions: {}, essais: [] }; } };
const ecrireProg = (p) => fs.writeFileSync(PROG, JSON.stringify(p, null, 1));
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 50);
const EXT = /\.(pdf|md|txt)$/i;

const PROMPT = (nom, formation) =>
  `Tu lis un support de COURS${formation ? " (formation : " + formation + ")" : ""} : ${nom}. ` +
  "Lis-le entièrement (Read ; si c'est un scan ou un PDF image, l'OCR pdf-tools). Réponds UNIQUEMENT par un objet JSON, " +
  "sans markdown ni texte autour, avec ces clés : " +
  '"titre" (titre réel du cours, court), "matiere" (la matière ou le module, 1 à 3 mots), ' +
  '"resume" (6 à 10 phrases claires : ce que le cours enseigne et pourquoi), ' +
  '"notions" (5 à 12 notions clés, chacune "Terme : définition en une phrase"), ' +
  '"aSavoir" (5 à 10 points précis qu\'un examen demanderait : chiffres, définitions, différences, commandes), ' +
  '"qcm" (EXACTEMENT 10 questions à choix multiple sur CE cours, chacune {"q": "question", "choix": ["…","…","…","…"], ' +
  '"bonne": index 0-3 de la bonne réponse, "explication": "une phrase qui dit pourquoi"} ; de difficulté croissante, ' +
  "des distracteurs plausibles, jamais « toutes les réponses » ni piège sur la formulation). Français, précis.";

function analyser(r) {
  try { return JSON.parse((r.response || "").match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { return {}; }
}
const qcmPropre = (q) => (Array.isArray(q) ? q : [])
  .filter((x) => x && x.q && Array.isArray(x.choix) && x.choix.length >= 2 && Number.isInteger(+x.bonne) && +x.bonne < x.choix.length)
  .slice(0, 15).map((x, i) => ({ id: i, q: String(x.q), choix: x.choix.map(String), bonne: +x.bonne, explication: String(x.explication || "") }));

// Matière connue par la synchro Classroom (cours/.matieres.json : fichier → nom du cours)
function matiereClassroom(nom) { try { return JSON.parse(fs.readFileSync(path.join(DIR, ".matieres.json"), "utf8"))[nom] || null; } catch { return null; } }
function noterMatieres(carte) {
  const f = path.join(DIR, ".matieres.json");
  let m = {}; try { m = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  fs.writeFileSync(f, JSON.stringify({ ...m, ...carte }, null, 1));
}

// Lecture d'un support (voie document du pont : ask(texte, voix, silencieux, fichiers))
async function ingest(fichier, ask, source = "dépôt") {
  const nom = path.basename(fichier);
  const d = load();
  if (d.cours.some((c) => c.fichier === nom)) return null;              // déjà lu
  const r = await ask(PROMPT(nom, process.env.VLAD_FORMATION), null, true, [fichier], false);
  const j = analyser(r);
  const cours = {
    id: slug(nom.replace(EXT, "")) + "-" + Date.now().toString(36),
    fichier: nom, source, ajoute: Date.now(),
    titre: j.titre || nom.replace(EXT, ""), matiere: matiereClassroom(nom) || j.matiere || "Autre",
    resume: j.resume || (r.response || "").slice(0, 1500),
    notions: j.notions || [], aSavoir: j.aSavoir || [], qcm: qcmPropre(j.qcm),
  };
  const d2 = load(); d2.cours.unshift(cours); save(d2);
  return cours;
}

// QCM manquant ou à refaire pour un cours déjà lu
async function regenererQcm(id, ask) {
  const d = load(); const c = d.cours.find((x) => x.id === id);
  if (!c) throw new Error("cours inconnu");
  const r = await ask(PROMPT(c.fichier, process.env.VLAD_FORMATION) + " Concentre-toi sur la clé \"qcm\".", null, true, [path.join(DIR, c.fichier)], false);
  const q = qcmPropre(analyser(r).qcm);
  if (!q.length) throw new Error("QCM non généré");
  const d2 = load(); const c2 = d2.cours.find((x) => x.id === id); c2.qcm = q; save(d2);
  return c2;
}

// Tout support du dossier cours/ pas encore lu (dépôt depuis le HUD ou copie dans le dossier)
let occupe = false;
async function lireNouveaux(ask, onCours) {
  if (occupe) return; occupe = true;
  try {
    const lus = new Set(load().cours.map((c) => c.fichier));
    for (const f of fs.readdirSync(DIR).filter((x) => EXT.test(x) && !x.startsWith(".") && !lus.has(x))) {
      console.log("   [cours] lecture de", f);
      const c = await ingest(path.join(DIR, f), ask);
      if (c) { console.log(`   [cours] ${c.titre} — ${c.qcm.length} questions`); onCours?.(c); }
    }
  } catch (e) { console.error("   [cours]", String(e).slice(-160)); }
  finally { occupe = false; }
}

function deposer(name, dataB64) {
  const safe = path.basename(String(name)).replace(/[^\w.\-() éèàùçÉ]/g, "_");
  if (!EXT.test(safe)) throw new Error("format accepté : PDF, Markdown ou texte");
  fs.writeFileSync(path.join(DIR, safe), Buffer.from(String(dataB64), "base64"));
  return safe;
}
function supprimer(id) { const d = load(); d.cours = d.cours.filter((c) => c.id !== id); save(d); }

// ── Révision : tirage de N questions, priorité aux ratées puis aux jamais vues ──
const cle = (coursId, qid) => `${coursId}#${qid}`;
function etatQuestion(p) {
  if (!p || !p.vues) return "nouvelle";
  if (p.dernier === "faux") return "revoir";
  return p.serie >= 2 ? "maitrisee" : "confirmer";
}
function tirage({ n = 10, cours: filtre = null, mode = "melange" } = {}) {
  const prog = lireProg().questions;
  let toutes = load().cours.filter((c) => !filtre || c.id === filtre)
    .flatMap((c) => c.qcm.map((q) => ({ ...q, coursId: c.id, coursTitre: c.titre, matiere: c.matiere, cle: cle(c.id, q.id), etat: etatQuestion(prog[cle(c.id, q.id)]) })));
  if (mode === "revoir") toutes = toutes.filter((q) => q.etat === "revoir" || q.etat === "confirmer");
  if (mode === "nouvelles") toutes = toutes.filter((q) => q.etat === "nouvelle");
  const poids = { revoir: 0, confirmer: 1, nouvelle: 2, maitrisee: 3 };
  return toutes.map((q) => ({ q, r: poids[q.etat] + Math.random() })).sort((a, b) => a.r - b.r).slice(0, n).map((x) => x.q);
}
function resultat({ reponses = [], cours: filtre = null }) {
  const p = lireProg();
  let bonnes = 0;
  for (const { cle: k, juste } of reponses) {
    const e = p.questions[k] || { vues: 0, justes: 0, serie: 0 };
    e.vues++; if (juste) { e.justes++; e.serie++; bonnes++; } else e.serie = 0;
    e.dernier = juste ? "juste" : "faux"; e.at = Date.now();
    p.questions[k] = e;
  }
  p.essais.push({ at: Date.now(), cours: filtre, total: reponses.length, bonnes });
  p.essais = p.essais.slice(-200);
  ecrireProg(p);
  return stats();
}
function stats() {
  const prog = lireProg(), d = load();
  const parCours = d.cours.map((c) => {
    const e = c.qcm.map((q) => etatQuestion(prog.questions[cle(c.id, q.id)]));
    return { id: c.id, total: e.length, maitrisees: e.filter((x) => x === "maitrisee").length, aRevoir: e.filter((x) => x === "revoir").length };
  });
  return { parCours, essais: prog.essais.slice(-20) };
}

// vue pour le HUD
const vue = () => ({ cours: load().cours, ...stats() });
// résumé pour le CERVEAU (Read sur /tmp/vlad_cours.json)
const snapshot = () => load().cours.slice(0, 12).map((c) => ({
  titre: c.titre, matiere: c.matiere, ajoute: new Date(c.ajoute).toISOString().slice(0, 10), fichier: path.join(DIR, c.fichier),
  resume: c.resume, notions: c.notions.slice(0, 10), aSavoir: c.aSavoir.slice(0, 10), questions: c.qcm.length,
}));

module.exports = { DIR, noterMatieres, load, ingest, regenererQcm, lireNouveaux, deposer, supprimer, tirage, resultat, stats, vue, snapshot };
