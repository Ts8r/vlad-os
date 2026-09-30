/* ═══════════════════════════════════════════════════════════════
   VLAD — « Remplir le vault » : une FICHE-INDEX par fichier source.
   Les originaux ne sont jamais copiés ni modifiés : chaque fiche donne un résumé
   et le chemin du fichier d'origine, que VLAD ouvre quand il en a besoin.
   Fiches rangées dans vault/sources/<type>/ (non versionnées), refaites à chaque
   synchronisation ; celles dont la source a disparu sont retirées.
   Réglages : vault-sources.json (types cochés + dossiers ajoutés à la main).
   ═══════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const HOME = os.homedir();
const ROOT = path.join(__dirname, "..");
const CLAUDE = path.join(HOME, ".claude");
const DEST = path.join(ROOT, "vault", "sources");
const CONFIG = path.join(ROOT, "vault-sources.json");
const MARQUE = "genere_par: vlad-import";            // seules ces fiches peuvent être supprimées
const MAX_PAR_SOURCE = 800;                           // garde-fou : un dossier géant ne noie pas le vault
const EXT = /\.(md|markdown|txt)$/i;
const IGNORE = new Set(["node_modules", ".git", ".obsidian", ".trash", ".Trash", "Library", ".cache", "dist", "build"]);

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "note";
const court = (p) => p.replace(HOME, "~");
const existe = (p) => { try { return fs.statSync(p); } catch { return null; } };

function lister(dir, filtre, prof = 4, acc = []) {
  if (prof < 0 || acc.length >= MAX_PAR_SOURCE) return acc;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (acc.length >= MAX_PAR_SOURCE) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!IGNORE.has(e.name) && !e.name.startsWith(".")) lister(p, filtre, prof - 1, acc); }
    else if (filtre(p, e.name)) acc.push(p);
  }
  return acc;
}

// Coffres Obsidian : un dossier qui contient .obsidian (iCloud Obsidian + ~ sur 3 niveaux)
function coffresObsidian() {
  const out = new Set();
  const cherche = (d, prof) => {
    if (prof < 0) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (es.some((e) => e.name === ".obsidian" && e.isDirectory())) { out.add(d); return; }
    for (const e of es) if (e.isDirectory() && !e.name.startsWith(".") && !IGNORE.has(e.name)) cherche(path.join(d, e.name), prof - 1);
  };
  cherche(path.join(HOME, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"), 1);
  cherche(HOME, 3);
  return [...out];
}

// Les types de sources proposés, détectés sur la machine
function types(config) {
  const skills = () => [
    ...lister(path.join(CLAUDE, "skills"), (p, n) => n === "SKILL.md", 2),
    ...lister(path.join(CLAUDE, "plugins"), (p, n) => n === "SKILL.md" && p.includes(`${path.sep}skills${path.sep}`), 6),
  ];
  const agents = () => [
    ...lister(path.join(CLAUDE, "agents"), (p, n) => n.endsWith(".md"), 1),
    ...lister(path.join(CLAUDE, "plugins"), (p, n) => n.endsWith(".md") && p.includes(`${path.sep}agents${path.sep}`), 6),
  ];
  const claudemd = () => {
    const l = [path.join(CLAUDE, "CLAUDE.md")];
    try { for (const e of fs.readdirSync(HOME, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith(".")) l.push(path.join(HOME, e.name, "CLAUDE.md")); } catch {}
    return l.filter(existe);
  };
  const memoires = () => {
    let ds = []; try { ds = fs.readdirSync(path.join(CLAUDE, "projects")); } catch {}
    return ds.flatMap((d) => lister(path.join(CLAUDE, "projects", d, "memory"), (p, n) => n.endsWith(".md"), 1));
  };
  const obsidian = coffresObsidian();
  const dossiers = (config.dossiers || []).filter(existe);
  return [
    { id: "skills", label: "Skills Claude Code", aide: "~/.claude/skills et plugins", fichiers: skills, graphe: false },
    { id: "agents", label: "Agents Claude Code", aide: "~/.claude/agents et plugins", fichiers: agents, graphe: false },
    { id: "claudemd", label: "Fichiers CLAUDE.md", aide: "instructions globales et par projet", fichiers: claudemd, graphe: true },
    { id: "memoires", label: "Mémoires Claude Code", aide: "~/.claude/projects/*/memory", fichiers: memoires, graphe: false },
    ...obsidian.map((d) => ({ id: "obsidian:" + slug(path.basename(d)), label: "Obsidian · " + path.basename(d), aide: court(d), fichiers: () => lister(d, (p, n) => EXT.test(n), 6), graphe: true })),
    ...dossiers.map((d) => ({ id: "dossier:" + slug(d), label: "Dossier · " + path.basename(d), aide: court(d), fichiers: () => lister(d, (p, n) => EXT.test(n) || /\.pdf$/i.test(n), 6), graphe: true, retirable: d })),
  ];
}

const lireConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return { actifs: null, dossiers: [], derniere: null }; } };
const ecrireConfig = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2));
// par défaut (jamais réglé) : tout ce qui est détecté est coché
const actif = (c, id) => c.actifs == null ? true : c.actifs.includes(id);

// Résumé : description du frontmatter, sinon premières lignes utiles (sans titres ni listes vides)
function resume(txt) {
  const desc = txt.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (desc) return desc.slice(0, 400);
  const corps = txt.replace(/^---[\s\S]*?---/, "");
  return corps.split("\n").map((l) => l.trim()).filter((l) => l && !/^(#|---|```|<)/.test(l) && l.length > 3)
    .join(" ").replace(/\s+/g, " ").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").slice(0, 400);
}
const titreDe = (txt, f) => (txt.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1] || txt.match(/^#\s+(.+)$/m)?.[1] || path.basename(f).replace(/\.[^.]+$/, "")).replace(/[#*`[\]]/g, "").trim().slice(0, 90);

function fiche(t, f) {
  const st = existe(f); if (!st) return null;
  const pdf = /\.pdf$/i.test(f);
  const txt = pdf ? "" : (() => { try { return fs.readFileSync(f, "utf8").slice(0, 20000); } catch { return ""; } })();
  const titre = pdf ? path.basename(f, ".pdf")
    : f === path.join(CLAUDE, "CLAUDE.md") ? "CLAUDE.md global"
    : f.endsWith("CLAUDE.md") ? "CLAUDE.md · " + path.basename(path.dirname(f))
    : titreDe(txt, f);
  const res = pdf ? "Document PDF — à ouvrir pour le lire." : resume(txt);
  const type = t.id.split(":")[0];
  return {
    nom: slug(titre).slice(0, 60) + "-" + crypto.createHash("sha1").update(f).digest("hex").slice(0, 6),   // stable et unique par fichier
    contenu: `---\ntags: [source, ${type}]\ntype: source\nsource: "${f.replace(/"/g, '\\"')}"\nmaj: ${new Date(st.mtimeMs).toISOString().slice(0, 10)}\n${t.graphe ? "" : "graphe: non\n"}${MARQUE}\n---\n\n` +
      `# ${titre}\n\n${res || "(pas de résumé : fichier court ou vide)"}\n\n` +
      `- **Fichier d'origine** : \`${court(f)}\`\n- **Source** : [[sources-${slug(t.id)}|${t.label}]]\n`,
  };
}

function synchroniser() {
  const c = lireConfig();
  const ts = types(c).filter((t) => actif(c, t.id));
  const gardes = new Set(), stats = {};
  for (const t of ts) {
    const dir = path.join(DEST, slug(t.id));
    fs.mkdirSync(dir, { recursive: true });
    const fiches = t.fichiers().map((f) => fiche(t, f)).filter(Boolean);
    const vus = new Set();
    for (const fi of fiches) {
      let nom = fi.nom; for (let k = 2; vus.has(nom); k++) nom = fi.nom + "-" + k;   // deux fichiers au même titre
      vus.add(nom);
      const p = path.join(dir, nom + ".md"); gardes.add(p);
      const avant = existe(p) ? fs.readFileSync(p, "utf8") : null;
      if (avant !== fi.contenu) fs.writeFileSync(p, fi.contenu);
    }
    // page d'index du type : relie toutes ses fiches (graphe + navigation Obsidian)
    const idx = path.join(DEST, `sources-${slug(t.id)}.md`); gardes.add(idx);
    fs.writeFileSync(idx, `---\ntags: [source, index]\ntype: source-index\n${t.graphe ? "" : "graphe: non\n"}${MARQUE}\n---\n\n# ${t.label}\n\n${t.aide}\n\n` +
      [...vus].sort().map((n) => `- [[${n}]]`).join("\n") + "\n");
    stats[t.id] = fiches.length;
  }
  // ménage : uniquement les fiches générées ici dont la source n'est plus importée
  let retirees = 0;
  for (const f of lister(DEST, (p, n) => n.endsWith(".md"), 3)) {
    if (gardes.has(f)) continue;
    try { if (fs.readFileSync(f, "utf8").includes(MARQUE)) { fs.unlinkSync(f); retirees++; } } catch {}
  }
  // dossiers de types décochés, devenus vides
  try { for (const d of fs.readdirSync(DEST)) { const p = path.join(DEST, d); if (fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p); } } catch {}
  c.derniere = { at: Date.now(), stats, retirees };
  ecrireConfig(c);
  return c.derniere;
}

// Vue pour le HUD : sources détectées, cochées, nombre de fichiers, dernière synchro
function etat() {
  const c = lireConfig();
  return {
    sources: types(c).map((t) => ({ id: t.id, label: t.label, aide: t.aide, actif: actif(c, t.id), fichiers: t.fichiers().length, retirable: t.retirable || null })),
    derniere: c.derniere,
  };
}
function regler({ actifs, ajouter, retirer }) {
  const c = lireConfig();
  if (Array.isArray(actifs)) c.actifs = actifs.map(String);
  if (ajouter) {
    const d = path.resolve(String(ajouter).replace(/^~(?=$|\/)/, HOME));
    const st = existe(d);
    if (!st || !st.isDirectory()) throw new Error("dossier introuvable : " + ajouter);
    if (!d.startsWith(HOME)) throw new Error("le dossier doit être dans ton dossier personnel");
    c.dossiers = [...new Set([...(c.dossiers || []), d])];
    if (c.actifs) c.actifs.push("dossier:" + slug(d));
  }
  if (retirer) c.dossiers = (c.dossiers || []).filter((d) => d !== retirer);
  ecrireConfig(c);
  return etat();
}

// Fichiers glissés dans la page Vault → vault/inbox/ (copie, ce sont des dépôts volontaires)
function deposer(name, dataB64) {
  const safe = path.basename(String(name)).replace(/[^\w.\-() éèàùçÉ]/g, "_");
  if (!/\.(md|markdown|txt|pdf)$/i.test(safe)) throw new Error("format accepté : .md, .txt, .pdf");
  const dir = path.join(ROOT, "vault", "inbox"); fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, safe);
  for (let k = 2; existe(p); k++) p = path.join(dir, safe.replace(/(\.[^.]+)$/, `-${k}$1`));
  fs.writeFileSync(p, Buffer.from(String(dataB64), "base64"));
  return path.relative(ROOT, p);
}

module.exports = { etat, regler, synchroniser, deposer, DEST };
