/**
 * VLAD OS — Agrégateur du Vault : carte de tout l'univers Claude Code.
 * Nœuds : projets · skills · notes mémoire · MCP/agents.  Arêtes : liens [[..]],
 * projet↔note, skill↔catégorie, catégorie↔racine.  Couleur par type (palette VLAD).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
// Dossiers mémoire de Claude Code à relier au graphe : tous les ~/.claude/projects/*/memory,
// ou seulement celui de VLAD_MEMORY_DIR s'il est défini.
const memDirs = () => process.env.VLAD_MEMORY_DIR ? [process.env.VLAD_MEMORY_DIR] : (() => {
  try { return fs.readdirSync(CLAUDE_PROJECTS).map((d) => path.join(CLAUDE_PROJECTS, d, "memory")).filter((d) => fs.existsSync(d)); } catch { return []; }
})();
const VAULT_DIR = path.join(__dirname, "..", "vault");
const SKIP_DIRS = new Set([".Trash", "Library", "Applications", "Music", "Movies", "Pictures", "Public", ".npm", ".cache", "node_modules", ".git", ".claude"]);

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function walkMd(dir, acc = []) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  } } catch {}
  return acc;
}

function parseNote(file) {
  let txt = ""; try { txt = fs.readFileSync(file, "utf8"); } catch { return null; }
  const name = path.basename(file, ".md");
  const title = (txt.match(/^#\s+(.+)$/m)?.[1] || name).replace(/[#*`\[\]]/g, "").trim();
  const tags = (txt.match(/tags:\s*\[([^\]]*)\]/)?.[1] || "").split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean);
  const links = [...txt.matchAll(/\[\[([^\]\|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => slug(m[1]));
  // courte info : 1ʳᵉ ligne de contenu (hors frontmatter / titres / liens)
  const body = txt.replace(/^---[\s\S]*?---/, "");
  const info = (body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("-") && l.length > 12) || "").replace(/[#*`\[\]]/g, "").slice(0, 120);
  return { id: "note:" + slug(name), kind: "memory", label: title.slice(0, 42), tags, links, file, info };
}

// projets : registre Claude Code (chemins encodés) + scan ~ niveau 1 (repos/projets)
function collectProjects() {
  const map = new Map(); // id -> node
  const add = (p) => {
    if (!p) return; const base = path.basename(p); if (!base || base.startsWith(".")) return;
    const id = "proj:" + slug(base);
    if (!map.has(id)) map.set(id, { id, kind: "project", label: base.slice(0, 40), path: p, info: p.replace(HOME, "~") });
  };
  // 1) registre Claude Code : noms encodés ("-Users-x-mon-projet"). Le décodage tiret→slash
  // est ambigu (dossiers à tirets), donc on ne garde QUE les chemins qui existent vraiment.
  const existsDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  try {
    for (const d of fs.readdirSync(CLAUDE_PROJECTS, { withFileTypes: true })) {
      if (!d.isDirectory() || !d.name.startsWith("-")) continue;
      const decoded = "/" + d.name.slice(1).replace(/-/g, "/");
      if (decoded !== HOME && decoded.startsWith(HOME + "/") && existsDir(decoded)) add(decoded);
    }
  } catch {}
  // 2) scan ~ niveau 1 : dossiers contenant .git / package.json / index.html
  try {
    for (const e of fs.readdirSync(HOME, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const dir = path.join(HOME, e.name);
      let proj = false;
      try { proj = ["package.json", "index.html", ".git"].some((f) => fs.existsSync(path.join(dir, f))); } catch {}
      if (proj) add(dir);
    }
  } catch {}
  return [...map.values()];
}

// agents custom : fichiers <projet>/.claude/agents/*.md (BYAN, carmack, ciceron…)
function collectAgents() {
  const out = [], seen = new Set();
  try {
    for (const e of fs.readdirSync(HOME, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const dir = path.join(HOME, e.name, ".claude", "agents");
      let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
      for (const f of files) {
        const name = f.replace(/\.md$/, ""); const id = "agent:" + slug(name);
        if (seen.has(id)) continue; seen.add(id);
        let txt = ""; try { txt = fs.readFileSync(path.join(dir, f), "utf8"); } catch {}
        const desc = (txt.match(/description:\s*(.+)/i)?.[1] || txt.match(/^#\s+(.+)$/m)?.[1] || "").replace(/["'`#*]/g, "").trim().slice(0, 110);
        out.push({ id, kind: "agent", label: name.replace(/^bmad-/, "").slice(0, 30), info: desc || ("agent · " + e.name), src: e.name });
      }
    }
  } catch {}
  return out;
}

// skills / mcp / agents intégrés : capturés depuis l'init de claude (tué avant l'appel modèle → ~0 coût)
function getEnv(claudeCmd) {
  return new Promise((resolve) => {
    let buf = "", done = false;
    const finish = (env, why) => { if (done) return; done = true; try { p.kill(); } catch {} try { console.error("   [vault] getEnv", why, "skills=" + env.skills.length, "mcp=" + env.mcp.length); } catch {} resolve(env); };
    const p = spawn(claudeCmd, ["-p", "x", "--output-format", "stream-json", "--verbose"], { cwd: HOME, stdio: ["ignore", "pipe", "pipe"] });
    const to = setTimeout(() => finish({ skills: [], mcp: [], agents: [] }, "TIMEOUT"), 40000);
    p.stdout.on("data", (c) => {
      buf += c.toString(); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === "system" && m.subtype === "init") {
          clearTimeout(to);
          finish({ skills: m.skills || [], mcp: (m.mcp_servers || []).map((s) => s.name), agents: m.agents || [] }, "init");
          return;
        }
      }
    });
    p.stderr.on("data", (d) => { const s = String(d).trim(); if (s) try { console.error("   [vault] claude stderr:", s.slice(-160)); } catch {} });
    p.on("error", (e) => { clearTimeout(to); finish({ skills: [], mcp: [], agents: [] }, "error:" + e); });
  });
}

// descriptions des skills : frontmatter des SKILL.md (~/.claude/skills + plugins)
function loadSkillDescs() {
  const map = {};
  const scan = (dir, depth) => {
    if (depth > 6) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p, depth + 1);
      else if (e.name === "SKILL.md") { try { const t = fs.readFileSync(p, "utf8"); const nm = (t.match(/^name:\s*(.+)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim(); const d = (t.match(/^description:\s*(.+)$/m)?.[1] || "").replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim(); if (d) { if (nm) map[nm] = d; map[path.basename(path.dirname(p))] = d; } } catch {} }
    }
  };
  [path.join(HOME, ".claude", "skills"), path.join(HOME, ".claude", "plugins")].forEach((d) => scan(d, 0));
  return map;
}

// catégorise un skill par préfixe (pour regrouper les ~150)
function skillCategory(name) {
  const n = name.toLowerCase();
  if (/^(fal-|imagegen|imagen|nanobanana|venice|replicate|sora|pixelbin|minimax|gif|veo)/.test(n)) return "media-ia";
  if (/^(figma|design|deck|frame|canvas|poster|card|muller|swiss|brand|color|apple-hig|platform|ui|impeccable|taste|frontend|web-)/.test(n)) return "design";
  if (/^(gsap|three|webgpu|shader|remotion|d3|algorithmic|flutter|login|faq)/.test(n)) return "dev-visuel";
  if (/^(cloudflare|durable|agents-sdk|sandbox|workers|wrangler|claude-api)/.test(n)) return "infra";
  if (/^(pptx|docx?|pdf|xlsx|slides|article|resume|data-report|release)/.test(n)) return "documents";
  if (/^(ponytail|code-review|simplify|verify|review|security|init|menu|find-skills|enhance|brainstorm)/.test(n)) return "dev-flow";
  if (/^(small-business|ad-|copywriting|marketing|competitive|paywall|domain)/.test(n)) return "business";
  return "divers";
}

async function buildVault(claudeCmd = "claude") {
  const nodes = [], edges = [], ids = new Set();
  const addNode = (n) => { if (n && !ids.has(n.id)) { ids.add(n.id); nodes.push(n); } };
  const addEdge = (a, b, w) => { if (a !== b && ids.has(a) && ids.has(b)) edges.push({ a, b, w: w || 1 }); };

  // 1) Mémoire / notes
  const noteFiles = [...new Set([...memDirs().flatMap((d) => walkMd(d)), ...walkMd(VAULT_DIR)])];
  const notes = noteFiles.map(parseNote).filter(Boolean);
  notes.forEach((n) => addNode({ id: n.id, kind: "memory", label: n.label, tags: n.tags, info: n.info }));

  // 2) Projets
  const projects = collectProjects();
  projects.forEach((p) => addNode(p));

  // 2 bis) Contrats signés — facultatif : VLAD_CONTRACTS_DIR=<dossier>/<Client>/<contrat>.pdf
  // Rien n'est déplacé : tout contrat déposé là apparaît dans le Vault.
  const CONTRACTS_DIR = process.env.VLAD_CONTRACTS_DIR || "";
  let contracts = [];
  try {
    for (const client of fs.readdirSync(CONTRACTS_DIR, { withFileTypes: true })) {
      if (client.name.startsWith(".")) continue;
      if (client.isDirectory()) {
        for (const f of fs.readdirSync(path.join(CONTRACTS_DIR, client.name))) {
          if (!/\.(pdf|docx?|pages)$/i.test(f)) continue;
          if (/certificat/i.test(f)) continue;   // preuve DocuSign = annexe, pas un contrat
          contracts.push({
            id: "contract:" + slug(client.name + "-" + f.replace(/\.[^.]+$/, "")),
            kind: "contract",
            label: f.replace(/\.[^.]+$/, "").slice(0, 42),
            info: "Contrat signé · " + client.name + " · " + f,
            path: path.join(CONTRACTS_DIR, client.name, f),
          });
        }
      } else if (/\.(pdf|docx?|pages)$/i.test(client.name) && !/certificat/i.test(client.name)) {
        contracts.push({
          id: "contract:" + slug(client.name.replace(/\.[^.]+$/, "")),
          kind: "contract",
          label: client.name.replace(/\.[^.]+$/, "").slice(0, 42),
          info: "Contrat signé · " + client.name,
          path: path.join(CONTRACTS_DIR, client.name),
        });
      }
    }
  } catch {}
  contracts.forEach((c) => addNode(c));

  // 2 ter) Base clients — clients.json à la racine (VLAD la met à jour en mode action).
  // Fichier écrit par une IA → on tolère TOUTE structure : une fiche cassée ne doit
  // jamais faire tomber le Vault entier (buildVault rejeté = /vault 500 = tout vide).
  let clients = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "clients.json"), "utf8")).clients;
    clients = (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c === "object");
    clients.forEach((c, i) => {
      const nom = String(c.nom || "client-" + (i + 1));
      const projets = Array.isArray(c.projets) ? c.projets.map(String) : [];
      addNode({
        id: "client:" + slug(nom),
        kind: "client",
        label: nom.slice(0, 30),
        info: [c.statut, c.contact, c.email, c.tel].filter(Boolean).map(String).join(" · ")
          + (projets.length ? " — " + projets.join(", ") : "")
          + (c.notes ? " — " + String(c.notes) : ""),
      });
    });
  } catch { clients = []; }

  // 3) Skills / MCP / agents intégrés (init) + agents custom (scan .claude/agents)
  const env = await getEnv(claudeCmd);
  const descs = loadSkillDescs();
  const cats = new Set();
  env.skills.forEach((s) => {
    const cat = skillCategory(s); cats.add(cat);
    const desc = descs[s] || descs[s.split(":").pop()] || "";
    addNode({ id: "skill:" + slug(s), kind: "skill", label: s.slice(0, 32), cat, cmd: "/" + s, info: desc.slice(0, 180) || ("Commande Claude Code · " + cat) });
  });
  cats.forEach((c) => addNode({ id: "cat:" + slug(c), kind: "category", label: c }));
  addNode({ id: "root:skills", kind: "root", label: "Skills" });
  env.mcp.forEach((m) => addNode({ id: "mcp:" + slug(m), kind: "mcp", label: m.slice(0, 28), info: "serveur MCP" }));
  const customAgents = collectAgents();
  customAgents.forEach((a) => addNode(a));
  env.agents.forEach((a) => addNode({ id: "agent:" + slug(a), kind: "agent", label: a.slice(0, 28), info: "agent intégré Claude Code" }));

  // ── Arêtes ──
  // notes ↔ notes (liens [[..]])
  notes.forEach((n) => n.links.forEach((l) => addEdge(n.id, "note:" + l)));
  // projet ↔ note mémoire qui le mentionne (ex. proj:site-dupont ↔ note:project_site_dupont)
  projects.forEach((p) => {
    const ps = p.id.slice(5);
    notes.forEach((n) => { if (n.id.includes(ps) || ps.split("-").some((w) => w.length > 3 && n.id.includes(w))) addEdge(p.id, n.id, 2); });
  });
  // skill ↔ catégorie ↔ racine
  env.skills.forEach((s) => addEdge("skill:" + slug(s), "cat:" + slug(skillCategory(s))));
  cats.forEach((c) => addEdge("cat:" + slug(c), "root:skills", 2));
  // agent custom ↔ son projet source
  customAgents.forEach((a) => { if (a.src) addEdge(a.id, "proj:" + slug(a.src), 2); });
  // client ↔ ses contrats et projets (rapprochement par premier mot du nom)
  clients.forEach((c, i) => {
    const nom = String(c.nom || "client-" + (i + 1));
    const key = slug(nom.split(/\s+/)[0] || "");
    if (key.length < 3) return;
    nodes.forEach((n) => {
      if ((n.kind === "contract" || n.kind === "project") &&
          (n.id.includes(key) || (n.info || "").toLowerCase().includes(key)))
        addEdge("client:" + slug(nom), n.id, 2);
    });
  });

  const agentCount = customAgents.length + env.agents.length;
  return { nodes, edges, counts: { projects: projects.length, skills: env.skills.length, notes: notes.length, mcp: env.mcp.length, agents: agentCount, contracts: contracts.length, clients: clients.length, total: nodes.length, edges: edges.length } };
}

module.exports = { buildVault };
