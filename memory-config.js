/**
 * VLAD OS — Memory Config (Étape 2 : La Mémoire)
 * ------------------------------------------------
 * Coffre Obsidian = mémoire long-terme de VLAD. 100 % local, 100 % à toi.
 * Règle d'or : TOUT LIVRABLE = UN FICHIER .md RANGÉ DANS LE VAULT.
 * La mémoire grandit seule, session après session.
 */

const os = require("os");
const path = require("path");

// Chemin du vault. Le repo embarque son propre vault (forkable par client) ;
// bascule sur "~/vault" si tu veux un coffre global hors-repo.
const VAULT_PATH = path.join(__dirname, "vault");
const VAULT_PATH_GLOBAL = path.join(os.homedir(), "vault"); // ~/vault (alternative)

// Domaines (dossiers) du vault et leur rôle.
const DOMAINS = {
  inbox: "Captures brutes, quick capture — à trier ensuite.",
  processed: "Notes synthétisées et reliées : projets, clients, idées, recherches.",
  reports: "Exports auto : revues hebdo, usage des Skills, analyses.",
  archive: "Terminé / froid — conservé pour réutilisation.",
};

// Convention de nommage des notes.
const NAMING = {
  case: "kebab-case",
  example: "refonte-site-dupont.md",
  rule: "Nom explicite, pas 'template-*.md'. Date dans le frontmatter, pas dans le nom.",
};

// Règle de mémoire, appliquée par le Skill `memory`.
const MEMORY_RULE =
  "Tout livrable produit par VLAD = un fichier .md rangé dans le vault, " +
  "avec frontmatter YAML et liens [[wikilink]] vers les notes connexes.";

module.exports = {
  VAULT_PATH,
  VAULT_PATH_GLOBAL,
  DOMAINS,
  NAMING,
  MEMORY_RULE,
  templatesDir: path.join(VAULT_PATH, "processed"),
  ownership: "100% local — aucune donnée ne quitte la machine.",
};
