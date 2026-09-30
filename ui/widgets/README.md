# Widgets de l'accueil

Chaque fichier `ui/widgets/<id>.jsx` est un widget. Il est **découvert tout seul** : il suffit
de créer le fichier pour qu'il apparaisse dans la bibliothèque (**⊞ WIDGETS** → « + Ajouter un widget »).
Les fichiers qui commencent par `_` (comme `_base.jsx`) ne sont pas des widgets.

## Écrire un widget

```jsx
import React from "react";
import { Fold, usePoll, useWidgetConfig } from "./_base.jsx";

export const meta = {
  id: "bonjour",               // unique, = nom du fichier
  titre: "Bonjour",
  icone: "☺",
  categorie: "Quotidien",      // Assistant · Quotidien · Travail · Veille · Connecteurs · Système
  description: "Une ligne affichée dans la bibliothèque.",
  colonne: "right",            // colonne proposée par défaut
  requiert: [],                // clés vérifiées par /widgets/env (ex. ["GITHUB"]) → badge « à configurer »
  perso: false,                // true = propre à ton installation, exclu d'une version publique
};

export default function Bonjour() {
  const [nom, setNom] = useWidgetConfig("bonjour", "toi");   // réglage partagé Mac/iPhone (layout.json)
  const t = usePoll("/telemetry", 10000);                    // route du pont, rafraîchie toutes les 10 s
  return <Fold id="bonjour" title="Bonjour"><p>Salut {nom} — CPU {t?.cpuLoad ?? "…"} %</p></Fold>;
}
```

- `Fold` fournit l'en-tête, le pli et les contrôles du mode édition (↑ ↓ ⇄ ×, glisser-déposer).
- `useHud()` donne accès à l'assistant : `ask(texte)`, `setDraft(texte)`, `ouvrirPage("agenda"|"cap"|"vault")`.
- Un widget qui plante affiche son erreur sans éteindre le reste de l'accueil.
- Besoin d'une API externe sans CORS ou d'un secret ? Ajoute une route dans `voice/widgets-api.js`
  et lis le secret dans `.env` (jamais côté navigateur).

## Disposition

Stockée par le pont dans `layout.json` (non versionné) : `{ left: [...ids], right: [...ids], config: { id: réglages } }`.
Accueil d'origine : `DISPOSITION_DEFAUT` dans `ui/widgets/index.js`.
