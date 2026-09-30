/* ═══════════════════════════════════════════════════════════════
   VLAD — API de la bibliothèque de widgets (branchée dans vlad-server.js).
   · /layout          disposition de l'accueil, PARTAGÉE Mac / iPhone (layout.json)
   · /widgets/env     quels connecteurs sont configurés (booléens seulement, jamais les valeurs)
   · /rss?url=        flux RSS/Atom → 8 derniers titres (le navigateur ne peut pas : CORS)
   · /sites           ping d'une liste d'URLs → statut + temps de réponse
   · /github          PR à relire, mes PR ouvertes, issues assignées (GITHUB_TOKEN ou `gh`)
   · /note            note rapide → vault/inbox/notes-AAAA-MM-JJ.md
   Chaque route renvoie true si elle a répondu, false sinon (le routeur continue).
   ═══════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LAYOUT = path.join(ROOT, "layout.json");
const INBOX = path.join(ROOT, "vault", "inbox");

// ── URLs externes : http(s) public uniquement (le pont est joignable via le tunnel) ──
function urlPublique(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    const h = x.hostname;
    if (h === "localhost" || h.endsWith(".local") || h === "::1" || h === "[::1]" ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
    return x.toString();
  } catch { return null; }
}
async function recup(url, { ms = 8000, headers = {}, max = 1_500_000 } = {}) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "VLAD-OS/1.0", ...headers } });
    const txt = (await r.text()).slice(0, max);
    return { status: r.status, ok: r.ok, txt };
  } finally { clearTimeout(to); }
}

// ── RSS / Atom : parsing minimal, suffisant pour titre + lien + date ──
const rssCache = new Map();   // url → { at, data }
const decode = (s) => (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const tag = (bloc, t) => { const m = bloc.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? decode(m[1]) : ""; };
function parseFlux(xml) {
  const titre = tag(xml.split(/<(item|entry)[\s>]/i)[0], "title");
  const blocs = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  const items = blocs.slice(0, 8).map((b) => {
    const atom = b.match(/<link[^>]*href="([^"]+)"/i);
    return { titre: tag(b, "title"), lien: atom ? atom[1] : tag(b, "link"), date: tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") };
  }).filter((i) => i.titre);
  return { titre, items };
}

// ── GitHub : jeton .env, sinon celui de la CLI `gh` si elle est connectée ──
let ghTok = null, ghTokAt = 0;
function jetonGithub() {
  if (process.env.GITHUB_TOKEN) return Promise.resolve(process.env.GITHUB_TOKEN);
  if (ghTokAt && Date.now() - ghTokAt < 3600_000) return Promise.resolve(ghTok);
  return new Promise((ok) => execFile("gh", ["auth", "token"], { timeout: 5000 }, (e, out) => {
    ghTok = e ? null : (out || "").trim() || null; ghTokAt = Date.now(); ok(ghTok);
  }));
}
let ghCache = null;
async function github() {
  if (ghCache && Date.now() - ghCache.at < 300_000) return ghCache.data;
  const tok = await jetonGithub();
  if (!tok) return { configured: false };
  const h = { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" };
  const cherche = async (q) => {
    const r = await recup("https://api.github.com/search/issues?per_page=6&sort=updated&q=" + encodeURIComponent(q), { headers: h });
    if (!r.ok) throw new Error("GitHub " + r.status);
    return JSON.parse(r.txt).items.map((i) => ({ titre: i.title, url: i.html_url, repo: i.repository_url.split("/").slice(-2).join("/"), num: i.number, maj: i.updated_at }));
  };
  try {
    const [relire, mesPr, issues] = await Promise.all([
      cherche("is:open is:pr review-requested:@me archived:false"),
      cherche("is:open is:pr author:@me archived:false"),
      cherche("is:open is:issue assignee:@me archived:false"),
    ]);
    const data = { configured: true, relire, mesPr, issues, at: Date.now() };
    ghCache = { at: Date.now(), data };
    return data;
  } catch (e) { return { configured: true, error: String(e.message || e) }; }
}

async function handle(req, res, url, send, body) {
  const q = new URL(req.url, "http://x").searchParams;

  if (req.method === "GET" && url === "/layout") {
    try { send(res, 200, JSON.parse(fs.readFileSync(LAYOUT, "utf8"))); } catch { send(res, 200, null); }
    return true;
  }
  if (req.method === "POST" && url === "/layout") {
    const b = await body(req);
    const ok = b && Array.isArray(b.left) && Array.isArray(b.right) && typeof (b.config || {}) === "object";
    if (!ok) { send(res, 400, { error: "disposition invalide" }); return true; }
    const propre = { left: b.left.map(String), right: b.right.map(String), config: b.config || {}, at: Date.now() };
    fs.writeFileSync(LAYOUT, JSON.stringify(propre, null, 2));
    send(res, 200, { ok: true, at: propre.at });
    return true;
  }
  if (req.method === "GET" && url === "/widgets/env") {
    const e = process.env;
    send(res, 200, {
      GITHUB: !!(e.GITHUB_TOKEN || await jetonGithub()),
      CALENDLY_TOKEN: !!e.CALENDLY_TOKEN, CALENDAR_ICS: !!e.CALENDAR_ICS, MAIL_USER: !!e.MAIL_USER,
    });
    return true;
  }
  if (req.method === "GET" && url === "/rss") {
    const u = urlPublique(q.get("url") || "");
    if (!u) { send(res, 400, { error: "adresse invalide" }); return true; }
    const c = rssCache.get(u);
    if (c && Date.now() - c.at < 900_000) { send(res, 200, c.data); return true; }
    try {
      const r = await recup(u);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = { url: u, ...parseFlux(r.txt) };
      rssCache.set(u, { at: Date.now(), data });
      send(res, 200, data);
    } catch (e) { send(res, 200, { url: u, error: String(e.message || e), items: [] }); }
    return true;
  }
  if (req.method === "POST" && url === "/sites") {
    const { urls = [] } = await body(req);
    const res2 = await Promise.all(urls.slice(0, 20).map(async (brut) => {
      const u = urlPublique(brut);
      if (!u) return { url: brut, ok: false, erreur: "adresse invalide" };
      const t0 = Date.now();
      try { const r = await recup(u, { ms: 10000, max: 1000 }); return { url: brut, ok: r.ok, status: r.status, ms: Date.now() - t0 }; }
      catch (e) { return { url: brut, ok: false, erreur: e.name === "AbortError" ? "délai dépassé" : "injoignable", ms: Date.now() - t0 }; }
    }));
    send(res, 200, { at: Date.now(), sites: res2 });
    return true;
  }
  if (req.method === "GET" && url === "/github") { send(res, 200, await github()); return true; }
  if (req.method === "POST" && url === "/note") {
    const { texte = "" } = await body(req);
    const t = String(texte).trim().slice(0, 4000);
    if (!t) { send(res, 400, { error: "vide" }); return true; }
    const d = new Date(), jour = d.toLocaleDateString("sv-SE"), h = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const f = path.join(INBOX, `notes-${jour}.md`);
    fs.mkdirSync(INBOX, { recursive: true });
    if (!fs.existsSync(f)) fs.writeFileSync(f, `# Notes rapides — ${jour}\n\n`);
    fs.appendFileSync(f, `- **${h}** ${t.replace(/\n+/g, " ")}\n`);
    send(res, 200, { ok: true, fichier: path.relative(ROOT, f) });
    return true;
  }
  return false;
}

module.exports = { handle };
