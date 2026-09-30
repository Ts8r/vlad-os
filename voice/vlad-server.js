#!/usr/bin/env node
/**
 * VLAD OS — Pont vocal local (étape 3 ⇄ HUD)
 * --------------------------------------------
 * Relie le HUD (navigateur) au pipeline : micro → Whisper (FR) → Opus (claude -p)
 * → voix FR (say). Serveur HTTP local, sans dépendance npm.
 *
 *   GET  /voices            → liste des voix FR (3 M / 3 F) pour choisir
 *   POST /listen            → capture micro + Whisper FR  → { text }
 *   POST /ask {text,voice,silent} → Opus répond FR ; parle (sauf silent) → { response }
 *   POST /speak {text,voice}      → fait parler une voix (test du sélecteur)
 *
 * Cerveau = Opus via ton abonnement Claude Max (aucun surcoût). Tout le reste local.
 * Lancement : npm run vlad   (ou node voice/vlad-server.js)
 */

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { buildVault } = require("./vault-data.js");
const widgetsApi = require("./widgets-api.js");
// vault rempli depuis les fichiers de l'utilisateur : resynchronisé au démarrage puis toutes les 6 h
// (seulement si l'import a déjà été lancé une fois depuis la page Vault)
{
  const vi = require("./vault-import.js");
  const synchro = () => { try { if (vi.etat().derniere) { const r = vi.synchroniser(); console.log("   vault : fiches-index à jour", JSON.stringify(r.stats)); } } catch (e) { console.error("   vault import :", e.message); } };
  setTimeout(synchro, 30000); setInterval(synchro, 6 * 3600_000);
}   // bibliothèque de widgets : disposition, RSS, sites, GitHub, notes
// Filets de crash : plus JAMAIS de mort silencieuse (le 06/08 le pont est tombé
// sans laisser de trace — le log avait été écrasé par la relance suivante).
// Trace datée persistante, puis launchd (KeepAlive) relance le pont en ~1 s.
const CRASH_LOG = "/tmp/vlad-crash.log";
process.on("unhandledRejection", (e) => {
  try { fs.appendFileSync(CRASH_LOG, new Date().toISOString() + " [rejection] " + (e && e.stack || e) + "\n"); } catch {}
});
process.on("uncaughtException", (e) => {
  try { fs.appendFileSync(CRASH_LOG, new Date().toISOString() + " [exception] " + (e && e.stack || e) + "\n"); } catch {}
  process.exit(1);
});

let vaultCache = null;   // graphe du Vault
let vaultSig = null;     // empreinte des sources au moment du dernier build
let telemetryCache = null;
let cpuTimesPrev = null;   // temps CPU du relevé précédent, pour la charge par cœur  // jauges système (df/pmset), rafraîchies toutes les 5 s
let calCache = null;
let calCacheMois = null;   // cache par mois pour la page Agenda        // agenda ICS (adresse secrète Google), rafraîchi toutes les 5 min
// Événement → version pour le CERVEAU : heures en clair, HEURE DE PARIS, en tête.
// Les ISO UTC restent (pour les calculs) mais le modèle lisait « 07:00Z » comme
// 7 h du matin une fois sur deux (vécu 15/09 : cours de 9 h annoncé à 7 h).
const FR_JOUR = { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" };
const FR_HEURE = { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" };
function pourCerveau(e) {
  const d = new Date(e.start), f = e.end ? new Date(e.end) : null;
  const jour = d.toLocaleDateString("fr-FR", FR_JOUR);
  const quand = e.allDay ? jour + " (toute la journée)"
    : jour + " de " + d.toLocaleTimeString("fr-FR", FR_HEURE).replace(":", "h")
      + (f ? " à " + f.toLocaleTimeString("fr-FR", FR_HEURE).replace(":", "h") : "");
  return { quand, ...e };
}
let calendlyCache = null;   // RDV clients Calendly (jeton API), rafraîchi toutes les 5 min
// ── Journal PARTAGÉ : la conversation vit ICI, tous les appareils l'affichent ──
const JOURNAL_FILE = path.join(__dirname, "..", ".journal.json");
let journal = [];
try { journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8")); } catch {}
function jlog(from, text) {
  if (!text || !String(text).trim()) return;
  journal.push({ from, text: String(text).slice(0, 2000), at: Date.now() });
  journal = journal.slice(-100);
  try { fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal)); } catch {}
}
// ── MODE ACTION : action proposée par VLAD, en attente du « confirme » vocal ──
let pendingAction = null;   // { instr, at }
const CONFIRM_RE = /\b(confirme[rs]?|vas[- ]?y|vasy|fais[- ]?le|ex[ée]cute|go)\b/i;
const CANCEL_RE = /\b(annule[rs]?|laisse tomber|stop|non)\b/i;
const ACTION_TTL = 3 * 60 * 1000;   // au-delà de 3 min, la proposition expire

// ── Agenda : parse minimal d'un flux ICS (VEVENT → {start, end, title, allDay}) ──
// Suffisant pour l'adresse secrète Google Calendar ; pas de récurrence (RRULE ignoré,
// Google déplie déjà la plupart des instances dans le flux).
// ── AGENDA LOCAL (24/09) : événements saisis dans VLAD, absents des agendas Google
//    (ex. jours de préparation d'un examen). Fusionnés dans /calendar ;
//    un événement local est ignoré si Google a déjà le même titre le même jour.
const AGENDA_LOCAL = path.join(__dirname, "..", "agenda-local.json");
function agendaLocal(de, a) {
  try {
    const d = JSON.parse(fs.readFileSync(AGENDA_LOCAL, "utf8"));
    return (d.events || []).filter((e) => e && e.title && e.start).map((e) => ({
      title: e.title, place: e.place || "", desc: e.desc || "", allDay: !!e.allDay, cal: e.cal || "perso", local: true,
      start: new Date(e.start).toISOString(), end: e.end ? new Date(e.end).toISOString() : null,
    })).filter((e) => !isNaN(Date.parse(e.start)) && Date.parse(e.start) < a && (e.end ? Date.parse(e.end) : Date.parse(e.start) + 3600000) > de);
  } catch { return []; }
}
function fusionAgenda(ics, de, a) {
  const cle = (e) => new Date(e.start).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) + "|" + String(e.title).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const vus = new Set((ics || []).map(cle));
  return [...(ics || []), ...agendaLocal(de, a).filter((e) => !vus.has(cle(e)))].sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
}

function parseICS(text) {
  const events = [];
  // les lignes ICS sont pliées : une ligne qui commence par un espace continue la précédente
  const lines = text.replace(/\r/g, "").replace(/\n[ \t]/g, "").split("\n");
  let ev = null;
  const parseDate = (v, isDate) => {
    if (isDate) return new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13), +v.slice(13, 15) || 0));
    return v.endsWith("Z") ? d : new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11), +v.slice(11, 13));
  };
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = {}; continue; }
    if (line === "END:VEVENT") { if (ev?.start && ev.title) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const key = line.slice(0, i), val = line.slice(i + 1);
    if (key.startsWith("DTSTART")) { ev.allDay = key.includes("VALUE=DATE"); ev.start = parseDate(val, ev.allDay); }
    else if (key.startsWith("DTEND")) ev.end = parseDate(val, key.includes("VALUE=DATE"));
    else if (key === "SUMMARY") ev.title = val.replace(/\\,/g, ",").replace(/\\n/g, " · ");
    else if (key.startsWith("LOCATION") && val) ev.place = val.replace(/\\,/g, ",");
    else if (key.startsWith("DESCRIPTION") && val) ev.desc = val.replace(/\\,/g, ",").replace(/\\n/g, "\n").replace(/<[^>]+>/g, "").slice(0, 2000);
  }
  return events;
}

// Empreinte rapide (~1 ms) des dossiers qui alimentent le Vault : nombre de .md
// + mtime le plus récent. Change → on reconstruit le graphe.
function vaultSignature() {
  const dirs = [
    path.join(__dirname, "..", "vault"),
    path.join(__dirname, "..", "skills"),
    path.join(process.env.HOME || "", ".claude", "skills"),
    process.env.VLAD_MEMORY_DIR || "",
  ].filter(Boolean);
  let count = 0, latest = 0;
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name[0] !== ".") walk(p, depth + 1); }
      else if (e.name.endsWith(".md")) {
        count++;
        try { const m = fs.statSync(p).mtimeMs; if (m > latest) latest = m; } catch {}
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  // la base clients alimente aussi le Vault (mise à jour par VLAD en mode action)
  try { const m = fs.statSync(path.join(__dirname, "..", "clients.json")).mtimeMs; if (m > latest) latest = m; count++; } catch {}
  return count + ":" + Math.round(latest);
}

// Charge ~/vlad-os/.env (le serveur est lancé sans dotenv) — valeurs existantes prioritaires.
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*(#.*)?$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = process.env.VLAD_PORT || 8788;
const ROOT = path.join(__dirname, "..");
const PYTHON = process.env.VLAD_PYTHON || path.join(ROOT, ".venv/bin/python");
const CLAUDE = process.env.VLAD_CLAUDE || "claude";
// Modèles (famille Claude 5). Le vocal tourne sur Sonnet : Opus coûte +11 s par tour
// pour un gain nul sur des réponses de 2-3 phrases.
const SONNET = process.env.VLAD_FAST || "claude-sonnet-5";
const OPUS = process.env.VLAD_DEEP || "claude-opus-5";
// Démarrage ALLÉGÉ : coupe MCP + skills.
const LEAN = ["--strict-mcp-config", "--disable-slash-commands"];

// ── Contexte MINIMAL pour le vocal ────────────────────────────────────────────
// Mesuré : le prompt système par défaut de Claude Code charge 36 899 tokens (outils,
// sous-agents, plugins) — soit 0,22 $ et ~8 s pour dire « bonjour ». En remplaçant le
// prompt système et en coupant presque tout : ~3 300 tokens, 0,02 $.
// On garde UNIQUEMENT Read/Grep/Glob (~2 000 tokens) : lecture seule du Vault,
// pour que « qu'a-t-on noté sur X ? » réponde depuis les vraies notes.
const NO_TOOLS = ["Task", "Artifact", "Bash", "CronCreate", "CronDelete", "CronList",
  "DesignSync", "Edit", "EnterWorktree", "ExitWorktree", "Monitor", "NotebookEdit",
  "PushNotification", "RemoteTrigger", "ReportFindings", "ScheduleWakeup",
  "SendMessage", "TaskCreate", "TaskGet", "TaskList", "TaskOutput", "TaskStop",
  "TaskUpdate", "ToolSearch", "Workflow", "Write"].join(",");
// Mémoire persistante facultative (ex. le dossier memory/ d'un projet Claude Code), hors du repo.
const MEMORY_DIR = process.env.VLAD_MEMORY_DIR || "";

// Dossier des documents fournis par l'utilisateur (lecture seule par VLAD)
const UPLOADS = path.join(ROOT, ".uploads");
try { fs.mkdirSync(UPLOADS, { recursive: true }); } catch {}

// ── PROGRÈS : tâches de travail + habitudes + check-in (tracker.json) ──
// Le cerveau LIT /tmp/vlad_tracker.json (résumé réécrit à chaque changement)
// et ÉCRIT via le marqueur [[TACHE: …]] exécuté sans confirmation (jamais de
// suppression par ce canal : supprimer = mode action, donc confirmation vocale).
const tracker = require("./tracker.js");
const TRACKER_OUT = "/tmp/vlad_tracker.json";
function trackerSync() { try { fs.writeFileSync(TRACKER_OUT, JSON.stringify(tracker.snapshot(), null, 1)); } catch {} }
trackerSync();
// Voix. ⚠️ ff_siwis est la SEULE voix française de Kokoro — elle doit rester en
// tête, car VOICES[0] est le défaut du HUD. am_michael est une voix américaine :
// en défaut, elle lisait le français avec un accent anglais (le « bug de la voix »).
// engine "say" → macOS ; engine "kokoro" → worker Kokoro (kid = voix Kokoro).
// Sélecteur ÉPURÉ (demande de l'utilisateur) : Siwis + uniquement les voix macOS
// Premium/Enhanced téléchargées (les voix de base et fantaisie sont exclues).
// ⚠️ Les voix SIRI (Voice 1/2) sont verrouillées par Apple : invisibles pour
// `say` et toute app tierce — impossible de les brancher, vérifié le 03/08.
// LA voix de VLAD (14/09) : ElevenLabs si ELEVEN_KEY + ELEVEN_VOICE sont dans
// .env, sinon Rémy (Edge). Cascade de secours dans speak()/synthToFile :
// ElevenLabs → Rémy → Siwis — VLAD ne reste jamais muet, jamais de voix à accent.
const EDGE_BIN = path.join(ROOT, ".venv", "bin", "edge-tts");
const VOICES = [];
if (process.env.ELEVEN_KEY && process.env.ELEVEN_VOICE)
  VOICES.push({ id: "eleven:main", label: "ElevenLabs ✦", genre: "masculine", engine: "eleven" });
if (fs.existsSync(EDGE_BIN))
  VOICES.push({ id: "edge:remy", label: "Rémy ✦", genre: "masculine", engine: "edge", kid: "fr-FR-RemyMultilingualNeural" });
if (!VOICES.length)
  VOICES.push({ id: "kok:ff_siwis", label: "Siwis (FR)", genre: "féminine", engine: "kokoro", kid: "ff_siwis" });
const voiceById = (id) => VOICES.find((v) => v.id === id) || VOICES[0];
// liste publique (sans champs internes)
const publicVoices = () => VOICES.map(({ id, label, genre }) => ({ id, label, genre }));

// Découverte des voix françaises macOS : toute voix installée dans
// Réglages → Accessibilité → Contenu énoncé → Voix système (y compris les
// variantes Premium/Enhanced téléchargées) apparaît dans le sélecteur au boot.
function loadSayVoices() {
  const p = spawn("say", ["-v", "?"]);
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.on("close", () => {
    for (const line of out.split("\n")) {
      const m = line.match(/^(.+?)\s+(fr_[A-Z]{2})\s+#/);
      if (!m) continue;
      const sysid = m[1].trim();
      if (VOICES.some((v) => v.sysid === sysid)) continue;
      // sélecteur épuré : Premium/Enhanced + les vraies voix de base FR (Thomas, Jacques,
      // Amélie) — seules les voix fantaisie (Eddy, Grandma, Rocko…) restent exclues.
      const isPremium = /\((Premium|Enhanced|Améliorée)\)/i.test(sysid);
      const isRealBase = /^(Thomas|Jacques|Amélie)$/.test(sysid);
      if (!isPremium && !isRealBase) continue;
      const short = sysid.replace(/\s*\(French \((France|Canada)\)\)/, "").replace(/\s*\((Premium|Enhanced|Améliorée)\)/i, " ✚");
      const cc = m[2] === "fr_FR" ? "FR" : "CA";
      VOICES.push({ id: "say:" + sysid, label: `${short} (${cc})`, genre: "macOS", engine: "say", sysid });
    }
    // priorité de l'utilisateur : la voix MASCULINE naturelle en défaut quand elle existe
    // (Thomas Enhanced > Thomas base ; ElevenLabs, si actif, reste devant tout)
    const pref = VOICES.find((v) => /^Thomas \(/i.test(v.sysid || "")) || VOICES.find((v) => v.sysid === "Thomas");
    if (pref && VOICES[0]?.engine !== "eleven" && VOICES[0]?.engine !== "edge") { VOICES.splice(VOICES.indexOf(pref), 1); VOICES.unshift(pref); }
    console.log(`   voix macOS FR (Premium/Enhanced) : ${VOICES.filter((v) => v.engine === "say").length}${pref ? " · défaut : " + pref.label : ""}`);
  });
  p.on("error", () => {});
}

// Qui est l'utilisateur : à régler dans .env (VLAD_USER, VLAD_COMPANY, VLAD_CALENDAR).
const USER = process.env.VLAD_USER || "l'utilisateur";
const COMPANY = process.env.VLAD_COMPANY ? " (" + process.env.VLAD_COMPANY + ")" : "";
const CALENDAR = process.env.VLAD_CALENDAR || "Calendrier";

const PERSONA =
  "Tu es VLAD — Virtual Logic Assistance Director — l'assistant vocal personnel de " + USER + COMPANY + ". " +
  "Tu te présentes comme VLAD, jamais comme un modèle d'IA. " +
  "Réponds TOUJOURS en français, ton naturel et posé, CONCIS (2-3 phrases sauf demande de détails). " +
  "Ta réponse est LUE À VOIX HAUTE : écris pour l'oral — pas de markdown, pas de listes à puces, " +
  "pas de blocs de code, pas d'emojis, pas de symboles ; des phrases complètes et fluides. " +
  "Tu te souviens du fil de la conversation. " +
  "Tu PEUX chercher et lire des fichiers partout sur le Mac de " + USER + " (Read, Grep, Glob) " +
  "et chercher sur le web (WebSearch, WebFetch) : quand on te demande de retrouver un fichier, " +
  "un dossier ou une info, CHERCHE vraiment au lieu de dire que tu ne peux pas. " +
  "MAILS en LECTURE : /tmp/vlad_mail.json contient le tri des derniers mails (urgents, à répondre, " +
  "compteurs) — lis-le avec Read pour tout point mails ; propose des rappels ou rendez-vous en mode action si pertinent. " +
  "Pour lire le CONTENU COMPLET d'un fil (« lis le mail de… », « résume l'échange avec… »), " +
  "réponds UNIQUEMENT par le marqueur [[MAIL: <mots de recherche : noms, sujet>]] — RIEN d'autre, pas un mot : " +
  "le pont lit la boîte mail et te redonne la main avec le texte des mails ; ta réponse suivante s'appuie dessus. " +
  "Exemple : [[MAIL: martin devis cuisine]]. " +
  "AGENDA en LECTURE : le fichier /tmp/vlad_agenda.json contient les événements à venir " +
  "(JSON, rafraîchi toutes les 5 minutes) — lis-le avec Read pour tout point ou résumé d'agenda. " +
  "Il peut réunir PLUSIEURS calendriers : le champ cal indique la provenance (pro, perso…) — précise-la quand c'est utile. " +
  "HEURES : utilise UNIQUEMENT le champ quand (déjà en heure locale, prêt à dire) — " +
  "n'interprète JAMAIS les champs start/end, ils sont en UTC et te feraient dire des heures fausses. " +
  "Calendly (/tmp/vlad_calendly.json), s'il existe, liste les RENDEZ-VOUS CLIENTS pris en ligne — lecture seule, jamais en mode action. " +
  "AGENDA LOCAL : " + path.join(ROOT, "agenda-local.json") + " contient les événements saisis dans VLAD qui ne sont dans aucun agenda en ligne ; " +
  "ils apparaissent déjà dans /tmp/vlad_agenda.json. Pour AJOUTER, déplacer ou retirer un de ces événements, c'est un MODE ACTION : " +
  "édition de ce JSON, structure conservée ({events:[{id,title,start,end,allDay,cal,place,desc}]}, heures ISO avec le fuseau local). " +
  "TON CARNET : " + path.join(ROOT, "MEMOIRE-VLAD.md") + " est TA mémoire personnelle — " +
  "ce que " + USER + " t'a appris de vive voix. Lis-le avec Read dès qu'une question porte sur " +
  "ses préférences, ses habitudes ou quelque chose qu'il t'a déjà dit. Quand on te demande de " +
  "retenir quelque chose (« retiens que… », « souviens-toi… », « note que… »), c'est un MODE ACTION : " +
  "tu proposes d'ajouter la ligne au carnet et tu émets le marqueur, par exemple " +
  "[[ACTION: ajoute la ligne « - [2026-09-14] le devis Dupont est à 1500 euros » à la fin de la section « À retenir » de " +
  path.join(ROOT, "MEMOIRE-VLAD.md") + ", sans rien modifier d'autre]]. " +
  "CAP (tâches + habitudes) : le fichier " + TRACKER_OUT + " résume la semaine — " +
  "tâches par jour (✓ faite, ☐ à faire), habitudes faites aujourd'hui et leurs séries, check-in mental. " +
  "Lis-le pour « qu'est-ce que j'ai à faire », « où j'en suis », « ma série sport ». " +
  "Pour ÉCRIRE (ajouter, cocher, décocher une tâche ; cocher une habitude ; noter le check-in), " +
  "n'utilise PAS le mode action : réponds en une phrase courte puis termine par un marqueur EXACT, " +
  "sur une ligne à part, jamais lu : [[TACHE: add|<jour>|<texte>]] (jour = aujourd'hui, demain, jeudi, 18/09 ou AAAA-MM-JJ ; " +
  "vide = aujourd'hui). Tâche RÉPÉTÉE (« tous les jours », « chaque lundi », « chaque mois ») : ajoute |jour, |semaine ou |mois " +
  "en 4e champ — [[TACHE: add|lundi|Point équipe|semaine]] répète chaque lundi. [[TACHE: done|<mots de la tâche>]], [[TACHE: undone|<mots>]], " +
  "[[TACHE: habit|<nom>|done]] ou |undone, [[TACHE: mind|<énergie>|<focus>|<motivation>]] (sur 10). " +
  "Quand on te dit avoir assisté à un rendez-vous (ou l'avoir manqué) et comment ça s'est passé : " +
  "[[TACHE: rdv|<jour>|<mots du titre>|fait ou rate|<note courte, ses mots>]] — " +
  "ex : [[TACHE: rdv|aujourd'hui|réunion fournisseur|fait|Très bien passée, commande validée]]. " +
  "Les habitudes peuvent être rangées en groupes ; celles marquées jours ouvrés ne comptent pas le week-end. " +
  "Plusieurs marqueurs possibles. Exemple : « C'est noté pour jeudi. [[TACHE: add|jeudi|Appeler Martin]] ». " +
  "SUPPRIMER une tâche reste une action confirmée : [[ACTION: exécute node " + path.join(ROOT, "voice", "tracker.js") + " del \"<mots de la tâche>\"]]. " +
  "BASE CLIENTS : le fichier " + path.join(ROOT, "clients.json") + ", s'il existe, est la base clients " +
  "(nom, contact, statut, projets, notes) — lis-le pour toute question client ; " +
  "ajouter ou mettre à jour une fiche = MODE ACTION (édition de ce JSON, structure conservée). " +
  "IMPORTANT : quand tu dois chercher (fichiers ou web), commence TOUJOURS ta réponse par une " +
  "courte phrase parlée du genre Je regarde ça ou Je cherche, AVANT d'appeler le moindre outil — " +
  "elle sera lue pendant que tu cherches, et personne n'attend en silence. " +
  "MODE ACTION : si on te demande de modifier, déplacer, renommer, créer ou supprimer " +
  "quelque chose, tu ne l'exécutes pas toi-même. Tu décris l'action en UNE phrase précise et tu " +
  "demandes confirmation (par exemple : Je supprime le dossier Essais du Bureau, je confirme ?). " +
  "Puis tu termines ta réponse, sur une ligne à part, par le marqueur EXACT : " +
  "[[ACTION: instruction impérative autonome avec chemins absolus]] — ce marqueur n'est jamais lu. " +
  "N'émets JAMAIS ce marqueur sans demande explicite de modification. " +
  "Si on te dit ensuite confirme ou vas-y, le système exécute ; si on dit annule, tout s'arrête. " +
  "L'AGENDA et les RAPPELS passent aussi par le mode action : créer, modifier, déplacer ou supprimer " +
  "un événement se fait via osascript sur l'app Calendrier du Mac, calendrier « " + CALENDAR + " » ; " +
  "les rappels via l'app Rappels. Exemple de marqueur : " +
  "[[ACTION: crée via osascript dans l'app Calendrier, calendrier " + CALENDAR + ", l'événement Rendez-vous banque le 12 octobre 2026 de 9h à 10h]]. " +
  "Tu as accès EN LECTURE au Vault. Sources, dans l'ordre où chercher : " +
  (MEMORY_DIR ? "1) les fiches mémoire dans " + MEMORY_DIR + " — commence par Grep dans ce dossier ; 2) " : "") +
  "les notes dans vault/ et les skills dans skills/ (relatifs au dossier de VLAD). " +
  "INDEX DES SOURCES : " + path.join(ROOT, "vault", "sources") + " contient une fiche par skill, agent, fichier CLAUDE.md, mémoire, " +
  "note Obsidian ou document importé — un résumé et le chemin du fichier d'origine (ligne Fichier d'origine). " +
  "Cherche d'abord par Grep dans ce dossier, puis lis l'ORIGINAL avec Read quand il faut le détail. " +
  "Quand on te pose une question sur des projets, clients, dossiers, prix ou notes, CHERCHE d'abord " +
  "avec Grep (insensible à la casse), puis lis le fichier pertinent avec Read, et réponds en une " +
  "synthèse orale courte. Ne récite jamais un fichier entier.";

// Mode DOCUMENT : analyse juridique/contrat/scan, détaillée et précise (lue à l'écran).
const DOC_PERSONA =
  "Tu es VLAD, assistant de " + USER + COMPANY + ". Tu analyses un ou plusieurs documents " +
  "fournis (souvent contrats ou actes juridiques, parfois des SCANS d'images). Procède ainsi : " +
  "si c'est un scan ou un PDF image, lis-le avec l'OCR (outils pdf-tools : ocr_pdf, extract_text, extract_tables) ; " +
  "sinon lis-le avec Read. Réponds en français. " +
  "Commence par un RÉSUMÉ de 2 phrases maximum (il sera lu à voix haute), puis une ANALYSE DÉTAILLÉE et " +
  "structurée : nature du document, parties, dates et durées, montants, obligations de chaque partie, " +
  "clauses sensibles ou à risque (résiliation, reconduction, pénalités, responsabilité, confidentialité), " +
  "échéances importantes, et points ambigus ou manquants. Sois précis, cite les passages clés et les chiffres. " +
  "Tu n'es pas avocat : précise que c'est une analyse indicative. " +
  "IMPORTANT : écris en TEXTE BRUT lisible, SANS markdown — pas de dièses, pas d'astérisques, pas de tableaux, " +
  "pas de listes à puces avec tirets ; utilise des paragraphes courts, chacun introduit par un intitulé suivi de deux points.";

const PDF_MCP = path.join(__dirname, "pdf-mcp.json");
// retire un éventuel markdown résiduel (pour la voix et l'affichage propre)
const stripMd = (t) => (t || "").replace(/[#*`_>|]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\n{2,}/g, "\n").trim();
const firstSentences = (t, n) => { const c = stripMd(t); const m = c.match(/[^.!?…]*[.!?…]+/g) || [c]; return m.slice(0, n).join(" ").trim() || c.slice(0, 200); };

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });
}

// ── Worker STT persistant : modèle Whisper chargé UNE fois, puis prêt instantanément ──
const STT_WORKER = path.join(__dirname, "stt-worker.py");
let stt = null, sttReady = false, sttQueue = [], sttBuf = "";

function startSTT() {
  if (path.isAbsolute(PYTHON) && !fs.existsSync(PYTHON)) {   // voix locale pas installée : VLAD reste utilisable en texte
    console.error("   STT : Python introuvable (" + PYTHON + ") — lance « bash setup.sh » pour la voix locale");
    return;
  }
  stt = spawn(PYTHON, ["-u", STT_WORKER], { cwd: ROOT });
  stt.stdout.on("data", (chunk) => {
    sttBuf += chunk.toString();
    let i;
    while ((i = sttBuf.indexOf("\n")) >= 0) {
      const line = sttBuf.slice(0, i).trim(); sttBuf = sttBuf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === "ready") { sttReady = true; console.log("   STT : modèle Whisper chargé, prêt ✓"); continue; }
      if (msg.event === "listening") continue;             // (le HUD pourrait l'afficher plus tard)
      // résultat d'une prise → on résout la 1ʳᵉ requête en attente
      const job = sttQueue.shift();
      if (job) job(msg);
    }
  });
  stt.stderr.on("data", (d) => { const s = String(d).trim(); if (s) console.error("   [stt]", s.slice(-200)); });
  stt.on("close", () => { sttReady = false; console.error("   STT : worker arrêté, relance dans 1 s…"); setTimeout(startSTT, 1000); });
  stt.on("error", (e) => console.error("   STT : échec démarrage", String(e)));
}

function listen() {
  return new Promise((resolve) => {
    if (!stt || !sttReady) return resolve({ error: "stt_not_ready" });
    sttQueue.push(resolve);
    stt.stdin.write("LISTEN\n");
  });
}

// Transcrit un FICHIER audio (micro iPhone envoyé via /transcribe) — même worker, même file
let phoneN = 0;
function transcribeFile(p) {
  return new Promise((resolve) => {
    if (!stt || !sttReady) return resolve({ error: "stt_not_ready" });
    sttQueue.push(resolve);
    stt.stdin.write(JSON.stringify({ file: p }) + "\n");
  });
}

// ── Worker TTS persistant : Kokoro chargé UNE fois → voix neuronale FR ──
const TTS_WORKER = path.join(__dirname, "tts-worker.py");
let tts = null, ttsReady = false, ttsQueue = [], ttsBuf = "";

function startTTS() {
  if (path.isAbsolute(PYTHON) && !fs.existsSync(PYTHON)) {   // voix locale pas installée : VLAD reste utilisable en texte
    console.error("   TTS : Python introuvable (" + PYTHON + ") — lance « bash setup.sh » pour la voix locale");
    return;
  }
  tts = spawn(PYTHON, ["-u", TTS_WORKER], { cwd: ROOT });
  tts.stdout.on("data", (chunk) => {
    ttsBuf += chunk.toString();
    let i;
    while ((i = ttsBuf.indexOf("\n")) >= 0) {
      const line = ttsBuf.slice(0, i).trim(); ttsBuf = ttsBuf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === "ready") { ttsReady = true; console.log("   TTS : moteur Kokoro chargé, prêt ✓"); continue; }
      const job = ttsQueue.shift();
      if (job) job(msg);
    }
  });
  tts.stderr.on("data", (d) => { const s = String(d).trim(); if (s && !/Warning|Future|repo_id|weight_norm|dropout/.test(s)) console.error("   [tts]", s.slice(-200)); });
  tts.on("close", () => { ttsReady = false; console.error("   TTS : worker arrêté, relance dans 1 s…"); setTimeout(startTTS, 1000); });
  tts.on("error", (e) => console.error("   TTS : échec démarrage", String(e)));
}

function kokoroSynth(kid, text) {
  return new Promise((resolve) => {
    if (!tts || !ttsReady) return resolve({ error: "tts_not_ready" });
    ttsQueue.push(resolve);
    tts.stdin.write(JSON.stringify({ voice: kid, text }) + "\n");
  });
}

// Force la prononciation du « s » final de VLAD (sinon le FR dit « Jarvi »)
// Prononciations : corrige l'ORAL sans toucher l'écrit (le journal garde l'orthographe).
const sayable = (t) => String(t)
  .replace(/\bvlad\b/gi, "Vlad")
  // termes techniques : réécriture phonétique française (les TTS FR disent sinon
  // « frontan / backan »...) — étendre ici au fil des remontées de l'utilisateur
  .replace(/\bfront[\s-]?end\b/gi, "frontènde")
  .replace(/\bback[\s-]?end\b/gi, "backènde")
  .replace(/\bfull[\s-]?stack\b/gi, "foule-staque")
  .replace(/\bgithub\b/gi, "Guiteube")
  .replace(/\bgit\b/gi, "guitte")
  // API du DOM / JavaScript (vérifié à l'oreille Whisper le 16/09 : « jette l'émambide »…)
  .replace(/\bgetElementsByClassName\b/gi, "guett élémentse baï classe néïme")
  .replace(/\bgetElementsByTagName\b/gi, "guett élémentse baï tague néïme")
  .replace(/\bgetElementById\b/gi, "guett élémente baï aïdi")
  .replace(/\bquerySelectorAll\b/gi, "couéri sélècteur ôl")
  .replace(/\bquerySelector\b/gi, "couéri sélècteur")
  .replace(/\binnerHTML\b/gi, "inneur HTML")
  .replace(/\btextContent\b/gi, "texte contènte")
  .replace(/\bcreateElement\b/gi, "cri-éïte élémente")
  .replace(/\bappendChild\b/gi, "appènde tchaïlde")
  .replace(/\bremoveChild\b/gi, "rimouve tchaïlde")
  .replace(/\baddEventListener\b/gi, "adde évènte lisseneur")
  .replace(/\bclassList\b/gi, "classe liste")
  .replace(/\bNodeList\b/gi, "nôde liste")
  .replace(/\bsetAttribute\b/gi, "sett attribute")
  .replace(/\bgetAttribute\b/gi, "guett attribute");

// ── ElevenLabs (optionnel) : LA voix naturelle, activée dès que la clé est posée ──
// .env : ELEVEN_KEY=sk_…  +  ELEVEN_VOICE=<voice_id choisi sur elevenlabs.io>
// Modèle Flash v2.5 : ~75 ms de synthèse, français natif — compatible pipeline phrase à phrase.
let elevenN = 0;
let edgeN = 0;
async function elevenSynth(text) {
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    }
  );
  if (!r.ok) throw new Error("ElevenLabs HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const p = `/tmp/vlad_11_${elevenN++ % 4}.mp3`;
  fs.writeFileSync(p, buf);
  return p;
}

// Edge TTS → fichier mp3, avec UN retry : les pannes Edge sont presque toujours
// transitoires, et le repli Siwis CHANGE la voix — Rémy est la seule voix validée.
function edgeSynthFile(kid, text, p, attempt = 0) {
  return new Promise((ok, ko) => {
    const c = spawn(EDGE_BIN, ["--voice", kid, "--text", text, "--write-media", p]);
    c.on("close", (code) => (code === 0 ? ok() : ko(new Error("edge-tts " + code))));
    c.on("error", ko);
    setTimeout(() => { try { c.kill(); } catch {} ko(new Error("edge-tts timeout")); }, 15000);
  }).catch((e) => {
    if (attempt >= 1) throw e;
    console.error("   [edge] retry après", String(e).slice(-60));
    return edgeSynthFile(kid, text, p, 1);
  });
}

// Parle un texte avec la voix choisie (Apple `say` ou Kokoro). Revient quand l'audio est fini.
// speakingCount > 0 ⇔ de l'audio joue MAINTENANT (le HUD interroge /state pour n'animer que là).
let speakingCount = 0;
async function speak(voiceId, rawText) {
  const text = sayable(rawText);
  const v = voiceById(voiceId);
  speakingCount++;
  // trace de CHAQUE phrase : moteur réellement utilisé (diagnostic « mauvaise voix »)
  console.log("   [voix]", v.id, "→", text.slice(0, 40));
  try {
    if (v.engine === "edge") {
      // (Rémy = seule voix validée : un échec Edge est retenté avant tout repli Siwis)
      // Microsoft Edge TTS (gratuit) : mp3 en ~1 s / phrase, repli Siwis si réseau KO
      try {
        const p = `/tmp/vlad_edge_${edgeN++ % 4}.mp3`;
        await edgeSynthFile(v.kid, text, p);
        await run("afplay", [p]);
      } catch (e) {
        console.error("   [edge]", String(e).slice(-120));
        const r = await kokoroSynth("ff_siwis", text);
        if (r.wav) await run("afplay", [r.wav]);
      }
    } else if (v.engine === "eleven") {
      try { await run("afplay", [await elevenSynth(text)]); }
      catch (e) {                                       // clé/quota/réseau KO → Rémy d'abord, Siwis en dernier
        console.error("   [11labs]", String(e).slice(-120));
        try {
          const p = `/tmp/vlad_edge_${edgeN++ % 4}.mp3`;
          await edgeSynthFile("fr-FR-RemyMultilingualNeural", text, p);
          await run("afplay", [p]);
        } catch {
          const r = await kokoroSynth("ff_siwis", text);
          if (r.wav) await run("afplay", [r.wav]);
        }
      }
    } else if (v.engine === "kokoro") {
      const r = await kokoroSynth(v.kid, text);
      if (r.wav) await run("afplay", [r.wav]);
      else await run("say", ["-v", "Amélie", text]);   // repli si Kokoro indispo
    } else {
      await run("say", ["-v", v.sysid, text]);
    }
  } finally { speakingCount--; }
}

// ═══ VOIE 1 — CHAT : un SEUL process Claude, gardé vivant ════════════════════
// Avant : un `claude -p` neuf par question → ~11 s de boot avant le 1er token,
// + `--resume` qui rejouait toute la session. Mesuré à 23 s sur Opus 4.8.
// Après : le process reste ouvert, les tours passent par stdin en stream-json.
// Mesuré : boot 1,5 s une seule fois, puis 1er token à ~900 ms par tour.
let chat = null;              // { p, pending, buf } — process persistant
let chatBooting = null;       // promesse de démarrage en cours
let authExpired = false;      // session Claude expirée → voyant rouge dans /status
// Compteurs de session (télémétrie HUD) : tours, coût cumulé, latence du dernier tour.
const turnStats = { count: 0, costUSD: 0, lastMs: 0, lastAt: 0, startedAt: Date.now() };

function chatSpawn() {
  const args = ["-p", "--model", SONNET,
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--verbose", "--include-partial-messages",
    // Prompt système REMPLACÉ (pas ajouté) : c'est ce qui fait tomber 36 899 → 3 279 tokens.
    "--system-prompt", PERSONA,
    "--exclude-dynamic-system-prompt-sections",
    "--disallowedTools", NO_TOOLS,     // le vocal cause ; seuls Read/Grep/Glob restent
    "--allowedTools", "Read,Glob,Grep,WebSearch,WebFetch",   // pré-approuvés (mode -p = pas de prompt)
    "--add-dir", process.env.HOME || ROOT, // TOUT le Mac en lecture (Bureau, Docs, Downloads…)
    ...(MEMORY_DIR ? ["--add-dir", MEMORY_DIR] : []),   // fiches mémoire hors repo (VLAD_MEMORY_DIR), lecture
    "--agents", "{}",                  // sinon les 25 sous-agents SEO sont injectés
    "--settings", '{"hooks":{}}',      // pas de hook RTK sur le chemin critique
    "--no-chrome", "--no-session-persistence", ...LEAN];
  const p = spawn(CLAUDE, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  const st = { p, pending: null, buf: "" };

  p.stdout.on("data", (chunk) => {
    st.buf += chunk.toString(); let i;
    while ((i = st.buf.indexOf("\n")) >= 0) {
      const line = st.buf.slice(0, i).trim(); st.buf = st.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const q = st.pending;
      if (!q) continue;
      if (msg.type === "stream_event" && msg.event?.type === "content_block_delta"
          && msg.event.delta?.type === "text_delta") {
        q.onDelta(msg.event.delta.text || "");
      }
      if (msg.type === "result") {
        // Télémétrie réelle du tour (affichée dans le HUD, pas de la déco)
        turnStats.count++;
        turnStats.costUSD += msg.total_cost_usd || 0;
        turnStats.lastMs = msg.duration_ms || 0;
        turnStats.lastAt = Date.now();
        let out = msg.result || "";
        // Session Claude expirée (vécu 14/09 : « OAuth session expired » brut en
        // anglais dans Telegram) → phrase claire + voyant /status, et on tue le
        // process pour qu'il renaisse sur la nouvelle session après reconnexion.
        if (/OAuth session expired|Failed to authenticate|not logged in/i.test(out)) {
          authExpired = true;
          out = "Ma session Claude a expiré. Reconnecte-moi sur le Mac avec « claude auth login », je reprends tout de suite après.";
          try { st.p.kill(); } catch {}
        } else if (authExpired && out) authExpired = false;
        st.pending = null; q.done(out);
      }
    }
  });
  p.stderr.on("data", (d) => { const s = String(d).trim(); if (s) console.error("   [chat]", s.slice(-160)); });
  // EPIPE si on écrit vers un process mort : sans handler, l'erreur de stream
  // non rattrapée TUE LE PONT ENTIER (cause probable du crash du 06/08).
  p.stdin.on("error", () => {});
  const die = (code) => {
    if (st.dead) return; st.dead = true;                  // close + error = un seul die
    console.log("   [chat] process terminé (code " + code + ")");
    if (chat === st) chat = null;
    if (st.pending) { const q = st.pending; st.pending = null;
      q.done("Pardon, mon cerveau vient de redémarrer. Redis-moi ça."); }
  };
  p.on("close", die);
  p.on("error", (e) => { console.error("   [chat] " + e); die("spawn"); });
  console.log("   [chat] process démarré (pid " + p.pid + ")");
  return st;
}

// Démarre le process au boot du serveur → le 1er « dis bonjour » est déjà chaud.
// `dead` fait foi : un process sorti tout seul a killed=false — s'y fier laissait
// le pont pointer un cadavre et attendre 2 min dans le vide (vécu le 14/09).
function chatReady() {
  if (chat && !chat.dead && chat.p.exitCode === null) return Promise.resolve(chat);
  if (chatBooting) return chatBooting;
  chatBooting = new Promise((resolve) => {
    const st = chatSpawn();
    // On n'attend pas l'init : le CLI ne l'émet qu'après réception du 1er tour.
    chat = st; chatBooting = null; resolve(st);
  });
  return chatBooting;
}

// Sonde : cerveau mort hors d'un tour (session expirée, crash) → on le relance
// AVANT que l'utilisateur ne parle, plutôt que de le laisser attendre.
setInterval(() => {
  if (!chat || chat.dead || chat.p.exitCode !== null) chatReady().catch(() => {});
}, 30000);

let chatQueue = Promise.resolve();
async function chatAsk(text, onDelta) {
  // sérialise : le tour du 2e appareil ATTEND au lieu d'être jeté
  const run = chatQueue.then(() => chatAskNow(text, onDelta));
  chatQueue = run.catch(() => {});
  return run;
}
// Le fil des derniers échanges, injecté en TÊTE du 1er tour d'un cerveau neuf.
// Sans ça, un redémarrage du pont = amnésie totale alors que la conversation
// reste affichée à l'écran (« il ne se souvient plus de ce qu'on vient de dire »).
function rappelDuFil() {
  const derniers = journal.slice(-12);
  if (!derniers.length) return "";
  const fil = derniers
    .map((e) => (e.from === "you" ? USER + " : " : "Toi (VLAD) : ") + String(e.text || "").slice(0, 300))
    .join("\n");
  return "[Reprise de conversation — tu viens de redémarrer. Voici vos derniers échanges, "
    + "pour mémoire ; n'y réponds pas, réponds seulement au message qui suit.]\n"
    + fil + "\n[Fin du rappel. Message de " + USER + " maintenant :]\n";
}

async function chatAskNow(text, onDelta) {
  const st = await chatReady();
  if (st.pending) return "";                       // filet (ne devrait plus arriver)
  if (!st.primed) { st.primed = true; text = rappelDuFil() + text; }
  return new Promise((done) => {
    // Chien de garde : un tour sans réponse ne doit JAMAIS bloquer la file pour
    // toujours (c'était le « il ne répond plus » : un tour suspendu = tout en panne).
    const q = { onDelta, done: (r) => { clearTimeout(dog); done(r); } };
    const dog = setTimeout(() => {
      if (st.pending !== q) return;
      st.pending = null;
      try { st.p.kill(); } catch {}                // respawn au prochain tour (chatReady)
      done("Pardon, mon cerveau ne répondait plus, je viens de le relancer. Redis-moi ça.");
    }, 45000);   // 45 s : au-delà, mieux vaut s'excuser que laisser l'utilisateur dans le vide
    st.pending = q;
    try {
      st.p.stdin.write(JSON.stringify({
        type: "user", message: { role: "user", content: [{ type: "text", text }] },
      }) + "\n");
    } catch {
      st.pending = null; clearTimeout(dog);
      try { st.p.kill(); } catch {}
      done("Pardon, mon cerveau était tombé. Je le relance, redis-moi ça.");
    }
  });
}

// ── Pointage vocal d'un rendez-vous : [[TACHE: rdv|jour|mots|fait/rate|note]] ──
// Retrouve l'événement dans l'agenda (Google + Calendly) pour partager la même
// clé que la page Progrès ; sinon la note est gardée sous une clé de repli.
function rdvMarker(cmd) {
  const p = cmd.split("|").map((x) => x.trim());          // [rdv, jour, mots, statut, note]
  const date = tracker.parseDate(p[1]);
  const mots = (p[2] || "").split(/\s+/).map(tracker.normRdv).filter(Boolean);
  let evs = [];
  for (const f of ["/tmp/vlad_agenda.json", "/tmp/vlad_calendly.json"]) {
    try { const d = JSON.parse(fs.readFileSync(f, "utf8")); evs = evs.concat(Array.isArray(d) ? d : d.events || []); } catch {}
  }
  const locale = (iso) => { const x = new Date(iso); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const duJour = evs.filter((e) => e.start && locale(e.start) === date);
  // meilleur score de mots ; « la réunion d'aujourd'hui » sans mots-clés = l'unique événement du jour
  const score = (e) => mots.filter((m) => tracker.normRdv(e.title).includes(m)).length;
  let ev = duJour.map((e) => [score(e), e]).sort((a, b) => b[0] - a[0]).find(([n]) => n > 0)?.[1];
  if (!ev && duJour.length === 1) ev = duJour[0];
  const titre = ev ? ev.title : p[2];
  const r = tracker.setRdv(date + "|" + tracker.normRdv(titre), p[3], p[4], titre);
  return `rendez-vous « ${titre} » ${r.statut === "rate" ? "manqué" : "assisté"}${r.note ? " — " + r.note : ""}`;
}

// ── Lecture du CONTENU des mails à la demande du cerveau ([[MAIL: …]]) ──
// Le cerveau ne voit que le tri (from/sujet) ; quand il émet ce marqueur, le pont
// lit le fil complet en IMAP puis relance le tour : la 2e réponse est la bonne.
let mailLectureEnCours = false;
function lireMails(recherche) {
  return new Promise((ok, ko) => {
    const env = { ...process.env };
    const p = spawn(PYTHON, [path.join(__dirname, "mail-worker.py"), "lire", recherche], { env });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", () => {});
    const dog = setTimeout(() => { try { p.kill(); } catch {} ko(new Error("délai IMAP dépassé")); }, 60000);
    p.on("close", (code) => { clearTimeout(dog); code === 0 && out.trim() && !out.includes('"error"') ? ok(out.slice(0, 15000)) : ko(new Error(out.slice(0, 120) || "aucun mail trouvé")); });
    p.on("error", (e) => { clearTimeout(dog); ko(e); });
  });
}

// ── Cerveau : streaming + voix PAR PHRASES ──
// On parle dès la 1ʳᵉ phrase générée pendant que la suite arrive → latence perçue minimale.
function ask(text, voiceId, silent, files, remote) {
  const hasFiles = Array.isArray(files) && files.length > 0;

  // VOIE 1 — chat vocal : process persistant, sans outil d'écriture.
  // remote=true (iPhone via tunnel) : la voix n'est PAS jouée sur le Mac — chaque
  // phrase est synthétisée en mp3 unique, renvoyée en URLs que la PWA joue.
  if (!hasFiles) {
    let ttsBuf = "", full = "", chain = Promise.resolve(), markerSeen = false;
    const streamTTS = !silent;
    const audio = [];                                    // fichiers pour l'appareil distant
    const speakPiece = (s) => {
      chain = chain.then(async () => {
        try {
          if (remote) audio.push(await synthToFile(voiceId, s));
          else await speak(voiceId, s);
        } catch {}
      });
    };
    const flush = (force) => {
      if (!streamTTS) return;
      // dès que le marqueur [[ACTION commence, plus RIEN ne part vers la voix
      const cut = ttsBuf.indexOf("[[");
      if (cut >= 0) { ttsBuf = ttsBuf.slice(0, cut); markerSeen = true; }
      let m; const re = /[^.!?…\n]*[.!?…\n]+/;
      while ((m = ttsBuf.match(re))) { const s = m[0].trim(); ttsBuf = ttsBuf.slice(m[0].length); if (s.length > 1) speakPiece(s); }
      if (force && ttsBuf.trim().length > 1) { speakPiece(ttsBuf.trim()); ttsBuf = ""; }
    };
    return chatAsk(text, (d) => { full += d; if (!markerSeen) ttsBuf += d; flush(false); }).then(async (result) => {
      if (result && result.trim()) full = result;
      // extraire et armer l'action proposée (affichage et voix : marqueur retiré)
      const am = full.match(/\[\[ACTION:\s*([\s\S]*?)\]\]/);
      if (am && am[1].trim()) pendingAction = { instr: am[1].trim(), at: Date.now() };
      full = full.replace(/\[\[ACTION:[\s\S]*?\]\]/g, "").trim();
      // [[MAIL: …]] : le cerveau veut le CONTENU d'un fil — on le lit, on relance le tour
      const mm = full.match(/\[\[MAIL:\s*([^\]]+)\]\]/);
      if (mm && !mailLectureEnCours) {
        mailLectureEnCours = true;
        console.log("   [mail] lecture à la demande :", mm[1].trim());
        try {
          const contenu = await lireMails(mm[1].trim());
          return await ask(
            "[LECTURE MAILS « " + mm[1].trim() + " » — fournie par le pont, invisible pour " + USER + "]\n" + contenu +
            "\n\nRéponds maintenant à la demande initiale de " + USER + " à partir de ce contenu : à l'oral, simple, concret, sans jargon.",
            voiceId, silent, null, remote);
        } catch (e) {
          const msg = "Je n'ai pas réussi à lire la boîte mail : " + String(e.message || e).slice(0, 90);
          full = msg; if (streamTTS) speakPiece(msg);
        } finally { mailLectureEnCours = false; }
      }
      // marqueurs [[TACHE: …]] : exécutés TOUT DE SUITE (ajout/coche = sans risque)
      const echecs = [];
      for (const tm of full.matchAll(/\[\[TACHE:\s*([\s\S]*?)\]\]/g)) {
        try { console.log("   [tâche]", /^rdv\|/i.test(tm[1].trim()) ? rdvMarker(tm[1].trim()) : tracker.runMarker(tm[1])); }
        catch (e) { echecs.push(String(e.message || e)); console.error("   [tâche] ÉCHEC", tm[1], "→", e.message); }
      }
      full = full.replace(/\[\[TACHE:[\s\S]*?\]\]/g, "").trim();
      if (echecs.length) {
        const msg = "Par contre je n'ai pas réussi à l'enregistrer : " + echecs.join(" ; ") + ".";
        full += " " + msg; if (streamTTS) speakPiece(msg);
      }
      trackerSync();
      if (streamTTS) { flush(true); await chain; }
      return { response: full || "Je n'ai pas pu répondre.", model: SONNET, actionPending: !!am, audio: audio.filter(Boolean) };
    });
  }

  // VOIE 2 — document : Opus + pdf-tools + Read. Rare et lourd : on garde un
  // process dédié par requête (le boot y est négligeable devant l'OCR).
  return new Promise((resolve) => {
    const streamTTS = false;                     // docs : on lit le texte, voix = résumé seulement
    const model = OPUS;
    const prompt = "Documents fournis (lis-les ; si scan/PDF image, utilise l'OCR pdf-tools) :\n" +
      files.map((f) => "- " + f).join("\n") +
      "\n\nDemande : " + (text.trim() || "Analyse ces documents.");
    const persona = DOC_PERSONA;
    const args = ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose",
      "--include-partial-messages", "--append-system-prompt", persona];
    args.push("--strict-mcp-config", "--mcp-config", PDF_MCP, "--disable-slash-commands",
      "--allowedTools", "Read,Glob,Grep,mcp__pdf-tools", "--add-dir", UPLOADS);
    // stdin ignoré → claude n'attend pas d'entrée au clavier (sinon délai de 3 s)
    const p = spawn(CLAUDE, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });

    let buf = "", full = "", finished = false;
    const finalize = async () => {
      if (finished) return; finished = true;
      if (!silent) await speak(voiceId, firstSentences(full, 2)).catch(() => {});   // résumé parlé
      resolve({ response: stripMd(full) || "Je n'ai pas pu répondre.", model });
    };

    p.stdout.on("data", (chunk) => {
      buf += chunk.toString(); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        // Préambules + tours d'outil OCR/Read → on attend la VRAIE fin (result).
        if (msg.type === "result" && typeof msg.result === "string") {
          if (msg.result.trim()) full = msg.result;
          finalize();
        }
      }
    });
    p.stderr.on("data", (d) => { const s = String(d).trim(); if (s) console.error("   [ask]", s.slice(-160)); });
    p.on("close", () => finalize());                                   // filet de sécurité
    p.on("error", (e) => { if (!finished) { finished = true; resolve({ response: "", error: String(e), model }); } });
  });
}

// ═══ MAILS : tri automatique toutes les 10 min (IMAP + labels Gmail) ═══════════
// Garde-fou v1 : LECTURE + LABELS uniquement — aucun archivage, suppression ni
// marquage lu. Le classement est fait par un one-shot Sonnet (JSON strict).
const MAIL_WORKER = path.join(__dirname, "mail-worker.py");
const MAIL_SEEN = path.join(ROOT, ".mail-seen.json");     // uids déjà triés (cap 500)
const MAIL_OUT = "/tmp/vlad_mail.json";                    // lisible par le cerveau (Read)
const MAIL_CATS = ["VLAD/Urgent", "VLAD/À répondre", "VLAD/Facture", "VLAD/Lead", "VLAD/Info"];
let mailCache = null;   // pour GET /mail

function mailWorker(mode, input) {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, ["-u", MAIL_WORKER, mode], { cwd: ROOT });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => { try { resolve(JSON.parse(out)); } catch { resolve({ error: "sortie invalide" }); } });
    p.on("error", (e) => resolve({ error: String(e) }));
    if (input) p.stdin.write(JSON.stringify(input));
    p.stdin.end();
  });
}

// Classement : one-shot Sonnet, prompt système remplacé, AUCUN outil, JSON strict.
function classifyMails(mails) {
  return new Promise((resolve) => {
    const persona =
      "Tu tries les mails de " + USER + COMPANY + ". " +
      "Catégories EXACTES : " + MAIL_CATS.join(" | ") + ". " +
      "VLAD/Urgent = action requise vite (client, juridique, échéance) ; VLAD/À répondre = attend une réponse de " + USER + " ; " +
      "VLAD/Facture = factures, paiements, reçus ; VLAD/Lead = prospect ou demande entrante ; VLAD/Info = tout le reste " +
      "(newsletters, notifications, confirmations automatiques). " +
      "Réponds UNIQUEMENT un objet JSON {\"<uid>\": \"<catégorie>\"} — rien d'autre, pas de markdown.";
    const list = mails.map((m) => `uid=${m.uid} | de: ${m.from} | objet: ${m.subject} | extrait: ${m.snippet.slice(0, 200)}`).join("\n");
    const args = ["-p", "Trie ces mails :\n" + list, "--model", SONNET, "--output-format", "json",
      "--system-prompt", persona, "--exclude-dynamic-system-prompt-sections",
      "--disallowedTools", NO_TOOLS + ",Read,Glob,Grep,WebSearch,WebFetch",
      "--agents", "{}", "--settings", '{"hooks":{}}', "--no-chrome", "--no-session-persistence", ...LEAN];
    const p = spawn(CLAUDE, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      try {
        const res = JSON.parse(out);
        const m = String(res.result || "").match(/\{[\s\S]*\}/);
        resolve(m ? JSON.parse(m[0]) : {});
      } catch { resolve({}); }
    });
    p.on("error", () => resolve({}));
    setTimeout(() => { try { p.kill(); } catch {} resolve({}); }, 90000);
  });
}

async function mailCycle() {
  if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) return;
  const f = await mailWorker("fetch");
  if (f.error) { console.error("   [mail]", f.error); return; }
  let known = {};
  try {
    const raw = JSON.parse(fs.readFileSync(MAIL_SEEN, "utf8"));
    known = Array.isArray(raw) ? Object.fromEntries(raw.map((u) => [u, "VLAD/Info"])) : raw;   // migration ancien format
  } catch {}
  const fresh = (f.mails || []).filter((m) => !(m.uid in known));
  if (fresh.length) {
    const labels = await classifyMails(fresh);
    const valid = Object.fromEntries(Object.entries(labels).filter(([, c]) => MAIL_CATS.includes(c)));
    if (Object.keys(valid).length) {
      const r = await mailWorker("label", { labels: valid });
      console.log(`   [mail] ${fresh.length} nouveaux · ${r.labelled || 0} étiquetés`);
    }
    fresh.forEach((m) => { known[m.uid] = valid[m.uid] || "VLAD/Info"; });
    const keys = Object.keys(known).slice(-500);
    fs.writeFileSync(MAIL_SEEN, JSON.stringify(Object.fromEntries(keys.map((k) => [k, known[k]]))));
  }
  // fils de conversation : qui a parlé en dernier ? (14 jours, Envoyés croisés)
  const th = await mailWorker("threads");
  const fils = th.threads || [];

  // état lisible : widget (/mail) + cerveau (« fais le point » → Read)
  const cat = (m) => known[m.uid] || "";
  const brief = {
    at: new Date().toISOString(),
    nonLus: f.unseen || 0,
    urgent: (f.mails || []).filter((m) => cat(m) === "VLAD/Urgent").map((m) => ({ from: m.from, subject: m.subject })),
    aRepondre: (f.mails || []).filter((m) => cat(m) === "VLAD/À répondre").map((m) => ({ from: m.from, subject: m.subject })),
    recents: (f.mails || []).map((m) => ({ from: m.from, subject: m.subject, cat: cat(m) || "en attente de tri" })),
    filsATraiter: fils.filter((t) => t.status === "a_traiter"),
    filsRepondus: fils.filter((t) => t.status === "repondu"),
  };
  mailCache = brief;
  try { fs.writeFileSync(MAIL_OUT, JSON.stringify(brief, null, 1)); } catch {}
}

function startMailLoop() {
  if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) return;
  console.log("   mails : tri automatique actif (10 min) — lecture + labels seulement");
  setTimeout(mailCycle, 20000);            // 1er passage après le boot
  setInterval(mailCycle, 10 * 60 * 1000);

}

// ── Synthèse vers FICHIER UNIQUE : la voix est jouée sur l'APPAREIL distant ──
// (iPhone via tunnel : afplay sur le Mac serait inaudible). Nom horodaté → pas de
// course entre requêtes ; ménage automatique des fichiers > 10 min.
let sndN = 0;
async function synthToFile(voiceId, rawText) {
  const text = sayable(rawText);
  const v = voiceById(voiceId);
  const out = `vlad_snd_${Date.now()}_${sndN++}`;
  try {
    if (v.engine === "edge") {
      console.log("   [voix distante]", v.id, "→", text.slice(0, 40));
      await edgeSynthFile(v.kid, text, `/tmp/${out}.mp3`);
      return out + ".mp3";
    }
    if (v.engine === "eleven") {
      try {
        fs.copyFileSync(await elevenSynth(text), `/tmp/${out}.mp3`);
      } catch (e) {                                    // quota/réseau KO → Rémy (puis Siwis via le catch global)
        console.error("   [11labs]", String(e).slice(-120));
        await edgeSynthFile("fr-FR-RemyMultilingualNeural", text, `/tmp/${out}.mp3`);
      }
      return out + ".mp3";
    }
  } catch (e) { console.error("   [snd]", String(e).slice(-100)); }
  try {                                                  // repli local : Kokoro
    const r = await kokoroSynth("ff_siwis", text);
    if (r.wav) { fs.copyFileSync(r.wav, `/tmp/${out}.wav`); return out + ".wav"; }
  } catch {}
  return null;
}
setInterval(() => {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync("/tmp"))
      if (f.startsWith("vlad_snd_") && now - fs.statSync("/tmp/" + f).mtimeMs > 10 * 60 * 1000)
        fs.unlinkSync("/tmp/" + f);
  } catch {}
}, 10 * 60 * 1000);

// ── MODE ACTION : exécuteur one-shot, lancé SEULEMENT après confirmation vocale ──
// L'instruction vient du marqueur [[ACTION: …]] posé par la voie conversation (qui, elle,
// n'a aucun outil d'écriture). Un process par action ; il meurt après. Périmètre : HOME.
const EXEC_PERSONA =
  "Tu exécutes EXACTEMENT l'action demandée, rien d'autre : pas d'initiative, pas d'action voisine, " +
  "pas de nettoyage bonus. Si l'action est ambiguë ou la cible introuvable, ne fais RIEN et dis-le. " +
  "Agenda : utilise osascript sur l'app Calendrier (calendrier « " + CALENDAR + " ») ; " +
  "rappels : osascript sur l'app Rappels. Dates AppleScript : construis-les avec « date \\\"...\\\" » au format " +
  "de la locale, ou via current date modifié — vérifie le résultat après création. " +
  "Réponds en français, 1-2 phrases parlées : ce qui a été fait, ou pourquoi rien ne l'a été.";
function runAction(instr) {
  return new Promise((resolve) => {
    const args = ["-p", instr, "--model", SONNET, "--output-format", "stream-json", "--verbose",
      "--system-prompt", EXEC_PERSONA, "--exclude-dynamic-system-prompt-sections",
      "--allowedTools", "Bash,Read,Edit,Write,Glob,Grep",
      "--permission-mode", "acceptEdits",
      "--add-dir", process.env.HOME || ROOT,
      "--agents", "{}", "--settings", '{"hooks":{}}', "--no-chrome", "--no-session-persistence", ...LEAN];
    const p = spawn(CLAUDE, args, { cwd: process.env.HOME || ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", out = "", done = false;
    const finish = (msg) => { if (!done) { done = true; resolve(msg); } };
    p.stdout.on("data", (chunk) => {
      buf += chunk.toString(); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === "result" && typeof m.result === "string") { out = m.result; finish(out); }
      }
    });
    p.stderr.on("data", (d) => { const t = String(d).trim(); if (t) console.error("   [action]", t.slice(-160)); });
    p.on("close", () => finish(out || "L'action n'a pas abouti."));
    p.on("error", (e) => finish("Erreur d'exécution : " + e));
    setTimeout(() => { try { p.kill(); } catch {} finish(out || "Délai dépassé, action interrompue."); }, 120000);
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.on("error", (e) => resolve({ code: -1, out: "", err: String(e) }));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  // le pont répond sur / ET sur /api/ (même origine via proxy Vite ou tunnel Cloudflare)
  const url = req.url.split("?")[0].replace(/^\/api(?=\/)/, "");

  if (await widgetsApi.handle(req, res, url, send, body)) return;
  if (req.method === "GET" && url === "/status") return send(res, 200, { sttReady, ttsReady, model: SONNET, authExpired });
  // brief du matin à la demande (test, ou « envoie-moi le brief » hors horaire)
  if (req.method === "POST" && url === "/brief") { briefDuMatin(true); return send(res, 200, { ok: true, note: "brief en cours → Telegram" }); }
  if (req.method === "POST" && url === "/consolider") { consoliderMemoire(true); return send(res, 200, { ok: true, note: "consolidation en cours" }); }

  // test des rappels : envoie tout de suite le rappel du PROCHAIN rendez-vous (format réel)
  if (req.method === "POST" && url === "/rappel/test") {
    const now = Date.now();
    const evs = [...((calCache && calCache.events) || []).filter((e) => !e.allDay), ...((calendlyCache && calendlyCache.events) || [])]
      .filter((e) => new Date(e.start).getTime() > now).sort((a, b) => new Date(a.start) - new Date(b.start));
    const e = evs[0]; if (!e) return send(res, 200, { ok: false, note: "aucun rendez-vous à venir" });
    const h = new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", "h");
    const jour = new Date(e.start).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
    const txt = `⏰ (test) ${jour} à ${h} : ${e.title}${e.who ? " · " + e.who : ""} — les vrais rappels partiront ${RAPPEL_MINUTES.map((m) => m >= 60 && m % 60 === 0 ? m / 60 + " h" : m + " min").join(" et ")} avant.`;
    if (TG_TOKEN && tgChat) tgApi("sendMessage", { chat_id: tgChat, text: txt }).catch(() => {});
    return send(res, 200, { ok: true, texte: txt });
  }
  if (req.method === "POST" && url === "/rapport") { rapportSemaine(true); return send(res, 200, { ok: true, note: "rapport en cours → Telegram + journal" }); }
  if (req.method === "GET" && url === "/rapport") { try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(ROOT, ".rapport.json"), "utf8"))); } catch { return send(res, 200, { at: null, texte: "" }); } }
  // ── CAP (page + widget) : lecture complète, écritures unitaires ──
  if (req.method === "GET" && url === "/tracker") { const t = tracker.materialiser(); return send(res, 200, { ...t, today: tracker.today(), journee: tracker.journee(t) }); }
  if (req.method === "POST" && url.startsWith("/tracker/")) {
    const b = await body(req);
    try {
      let r;
      if (url === "/tracker/task") r = b.freq && b.freq !== "une fois" ? tracker.addRecurrent(b.text, b.freq, b.date) : tracker.addTask(b.text, b.date);
      else if (url === "/tracker/rdv") r = tracker.setRdv(b.cle, b.statut, b.note, b.titre);
      else if (url === "/tracker/journee") r = tracker.setJournee(b.texte || "");
      else if (url === "/tracker/recurrent/delete") r = tracker.delRecurrent(b.rid);
      else if (url === "/tracker/recurrent/skip") r = tracker.sauterRecurrent(b.rid, b.date);
      else if (url === "/tracker/task/toggle") r = tracker.setTaskById(b.id, !!b.done);
      else if (url === "/tracker/task/delete") r = tracker.delTaskById(b.id);
      else if (url === "/tracker/habit") r = tracker.setHabit(b.habit, !!b.done, b.date);
      else if (url === "/tracker/habits") r = tracker.setHabits(b.habits || []);
      else if (url === "/tracker/mind") r = tracker.setMind(b.e, b.f, b.m, b.date);
      else return send(res, 404, { error: "inconnu" });
      trackerSync();
      return send(res, 200, { ok: true, result: r });
    } catch (e) { return send(res, 400, { error: String(e.message || e) }); }
  }

  if (req.method === "GET" && url === "/state") return send(res, 200, { speaking: speakingCount > 0 });

  if (req.method === "GET" && url === "/vault") {
    try {
      // Cache invalidé par EMPREINTE des dossiers sources : ajoute une note, un skill
      // ou une fiche mémoire dans N'IMPORTE quelle session → le prochain affichage
      // du Vault reconstruit le graphe. Plus besoin de ?refresh ni de redémarrer.
      const sig = vaultSignature();
      if (!vaultCache || sig !== vaultSig || req.url.includes("refresh")) {
        vaultCache = await buildVault(CLAUDE);
        vaultSig = sig;
      }
      return send(res, 200, vaultCache);
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }

  if (req.method === "GET" && url === "/voices") return send(res, 200, { voices: publicVoices() });

  // Projets & dossiers importants (projects.json) — activité = mtime du dossier
  if (req.method === "GET" && url === "/projects") {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "projects.json"), "utf8"));
      const home = process.env.HOME || "";
      const now = Date.now();
      const projects = (cfg.projects || []).map((p) => {
        const abs = path.isAbsolute(p.path) ? p.path : path.join(home, p.path);
        let mtime = 0;
        try {
          // activité = le plus récent entre le dossier et ses enfants directs
          mtime = fs.statSync(abs).mtimeMs;
          for (const e of fs.readdirSync(abs).slice(0, 60)) {
            try { const m = fs.statSync(path.join(abs, e)).mtimeMs; if (m > mtime) mtime = m; } catch {}
          }
        } catch { return { ...p, missing: true }; }
        return { name: p.name, path: p.path, days: Math.floor((now - mtime) / 86400000) };
      });
      return send(res, 200, { projects });
    } catch (e) { return send(res, 500, { error: String(e), projects: [] }); }
  }

  // Ouvre un dossier du widget dans le Finder (chemins de projects.json uniquement)
  if (req.method === "POST" && url === "/project/open") {
    try {
      const { path: rel } = await body(req);
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "projects.json"), "utf8"));
      if (!(cfg.projects || []).some((p) => p.path === rel)) return send(res, 403, { error: "chemin inconnu" });
      const abs = path.isAbsolute(rel) ? rel : path.join(process.env.HOME || "", rel);
      spawn("open", [abs]);
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }

  // Agenda Google — UN OU PLUSIEURS calendriers réunis (15/09) :
  //   CALENDAR_ICS=https://…/basic.ics                              (un seul)
  //   CALENDAR_ICS=pro=https://…,perso=https://…    (plusieurs, étiquetés)
  // Chaque événement porte `cal` (l'étiquette) ; un calendrier en panne n'éteint
  // pas les autres (allSettled), l'erreur est signalée à côté des événements.
  if (req.method === "GET" && (url === "/calendar" || url.startsWith("/calendar/mois/"))) {
    const raw = process.env.CALENDAR_ICS || "";
    if (!raw.trim()) return send(res, 200, { configured: false, events: [] });
    // page Agenda : /calendar/mois/AAAA-MM → tout le mois (passé compris), ±7 j, cache séparé
    const mois = url.startsWith("/calendar/mois/") ? url.slice(15, 22) : null;
    let fenetre = null;
    if (mois && /^\d{4}-\d{2}$/.test(mois)) {
      const [y, m] = mois.split("-").map(Number);
      fenetre = { de: new Date(y, m - 1, 1).getTime() - 7 * 86400000, a: new Date(y, m, 1).getTime() + 7 * 86400000 };
    }
    try {
      const now = Date.now();
      if (fenetre) {
        const cle = mois; calCacheMois ||= {};
        if (!calCacheMois[cle] || now - calCacheMois[cle].at > 300000) {
          const sources = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s, i) => {
            const m = s.match(/^([^=]+)=(https?:\/\/.+)$/);
            return m ? { cal: m[1].trim(), url: m[2].trim() } : { cal: i === 0 ? "pro" : "cal" + (i + 1), url: s };
          });
          const results = await Promise.allSettled(sources.map(async (src) => {
            const r = await fetch(src.url, { redirect: "follow" });
            if (!r.ok) throw new Error(src.cal + " : ICS HTTP " + r.status);
            return parseICS(await r.text()).map((e) => ({ ...e, cal: src.cal }));
          }));
          const events = results.filter((x) => x.status === "fulfilled").flatMap((x) => x.value)
            .filter((e) => e.start.getTime() < fenetre.a && (e.end ? e.end.getTime() : e.start.getTime() + 3600000) > fenetre.de)
            .sort((a, b) => a.start - b.start).slice(0, 300)
            .map((e) => ({ title: e.title, place: e.place || "", desc: e.desc || "", allDay: !!e.allDay, cal: e.cal, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null }));
          calCacheMois[cle] = { at: now, events };
        }
        return send(res, 200, { configured: true, mois, events: fusionAgenda(calCacheMois[cle].events, fenetre.de, fenetre.a) });
      }
      if (!calCache || now - calCache.at > 300000) {
        const sources = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s, i) => {
          const m = s.match(/^([^=]+)=(https?:\/\/.+)$/);
          return m ? { cal: m[1].trim(), url: m[2].trim() } : { cal: i === 0 ? "pro" : "cal" + (i + 1), url: s };
        });
        const horizon = now + 35 * 86400000;   // couvre la grille mensuelle du widget
        const results = await Promise.allSettled(sources.map(async (src) => {
          const r = await fetch(src.url, { redirect: "follow" });
          if (!r.ok) throw new Error(src.cal + " : ICS HTTP " + r.status);
          return parseICS(await r.text()).map((e) => ({ ...e, cal: src.cal }));
        }));
        const erreurs = results.filter((x) => x.status === "rejected").map((x) => String(x.reason && x.reason.message || x.reason));
        if (erreurs.length === sources.length) throw new Error(erreurs.join(" · "));
        const events = results.filter((x) => x.status === "fulfilled").flatMap((x) => x.value)
          .filter((e) => e.start.getTime() < horizon && (e.end ? e.end.getTime() : e.start.getTime() + 3600000) > now - 86400000)
          .sort((a, b) => a.start - b.start).slice(0, 80)
          .map((e) => ({ title: e.title, place: e.place || "", desc: e.desc || "", allDay: !!e.allDay, cal: e.cal, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null }));
        calCache = { at: now, events, erreurs };
        // copie lisible par le CERVEAU (outil Read) → « fais le point sur mon agenda »
        try { fs.writeFileSync("/tmp/vlad_agenda.json", JSON.stringify(events.map(pourCerveau), null, 1)); } catch {}
      }
      const fusion = fusionAgenda(calCache.events, now - 86400000, now + 35 * 86400000);
      try { fs.writeFileSync("/tmp/vlad_agenda.json", JSON.stringify(fusion.map(pourCerveau), null, 1)); } catch {}
      return send(res, 200, { configured: true, events: fusion, erreurs: calCache.erreurs || [] });
    } catch (e) { return send(res, 500, { configured: true, error: String(e), events: fusionAgenda(calCache ? calCache.events : [], Date.now() - 86400000, Date.now() + 35 * 86400000) }); }
  }

  // RDV clients Calendly (jeton personnel dans .env : CALENDLY_TOKEN=…) —
  // rôle séparé de l'agenda Google : Google = suivi interne, Calendly = clients.
  if (req.method === "GET" && url === "/calendly") {
    const tok = process.env.CALENDLY_TOKEN;
    if (!tok) return send(res, 200, { configured: false, events: [] });
    try {
      const now = Date.now();
      if (!calendlyCache || now - calendlyCache.at > 300000) {
        const H = { Authorization: "Bearer " + tok };
        const meR = await fetch("https://api.calendly.com/users/me", { headers: H });
        if (!meR.ok) throw new Error("Calendly HTTP " + meR.status);
        const user = (await meR.json())?.resource?.uri;
        if (!user) throw new Error("jeton Calendly refusé");
        const q = "user=" + encodeURIComponent(user) + "&status=active&sort=start_time:asc"
          + "&min_start_time=" + encodeURIComponent(new Date(now).toISOString()) + "&count=15";
        const evR = await fetch("https://api.calendly.com/scheduled_events?" + q, { headers: H });
        if (!evR.ok) throw new Error("Calendly HTTP " + evR.status);   // 429/500 ≠ « zéro RDV » : ne pas cacher ni écraser
        const evs = (await evR.json())?.collection || [];
        const events = [];
        for (const e of evs) {
          let who = "";
          try {
            const inv = (await (await fetch(e.uri + "/invitees?count=3", { headers: H })).json())?.collection || [];
            who = inv.map((i) => i.name || i.email).filter(Boolean).join(", ");
          } catch {}
          events.push({ title: e.name, who, start: e.start_time, end: e.end_time,
            lieu: e.location?.join_url || e.location?.location || "" });
        }
        calendlyCache = { at: now, events };
        // copie lisible par le CERVEAU (outil Read) → « fais le point sur mes RDV clients »
        try { fs.writeFileSync("/tmp/vlad_calendly.json", JSON.stringify(events.map(pourCerveau), null, 1)); } catch {}
      }
      return send(res, 200, { configured: true, events: calendlyCache.events });
    } catch (e) { return send(res, 500, { configured: true, error: String(e), events: calendlyCache?.events || [] }); }
  }

  // Télémétrie RÉELLE pour les jauges du HUD (cache 5 s — df/pmset coûtent ~50 ms).
  if (req.method === "GET" && url === "/telemetry") {
    try {
      const now = Date.now();
      if (!telemetryCache || now - telemetryCache.at > 5000) {
        const os = require("os");
        const lire = (cmd, args) => new Promise((r) => { let o = ""; const p = spawn(cmd, args); p.stdout.on("data", (d) => (o += d)); p.on("close", () => r(o)); p.on("error", () => r("")); });
        const [dfOut, battOut, vmOut] = await Promise.all([lire("df", ["-k", process.env.HOME || "/"]), lire("pmset", ["-g", "batt"]), lire("vm_stat", [])]);
        // mémoire « utilisée » au sens du Moniteur d'activité : active + câblée + compressée.
        // (1 − libre/total vaut ~100 % en permanence sur macOS : le cache y compte comme utilisé)
        const vmPage = parseInt((vmOut.match(/page size of (\d+)/) || [])[1]) || 16384;
        const vmPages = (k) => parseInt((vmOut.match(new RegExp(k + ":\\s+(\\d+)")) || [])[1]) || 0;
        const ramUsed = (vmPages("Pages active") + vmPages("Pages wired down") + vmPages("Pages occupied by compressor")) * vmPage;
        const dfL = dfOut.trim().split("\n").pop() || "";
        const dfC = dfL.split(/\s+/);
        const diskUsedPct = parseInt(dfC[4]) || 0;                       // "83%"
        const diskFreeGb = Math.round((parseInt(dfC[3]) || 0) / 1048576);
        const battM = battOut.match(/(\d+)%/);
        const notes = vaultSignature().split(":");
        // charge par cœur = 1 − Δidle/Δtotal depuis le relevé précédent (null au premier)
        const cpus = os.cpus().map((c) => { const t = c.times; return { tot: t.user + t.nice + t.sys + t.idle + t.irq, idle: t.idle }; });
        const cores = cpus.map((c, i) => { const p = cpuTimesPrev && cpuTimesPrev[i]; const dT = p ? c.tot - p.tot : 0; return dT > 0 ? Math.round((1 - (c.idle - p.idle) / dT) * 100) : null; });
        cpuTimesPrev = cpus;
        telemetryCache = {
          at: now, cores,
          cpuLoad: Math.min(100, Math.round((os.loadavg()[0] / os.cpus().length) * 100)),
          ramUsedPct: ramUsed ? Math.min(100, Math.round((ramUsed / os.totalmem()) * 100)) : Math.round((1 - os.freemem() / os.totalmem()) * 100),
          diskUsedPct, diskFreeGb,
          battery: battM ? parseInt(battM[1]) : null,
          charging: /AC Power/.test(battOut),
        };
      }
      return send(res, 200, {
        ...telemetryCache,
        stt: sttReady, tts: ttsReady, brain: !!(chat && !chat.p.killed), authExpired,
        speaking: speakingCount > 0,
        turns: turnStats.count,
        costUSD: Math.round(turnStats.costUSD * 100) / 100,
        lastMs: turnStats.lastMs,
        vaultNotes: parseInt(vaultSignature().split(":")[0]) || 0,
        uptimeMin: Math.round((Date.now() - turnStats.startedAt) / 60000),
        model: SONNET.replace("claude-", ""),
      });
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }

  if (req.method === "GET" && url.startsWith("/snd/")) {
    const f = url.slice(5);
    if (!/^vlad_snd_\d+_\d+\.(mp3|wav)$/.test(f)) return send(res, 403, { error: "nom invalide" });
    try {
      const buf = fs.readFileSync("/tmp/" + f);
      res.writeHead(200, { "Content-Type": f.endsWith(".mp3") ? "audio/mpeg" : "audio/wav", "Content-Length": buf.length });
      return res.end(buf);
    } catch { return send(res, 404, { error: "introuvable" }); }
  }

  if (req.method === "GET" && url === "/journal") {
    return send(res, 200, { messages: journal.slice(-30) });
  }

  if (req.method === "GET" && url === "/mail") {
    return send(res, 200, mailCache || { at: null, nonLus: 0, urgent: [], aRepondre: [], recents: [] });
  }

  if (req.method === "POST" && url === "/listen") {
    const r = await listen();
    if (r.error) return send(res, 503, { error: r.error });
    return send(res, 200, { text: r.text || "" });
  }

  // Micro de l'iPhone : la PWA envoie l'audio enregistré, Whisper LOCAL transcrit.
  // (Safari iOS n'expose pas SpeechRecognition dans les web-apps plein écran.)
  if (req.method === "POST" && url === "/transcribe") {
    const { audio = "", mime = "audio/mp4" } = await body(req);
    if (!audio) return send(res, 400, { error: "no audio" });
    const ext = mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "m4a";
    const p = `/tmp/vlad_phone_${phoneN++ % 4}.${ext}`;
    try { fs.writeFileSync(p, Buffer.from(audio, "base64")); }
    catch (e) { return send(res, 500, { error: String(e) }); }
    const r = await transcribeFile(p);
    if (r.error) return send(res, 503, { error: r.error });
    return send(res, 200, { text: r.text || "" });
  }

  if (req.method === "POST" && url === "/ask") {
    // Cerveau streamé + mémoire + voix par phrases (jouée côté serveur pendant la génération).
    let { text = "", voice = VOICES[0].id, silent = false, files = [], remote = false } = await body(req);
    // le client peut être périmé : les en-têtes Cloudflare font foi
    if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"]) remote = true;
    if (text.trim()) jlog("you", text.trim() + (files.length ? " 📎" : ""));
    if (!text.trim() && !(Array.isArray(files) && files.length)) return send(res, 400, { error: "empty" });

    // ── MODE ACTION : une proposition est armée → ce tour la confirme, l'annule, ou la périme ──
    if (pendingAction && !files.length) {
      const fresh = Date.now() - pendingAction.at < ACTION_TTL;
      if (fresh && CONFIRM_RE.test(text) && !CANCEL_RE.test(text)) {
        const { instr } = pendingAction; pendingAction = null;
        console.log("   [action] confirmée →", instr.slice(0, 120));
        const audio = [];
        if (!silent && !remote) await speak(voice, "C'est parti.").catch(() => {});
        const outcome = await runAction(instr);
        if (!silent) {
          if (remote) { const a = await synthToFile(voice, outcome).catch(() => null); if (a) audio.push(a); }
          else await speak(voice, outcome).catch(() => {});
        }
        jlog("vlad", outcome);
        return send(res, 200, { response: outcome, model: SONNET, action: "done", audio });
      }
      if (!fresh || CANCEL_RE.test(text)) {
        pendingAction = null;
        if (CANCEL_RE.test(text)) {
          const msg = "Très bien, j'annule.";
          const audio = [];
          if (!silent) {
            if (remote) { const a = await synthToFile(voice, msg).catch(() => null); if (a) audio.push(a); }
            else await speak(voice, msg).catch(() => {});
          }
          jlog("vlad", msg);
          return send(res, 200, { response: msg, model: SONNET, action: "cancelled", audio });
        }
      } else {
        pendingAction = null;   // autre sujet → la proposition tombe, on discute normalement
      }
    }

    const r = await ask(text, voice, silent, files, remote);
    jlog("vlad", r.response);
    return send(res, 200, { response: r.response, model: r.model, actionPending: r.actionPending || false, audio: r.audio || [] });
  }

  if (req.method === "POST" && url === "/upload") {
    // Document fourni par l'utilisateur (base64) → sauvegardé dans .uploads → VLAD le lira.
    const { name = "document", dataB64 = "" } = await body(req);
    try {
      const safe = Date.now() + "_" + path.basename(name).replace(/[^\w.\-]+/g, "_");
      const dest = path.join(UPLOADS, safe);
      fs.writeFileSync(dest, Buffer.from(dataB64, "base64"));
      return send(res, 200, { path: dest, name: path.basename(name) });
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }

  // Oublier la conversation = relancer le process de chat (sa mémoire EST son contexte).
  if (req.method === "POST" && url === "/reset") {
    pendingAction = null;                          // une action en attente meurt avec la conversation
    journal = [];
    try { fs.unlinkSync(JOURNAL_FILE); } catch {}
    if (chat) { try { chat.p.kill(); } catch {} chat = null; }
    chatReady();                                   // on rallume tout de suite : reste chaud
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url === "/speak") {
    // Joue le texte et ne répond QUE quand l'audio est fini → le HUD sait la durée exacte.
    const { text = "Bonjour, je suis VLAD.", voice = VOICES[0].id } = await body(req);
    await speak(voice, text);
    return send(res, 200, { ok: true });
  }

  // ── Fichiers statiques : le BUILD de production (ui/dist) pour le tunnel ──
  // Le serveur de dev Vite recharge la page à chaque à-coup réseau (HMR) : état
  // perdu, retour en veille. Les clients distants reçoivent donc le build stable.
  if (req.method === "GET") {
    const DIST = path.join(ROOT, "ui", "dist");
    const clean = url.split("?")[0].replace(/\.\./g, "");
    let fp = path.join(DIST, clean === "/" ? "index.html" : clean);
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(DIST, "index.html");   // SPA
    try {
      const buf = fs.readFileSync(fp);
      const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
        ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
        ".json": "application/json", ".ico": "image/x-icon" }[path.extname(fp)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Content-Length": buf.length, "Cache-Control": fp.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
      return res.end(buf);
    } catch {}
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`\n🤖 VLAD — pont vocal local sur http://localhost:${PORT}`);
  console.log(`   cerveau : ${CLAUDE} · voix ${SONNET} · documents ${OPUS}`);
  console.log(`   voix : ${VOICES.map((v) => v.label).join(", ")}`);
  console.log(`   chargement des moteurs (Whisper + Kokoro + Claude)…`);
  // (ElevenLabs : déclaré directement dans VOICES si ELEVEN_KEY+ELEVEN_VOICE — plus de unshift ici)
  // loadSayVoices() désactivé : Rémy est LA voix (repli Siwis intégré à speak()).
  startSTT();     // Whisper : "prêt ✓" quand chargé
  startTTS();     // Kokoro : "prêt ✓" quand chargé
  chatReady();    // préchauffe le process Claude → la 1ʳᵉ question est déjà chaude
  startMailLoop();  // tri des mails toutes les 10 min (si identifiants dans .env)
  if (TG_TOKEN) tgLoop();   // pont Telegram (si jeton dans .env)
  else console.log("   Telegram : inactif (TELEGRAM_TOKEN absent du .env)");
});

// ═══ PONT TELEGRAM : VLAD dans la poche (long polling — aucun port exposé) ═══
// .env : TELEGRAM_TOKEN=<jeton @BotFather>. Le PREMIER chat qui écrit devient
// LE chat de l'utilisateur, épinglé dans .telegram-chat.json ; tout autre chat est
// ignoré en silence (supprimer ce fichier pour ré-épingler). Texte OU vocal en
// entrée → mêmes routes /ask et /transcribe que le HUD (journal partagé, mode
// action, Whisper local) ; réponse texte + note vocale (voix par défaut,
// cascade habituelle ; pas de note si le repli a produit un wav Siwis).
const TG_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TG = "https://api.telegram.org/bot" + TG_TOKEN;
const TG_CHAT_FILE = path.join(ROOT, ".telegram-chat.json");
let tgChat = null;
try { tgChat = JSON.parse(fs.readFileSync(TG_CHAT_FILE, "utf8")).chat || null; } catch {}

// ── Alertes SANTÉ vers Telegram (mode serveur, 14/09) : VLAD prévient SEULEMENT
// quand l'utilisateur doit agir. Anti-spam PERSISTANT (.tg-alerts.json) : sinon chaque
// redémarrage du pont remettait le compteur à zéro → 3 messages en 20 min (vécu).
// Pas d'alerte de démarrage : un pont qui redémarre tout seul n'appelle aucune action.
const TG_ALERT_FILE = path.join(ROOT, ".tg-alerts.json");
let tgAlerted = {};
try { tgAlerted = JSON.parse(fs.readFileSync(TG_ALERT_FILE, "utf8")); } catch {}
function tgAlert(key, text) {
  if (!TG_TOKEN || !tgChat) return;
  const now = Date.now();
  if (tgAlerted[key] && now - tgAlerted[key] < 3600000) return;
  tgAlerted[key] = now;
  try { fs.writeFileSync(TG_ALERT_FILE, JSON.stringify(tgAlerted)); } catch {}
  tgApi("sendMessage", { chat_id: tgChat, text: "⚠️ " + text }).catch(() => {});
}
// seule alerte : session Claude expirée — là, l'utilisateur DOIT faire « claude auth login »
setInterval(() => { if (authExpired) tgAlert("auth", "Ma session Claude a expiré : « claude auth login » sur le Mac, je reprends aussitôt."); }, 60000);

async function tgApi(method, payload) {
  const r = await fetch(TG + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function tgHandle(msg) {
  const chat = msg.chat && msg.chat.id;
  if (!chat) return;
  if (tgChat === null) {
    // APPAIRAGE (audit 14/09) : jamais de « premier arrivé = maître ». Seul un
    // chat PRIVÉ qui envoie exactement le code TELEGRAM_PAIR (.env) est épinglé —
    // sinon, silence + trace. Sans code configuré, aucun appairage possible.
    const TG_PAIR = (process.env.TELEGRAM_PAIR || "").trim();
    if (!TG_PAIR || msg.chat.type !== "private" || (msg.text || "").trim() !== TG_PAIR) {
      console.error("   [tg] appairage refusé — chat", chat, msg.chat.type || "?");
      return;
    }
    tgChat = chat;
    try { fs.writeFileSync(TG_CHAT_FILE, JSON.stringify({ chat })); }
    catch (e) { console.error("   [tg] ÉCHEC écriture épinglage :", String(e).slice(-80)); }
    return tgApi("sendMessage", { chat_id: chat, text: "Appairage réussi. VLAD à ton service : écris-moi ou envoie un vocal." });
  }
  if (chat !== tgChat) return;              // autre chat : silence total

  let text = (msg.text || "").trim();
  if (msg.voice || msg.audio) {             // vocal → Whisper LOCAL (jamais Google)
    try {
      const info = await tgApi("getFile", { file_id: (msg.voice || msg.audio).file_id });
      const fp = info && info.result && info.result.file_path;
      if (fp) {
        const buf = Buffer.from(await (await fetch("https://api.telegram.org/file/bot" + TG_TOKEN + "/" + fp)).arrayBuffer());
        const r = await (await fetch("http://localhost:" + PORT + "/transcribe", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: buf.toString("base64"), mime: "audio/ogg" }),
        })).json();
        text = (r.text || "").trim();
        if (text) await tgApi("sendMessage", { chat_id: chat, text: "🎙 « " + text + " »" });
      }
    } catch (e) { console.error("   [tg] vocal :", String(e).slice(-80)); }
    if (!text) return tgApi("sendMessage", { chat_id: chat, text: "Je n'ai pas compris le vocal, réessaie." });
  }
  if (!text || text === "/start") return;

  // réponse au check-in du soir : trois nombres → enregistrés directement, sans cerveau
  const ck = text.match(/^\D*(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D*$/);
  if (ck && checkinAsked && Date.now() - checkinAsked < 6 * 3600000) {
    checkinAsked = 0;
    try {
      const r = tracker.setMind(ck[1], ck[2], ck[3]);
      try { tracker.setHabit("Journal du soir", true); } catch {}   // répondre au check-in = l'habitude est faite
      trackerSync();
      jlog("vlad", `🌙 Check-in noté : énergie ${r.e}, focus ${r.f}, motivation ${r.m}.`);
      return tgApi("sendMessage", { chat_id: chat, text: `Noté : énergie ${r.e}, focus ${r.f}, motivation ${r.m}. Bonne soirée.` });
    } catch {}
  }

  tgApi("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  let resp;
  try {
    const r = await (await fetch("http://localhost:" + PORT + "/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, silent: true }),
    })).json();
    resp = r.response || "Je n'ai pas pu répondre.";
  } catch { resp = "Mon cerveau n'a pas répondu, redis-moi ça dans quelques secondes."; }
  await tgApi("sendMessage", { chat_id: chat, text: resp.slice(0, 4000) });

  try {                                     // note vocale : la réponse entière en un mp3
    tgApi("sendChatAction", { chat_id: chat, action: "record_voice" }).catch(() => {});
    const f = await synthToFile(VOICES[0].id, resp);
    if (f && f.endsWith(".mp3")) {
      const fd = new FormData();
      fd.append("chat_id", String(chat));
      fd.append("voice", new Blob([fs.readFileSync("/tmp/" + f)], { type: "audio/mpeg" }), "vlad.mp3");
      await fetch(TG + "/sendVoice", { method: "POST", body: fd });
    }
  } catch (e) { console.error("   [tg] voix :", String(e).slice(-80)); }
}

// ═══ BRIEF DU MATIN (15/09) : VLAD vient à l'utilisateur, au lieu d'attendre ═══
// Du lundi au vendredi à BRIEF_HOUR (.env, défaut 8 h, heure du Mac) : rafraîchit
// agenda + Calendly, puis demande au cerveau un point oral (RDV du jour, mails
// urgents, fils sans réponse) → Telegram texte + note vocale, et journal partagé.
// Anti-doublon persistant (.brief-last) : un redémarrage du pont à 8 h 05 ne
// renvoie pas le brief. Le dimanche soir n'existe pas : rien le week-end.
const BRIEF_HOUR = parseInt(process.env.BRIEF_HOUR || "8", 10);
const BRIEF_FILE = path.join(ROOT, ".brief-last");
const BRIEF_PROMPT =
  "[Brief du matin automatique — " + USER + " ne t'a rien demandé, c'est toi qui viens à lui.] " +
  "Lis /tmp/vlad_agenda.json (agenda interne), /tmp/vlad_calendly.json (rendez-vous clients), " +
  "/tmp/vlad_mail.json et /tmp/vlad_tracker.json (ses tâches et habitudes), puis fais-lui le point du jour " +
  "à l'oral, en 6 à 9 phrases maximum : 1) salue-le brièvement avec le jour de la semaine ; 2) ses rendez-vous " +
  "d'AUJOURD'HUI avec l'heure (internes ET clients — dis-le clairement s'il n'y en a aucun) ; 3) ses tâches du jour " +
  "(nombre et les 2-3 principales) et, s'il a une série d'habitude en cours, encourage-la en un mot ; " +
  "4) les mails urgents s'il y en a ; 5) les fils sans réponse de sa part depuis plus de deux jours, en citant " +
  "l'expéditeur — ignore les newsletters, notifications et messages automatiques ; 6) termine par UNE priorité que tu lui " +
  "suggères pour la journée. Ton posé, concret, aucune formule creuse. Si tout est calme, dis-le en deux phrases.";

function briefDue() {
  const now = new Date();
  const jour = now.getDay();                                   // 0 = dimanche, 6 = samedi
  if (jour === 0 || jour === 6) return false;
  if (now.getHours() !== BRIEF_HOUR) return false;
  const today = now.toISOString().slice(0, 10);
  try { if (fs.readFileSync(BRIEF_FILE, "utf8").trim() === today) return false; } catch {}
  return today;
}

async function briefDuMatin(force) {
  const today = force ? new Date().toISOString().slice(0, 10) : briefDue();
  if (!today || !TG_TOKEN || !tgChat) return;
  try { fs.writeFileSync(BRIEF_FILE, today); } catch {}   // posé AVANT : jamais deux briefs
  try {
    // données fraîches (les fichiers /tmp ne sont réécrits qu'à la demande)
    await Promise.allSettled([
      fetch("http://localhost:" + PORT + "/calendar"),
      fetch("http://localhost:" + PORT + "/calendly"),
    ]);
    const r = await ask(BRIEF_PROMPT, VOICES[0].id, true, [], false);
    const texte = (r.response || "").trim();
    if (!texte) throw new Error("brief vide");
    jlog("vlad", "☀️ " + texte);
    await tgApi("sendMessage", { chat_id: tgChat, text: "☀️ Brief du matin\n\n" + texte.slice(0, 3900) });
    const f = await synthToFile(VOICES[0].id, texte);
    if (f && f.endsWith(".mp3")) {
      const fd = new FormData();
      fd.append("chat_id", String(tgChat));
      fd.append("voice", new Blob([fs.readFileSync("/tmp/" + f)], { type: "audio/mpeg" }), "brief.mp3");
      await fetch(TG + "/sendVoice", { method: "POST", body: fd });
    }
    console.log("   [brief] envoyé", today);
  } catch (e) { console.error("   [brief]", String(e).slice(-100)); }
}
setInterval(() => briefDuMatin(false), 60000);

// ═══ CONSOLIDATION MÉMOIRE DU SOIR (15/09) : VLAD relit sa journée et note
// lui-même ce qui compte — sans « retiens que ». Tous les jours à
// CONSOLIDE_HOUR (défaut 22 h). Le PONT écrit dans le carnet (le cerveau n'a
// pas d'outil d'écriture) ; le carnet actuel est fourni pour éviter les doublons.
// Telegram « 🌙 » seulement s'il y a quelque chose. Anti-doublon .consolide-last.
const CONSOLIDE_HOUR = parseInt(process.env.CONSOLIDE_HOUR || "22", 10);
const CONSOLIDE_FILE = path.join(ROOT, ".consolide-last");
const CARNET = path.join(ROOT, "MEMOIRE-VLAD.md");

async function consoliderMemoire(force) {
  const now = new Date(), today = now.toISOString().slice(0, 10);
  if (!force) {
    if (now.getHours() !== CONSOLIDE_HOUR) return;
    try { if (fs.readFileSync(CONSOLIDE_FILE, "utf8").trim() === today) return; } catch {}
  }
  try { fs.writeFileSync(CONSOLIDE_FILE, today); } catch {}
  const debut = new Date(now); debut.setHours(0, 0, 0, 0);
  const jour = journal.filter((e) => e.at >= debut.getTime() && !String(e.text).startsWith("☀️") && !String(e.text).startsWith("🌙"));
  if (jour.length < 2) return;                             // journée vide : rien à retenir
  let carnet = ""; try { carnet = fs.readFileSync(CARNET, "utf8"); } catch {}
  const fil = jour.map((e) => (e.from === "you" ? USER + " : " : "VLAD : ") + String(e.text).slice(0, 400)).join("\n");
  const prompt =
    "[Consolidation de mémoire automatique — fin de journée.] Voici les échanges d'aujourd'hui avec " + USER + " :\n" + fil +
    "\n\nEt voici ton carnet actuel (ne répète RIEN de ce qui y est déjà) :\n" + carnet.slice(-3000) +
    "\n\nExtrais UNIQUEMENT les faits DURABLES qu'il faudra encore savoir dans un mois : décisions prises, " +
    "chiffres et prix arrêtés, engagements, échéances, préférences exprimées, faits sur ses clients ou ses projets. " +
    "IGNORE le bavardage, les tests, les questions sans suite, ce qui est déjà dans le carnet, et tout ce qui vient " +
    "de l'agenda ou des mails (ils ont leurs propres sources). Réponds STRICTEMENT par des lignes au format " +
    "« - [" + today + "] fait » (une ligne par fait, 3 maximum, formulation courte et factuelle), ou par le seul mot RIEN " +
    "s'il n'y a rien de durable. Aucune phrase d'introduction, aucun marqueur d'action.";
  try {
    const r = await ask(prompt, VOICES[0].id, true, [], false);
    const lignes = String(r.response || "").split("\n").map((l) => l.trim())
      .filter((l) => /^- \[\d{4}-\d{2}-\d{2}\] .{6,}/.test(l)).slice(0, 3);
    if (!lignes.length) { console.log("   [mémoire] rien de durable aujourd'hui"); return; }
    fs.appendFileSync(CARNET, (carnet.endsWith("\n") ? "" : "\n") + lignes.join("\n") + "\n");
    console.log("   [mémoire] " + lignes.length + " souvenir(s) consolidé(s)");
    jlog("vlad", "🌙 J'ai noté pour plus tard : " + lignes.map((l) => l.replace(/^- \[[^\]]+\] /, "")).join(" · "));
    if (TG_TOKEN && tgChat) tgApi("sendMessage", { chat_id: tgChat,
      text: "🌙 Ce soir j'ai retenu :\n" + lignes.map((l) => "• " + l.replace(/^- \[[^\]]+\] /, "")).join("\n") }).catch(() => {});
  } catch (e) { console.error("   [mémoire]", String(e).slice(-100)); }
}
setInterval(() => consoliderMemoire(false), 60000);

// ═══ CHECK-IN DU SOIR (CHECKIN_HOUR, Telegram) + RAPPORT DE LA SEMAINE (dimanche 20 h) ═══
let checkinAsked = 0;
const CHECKIN_HOUR = parseInt(process.env.CHECKIN_HOUR || "21", 10);
const CHECKIN_FILE = path.join(ROOT, ".checkin-last");
function checkinDuSoir() {
  const now = new Date(), today = tracker.today();
  if (!TG_TOKEN || !tgChat || now.getHours() !== CHECKIN_HOUR) return;   // heure réglable : CHECKIN_HOUR dans .env
  try { if (fs.readFileSync(CHECKIN_FILE, "utf8").trim() === today) return; } catch {}
  if (tracker.load().mind[today]) return;                 // déjà noté (depuis la page)
  try { fs.writeFileSync(CHECKIN_FILE, today); } catch {}
  checkinAsked = Date.now();
  tgApi("sendMessage", { chat_id: tgChat, text: "🌙 Check-in du soir — énergie, focus, motivation sur 10 ? (réponds par exemple : 8 9 7)" }).catch(() => {});
}
setInterval(checkinDuSoir, 60000);

const RAPPORT_FILE = path.join(ROOT, ".rapport-last");
const RAPPORT_PROMPT =
  "[Rapport hebdomadaire automatique — dimanche soir.] Lis /tmp/vlad_tracker.json puis fais à " + USER + " le bilan de sa " +
  "semaine à l'oral, en 8 à 12 phrases : taux de tâches faites (compte-les), les tâches non faites qu'il faudra reporter, " +
  "ses habitudes — la meilleure et celle qui a le plus manqué, avec les séries en cours —, la tendance de son état mental " +
  "s'il l'a noté, et pour finir UNE recommandation concrète pour la semaine prochaine. Chiffres exacts, ton posé, " +
  "encourageant sans flatterie. Pas de liste : des phrases.";
async function rapportSemaine(force) {
  const now = new Date(), today = tracker.today();
  if (!force) {
    if (now.getDay() !== 0 || now.getHours() !== 20) return;
    try { if (fs.readFileSync(RAPPORT_FILE, "utf8").trim() === today) return; } catch {}
  }
  try { fs.writeFileSync(RAPPORT_FILE, today); } catch {}
  try {
    trackerSync();
    const r = await ask(RAPPORT_PROMPT, VOICES[0].id, true, [], false);
    const texte = (r.response || "").trim(); if (!texte) return;
    try { fs.writeFileSync(path.join(ROOT, ".rapport.json"), JSON.stringify({ at: Date.now(), texte })); } catch {}
    jlog("vlad", "📊 " + texte);
    if (TG_TOKEN && tgChat) {
      await tgApi("sendMessage", { chat_id: tgChat, text: "📊 Bilan de la semaine\n\n" + texte.slice(0, 3900) });
      const f = await synthToFile(VOICES[0].id, texte);
      if (f && f.endsWith(".mp3")) {
        const fd = new FormData(); fd.append("chat_id", String(tgChat));
        fd.append("voice", new Blob([fs.readFileSync("/tmp/" + f)], { type: "audio/mpeg" }), "rapport.mp3");
        await fetch(TG + "/sendVoice", { method: "POST", body: fd });
      }
    }
    console.log("   [rapport] envoyé", today);
  } catch (e) { console.error("   [rapport]", String(e).slice(-100)); }
}
setInterval(() => rapportSemaine(false), 60000);

// ═══ RAPPELS AVANT RENDEZ-VOUS (15/09) : Telegram, X minutes avant ═══
// Sources : agenda Google (tous calendriers) + Calendly. Délais dans .env :
// RAPPEL_MINUTES=60,30 (défaut 60). Anti-doublon persistant par (événement, délai).
const RAPPEL_MINUTES = String(process.env.RAPPEL_MINUTES || "60").split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0);
const RAPPELS_FILE = path.join(ROOT, ".rappels-sent.json");
let rappelsSent = {};
try { rappelsSent = JSON.parse(fs.readFileSync(RAPPELS_FILE, "utf8")); } catch {}
async function rappelsLoop() {
  if (!TG_TOKEN || !tgChat) return;
  try {   // rafraîchit les caches (5 min de TTL côté routes)
    await Promise.allSettled([fetch("http://localhost:" + PORT + "/calendar"), fetch("http://localhost:" + PORT + "/calendly")]);
  } catch {}
  const now = Date.now();
  const evs = [...((calCache && calCache.events) || []).filter((e) => !e.allDay), ...((calendlyCache && calendlyCache.events) || [])];
  for (const e of evs) {
    const start = new Date(e.start).getTime(); if (isNaN(start) || start < now) continue;
    for (const lead of RAPPEL_MINUTES) {
      const key = e.start + "|" + e.title + "|" + lead;
      const delta = start - now;                                   // fenêtre : [lead-1 min, lead]
      if (delta > lead * 60000 || delta <= (lead - 1) * 60000 || rappelsSent[key]) continue;
      rappelsSent[key] = now;
      try { fs.writeFileSync(RAPPELS_FILE, JSON.stringify(rappelsSent)); } catch {}
      const h = new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", "h");
      const quand = lead >= 60 ? (lead % 60 === 0 ? `${lead / 60} h` : `${lead} min`) : `${lead} min`;
      const qui = e.who ? " · " + e.who : e.cal && e.cal !== "pro" ? " · " + e.cal : "";
      const txt = `⏰ Dans ${quand} (${h}) : ${e.title}${qui}${e.place || e.lieu ? " — " + (e.place || e.lieu) : ""}`;
      tgApi("sendMessage", { chat_id: tgChat, text: txt }).catch(() => {});
      jlog("vlad", txt);
      console.log("   [rappel]", txt.slice(0, 80));
    }
  }
  // ménage : clés de plus de 2 jours
  for (const k of Object.keys(rappelsSent)) if (now - rappelsSent[k] > 2 * 86400000) delete rappelsSent[k];
}
setInterval(rappelsLoop, 60000);
setTimeout(rappelsLoop, 20000);

// ═══ SAUVEGARDE QUOTIDIENNE (15/09) : vlad-backup.sh → ~/Documents (iCloud) ═══
// À la première occasion chaque jour (le Mac n'est pas forcément éveillé à heure fixe).
const BACKUP_FILE = path.join(ROOT, ".backup-last");
function sauvegarder() {
  const today = new Date().toISOString().slice(0, 10);
  try { if (fs.readFileSync(BACKUP_FILE, "utf8").trim() === today) return; } catch {}
  const p = spawn("bash", [path.join(ROOT, "vlad-backup.sh")], { stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => {
    if (code === 0) { try { fs.writeFileSync(BACKUP_FILE, today); } catch {} console.log("   [backup]", out.trim().slice(-80)); }
    else console.error("   [backup] échec :", out.trim().slice(-120));
  });
}
setTimeout(sauvegarder, 90000);                 // 1 min 30 après le boot
setInterval(sauvegarder, 3600000);              // puis toutes les heures (no-op si déjà faite)

async function tgLoop() {
  console.log("   Telegram : pont actif ✓");
  let offset = 0;
  while (true) {
    try {
      const d = await (await fetch(TG + "/getUpdates?timeout=25&offset=" + offset,
        { signal: AbortSignal.timeout(40000) })).json();
      if (!d.ok) {
        // erreur PROPRE de l'API (401 jeton révoqué, 409 double instance, 429…) :
        // fetch ne jette pas → sans ce garde, boucle chaude silencieuse (audit 14/09)
        console.error("   [tg] API", d.error_code, String(d.description || "").slice(0, 80));
        const wait = d.error_code === 401 || d.error_code === 404 ? 300000
          : Math.max(5000, ((d.parameters && d.parameters.retry_after) || 0) * 1000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      for (const u of d.result || []) {
        offset = u.update_id + 1;
        if (u.message) await tgHandle(u.message).catch((e) => console.error("   [tg]", String(e).slice(-100)));
      }
    } catch { await new Promise((r) => setTimeout(r, 5000)); }   // réseau KO → on retente
  }
}
