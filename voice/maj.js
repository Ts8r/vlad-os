/* ═══════════════════════════════════════════════════════════════
   VLAD — mises à jour de l'app depuis GitHub.
   · Vérifie au démarrage si la dernière vérification date de plus de 30 jours,
     puis une fois par jour en arrière-plan (au moins une fois par mois garanti).
   · N'applique JAMAIS par-dessus une modification locale : si un fichier que tu as
     changé est aussi touché par la mise à jour, on s'arrête et on te le dit.
   · VLAD_AUTO_UPDATE=1 dans .env : appliquée toute seule quand c'est sans risque.
   ═══════════════════════════════════════════════════════════════ */
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ETAT = path.join(ROOT, ".maj.json");
const MOIS = 30 * 24 * 3600_000;

const git = (args, ms = 60000) => new Promise((ok) =>
  execFile("git", args, { cwd: ROOT, timeout: ms, maxBuffer: 4e6 }, (e, out, err) => ok({ ok: !e, out: String(out || "").trimEnd(), err: String(err || e?.message || "").trim() })));
const lire = () => { try { return JSON.parse(fs.readFileSync(ETAT, "utf8")); } catch { return {}; } };
const ecrire = (e) => { try { fs.writeFileSync(ETAT, JSON.stringify(e, null, 1)); } catch {} };

async function verifier() {
  const e = { verifie: Date.now() };
  if (!fs.existsSync(path.join(ROOT, ".git"))) { Object.assign(e, { possible: false, raison: "installé sans git (ZIP) : retélécharge depuis GitHub pour mettre à jour" }); ecrire(e); return e; }
  const f = await git(["fetch", "--quiet", "origin"]);
  if (!f.ok) { Object.assign(e, { possible: false, raison: "GitHub injoignable" }); ecrire({ ...lire(), ...e }); return e; }
  const branche = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).out || "main";
  const amont = `origin/${branche}`;
  const [actuel, distant, retard, avance] = await Promise.all([
    git(["log", "-1", "--format=%h · %cs", "HEAD"]), git(["log", "-1", "--format=%h · %cs", amont]),
    git(["rev-list", "--count", `HEAD..${amont}`]), git(["rev-list", "--count", `${amont}..HEAD`]),
  ]);
  const nouveautes = (await git(["log", "--format=%s", `HEAD..${amont}`, "-8"])).out.split("\n").filter(Boolean);
  // fichiers modifiés chez toi ET touchés par la mise à jour = conflit possible
  const locaux = (await git(["status", "--porcelain"])).out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ""));
  const touches = new Set((await git(["diff", "--name-only", `HEAD...${amont}`])).out.split("\n").filter(Boolean));
  const conflits = locaux.filter((f) => touches.has(f));
  Object.assign(e, {
    possible: true, branche, actuel: actuel.out, distant: distant.out,
    retard: +retard.out || 0, avance: +avance.out || 0, nouveautes, conflits,
    applicable: (+retard.out || 0) > 0 && (+avance.out || 0) === 0 && conflits.length === 0,
  });
  ecrire({ ...lire(), ...e });
  return e;
}

// Récupère la mise à jour, réinstalle si package.json a bougé, puis relance VLAD (pont + HUD)
async function appliquer() {
  const e = await verifier();
  if (!e.possible) return { ok: false, raison: e.raison };
  if (!e.retard) return { ok: true, rien: true, raison: "déjà à jour" };
  if (e.avance) return { ok: false, raison: "ta copie a ses propres commits : fais « git pull » à la main" };
  if (e.conflits.length) return { ok: false, raison: "tu as modifié des fichiers que la mise à jour change aussi : " + e.conflits.join(", ") };
  const avant = (await git(["rev-parse", "HEAD"])).out;
  const p = await git(["pull", "--ff-only", "--quiet"]);
  if (!p.ok) return { ok: false, raison: "échec de git pull : " + p.err.slice(0, 200) };
  const changes = (await git(["diff", "--name-only", avant, "HEAD"])).out.split("\n");
  if (changes.some((f) => f === "package.json" || f === "package-lock.json")) {
    await new Promise((ok) => execFile("npm", ["install", "--silent"], { cwd: ROOT, timeout: 600000 }, () => ok()));
  }
  ecrire({ ...lire(), applique: Date.now(), retard: 0, applicable: false, nouveautes: [] });
  // relance détachée (le pont s'arrête lui-même pendant l'opération)
  setTimeout(() => spawn("bash", [path.join(ROOT, "vlad.sh"), "restart"], { cwd: ROOT, detached: true, stdio: "ignore", env: { ...process.env, VLAD_NO_OPEN: "1" } }).unref(), 500);
  return { ok: true, fichiers: changes.filter(Boolean).length, relance: true };
}

function planifier() {
  const passe = async () => {
    if (Date.now() - (lire().verifie || 0) < MOIS && !planifier.jour) return;
    const e = await verifier();
    if (e.retard) console.log(`   mise à jour : ${e.retard} nouveauté(s) disponible(s)${e.applicable ? "" : " (application manuelle)"}`);
    if (e.applicable && process.env.VLAD_AUTO_UPDATE === "1") { console.log("   mise à jour automatique…"); await appliquer(); }
  };
  setTimeout(passe, 60000);                                                 // au démarrage : si > 30 jours
  setInterval(() => { planifier.jour = true; passe(); }, 24 * 3600_000);    // puis chaque jour
}

module.exports = { verifier, appliquer, planifier, etat: lire };
