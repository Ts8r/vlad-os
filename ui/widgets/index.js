/* Registre des widgets : chaque ui/widgets/<id>.jsx (hors _fichiers) est découvert tout seul. */
const mods = import.meta.glob("./*.jsx", { eager: true });

export const WIDGETS = Object.fromEntries(
  Object.entries(mods)
    .filter(([f, m]) => !f.startsWith("./_") && m.meta?.id && m.default)
    .map(([, m]) => [m.meta.id, { requiert: [], perso: false, colonne: "right", ...m.meta, Composant: m.default }]),
);

// Accueil d'origine : ce que voit une nouvelle installation (widgets qui marchent sans clé).
export const DISPOSITION_DEFAUT = {
  left: ["journal", "aujourdhui", "note", "raccourcis"],
  right: ["meteo", "agenda", "systeme", "rss"],
  config: {},
};

export const CATEGORIES = ["Assistant", "Quotidien", "Travail", "Veille", "Connecteurs", "Système"];
