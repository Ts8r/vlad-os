import React from "react";
import { Fold, useHud } from "./_base.jsx";

export const meta = {"id": "raccourcis", "titre": "Raccourcis", "icone": "⌘", "categorie": "Assistant", "description": "Questions et débuts de phrase en un clic.", "colonne": "left", "requiert": [], "perso": false};

// Raccourcis une-touche : soit une question complète envoyée à VLAD (ask),
// soit un début de phrase posé dans la barre (draft) que tu complètes.
const SHORTCUTS = [
  { name: "Faire le point",       hint: "agenda · priorités",  ask: "Fais-moi un point : mon agenda à venir, puis ce qui te semble prioritaire cette semaine." },
  { name: "Mon agenda",           hint: "7 prochains jours",   ask: "Résume mon agenda des 7 prochains jours." },
  { name: "Retrouver un fichier", hint: "complète puis ↵",     draft: "Retrouve sur mon Mac " },
  { name: "Créer un rappel",      hint: "mode action",         draft: "Crée un rappel : " },
  { name: "Ajouter un rendez-vous", hint: "mode action",       draft: "Ajoute à mon agenda : " },
];

export default function Raccourcis() {
  const { ask, setDraft } = useHud();
  return (
    <Fold id="raccourcis" title="Raccourcis">
      {SHORTCUTS.map((s) => (
        <button className="skill" key={s.name}
          onClick={() => s.ask ? ask(s.ask) : setDraft(s.draft)}>
          <span>{s.name}</span><i>{s.hint}</i>
        </button>
      ))}
    </Fold>
  );
}
