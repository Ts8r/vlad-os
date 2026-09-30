import React from "react";
import { Fold, usePoll } from "./_base.jsx";

export const meta = {"id": "github", "titre": "GitHub", "icone": "⑂", "categorie": "Connecteurs", "description": "PR à relire, tes PR ouvertes et les issues qui te sont assignées.", "colonne": "right", "requiert": ["GITHUB"], "perso": false};

function Liste({ titre, items }) {
  if (!items?.length) return null;
  return (
    <>
      <div className="mail-meta" style={{ marginTop: 6 }}>{titre} · {items.length}</div>
      {items.map((x) => (
        <a key={x.url} className="mail-row rss-item" href={x.url} target="_blank" rel="noopener">
          <b>{x.repo} #{x.num}</b><span>{x.titre}</span>
        </a>
      ))}
    </>
  );
}

export default function Github() {
  const g = usePoll("/github", 300000);
  const vide = g?.configured && !g.error && !g.relire?.length && !g.mesPr?.length && !g.issues?.length;
  return (
    <Fold id="github" title={g?.relire?.length ? `GitHub · ${g.relire.length} à relire` : "GitHub"}>
      {!g && <p className="dim">chargement…</p>}
      {g && !g.configured && <p className="dim">Mets <code>GITHUB_TOKEN</code> dans <code>.env</code>, ou connecte la CLI : <code>gh auth login</code>.</p>}
      {g?.error && <p className="dim">GitHub injoignable — {g.error}</p>}
      {vide && <p className="dim">rien à relire, aucune PR ni issue ouverte ✓</p>}
      <Liste titre="à relire" items={g?.relire} />
      <Liste titre="mes PR ouvertes" items={g?.mesPr} />
      <Liste titre="issues assignées" items={g?.issues} />
    </Fold>
  );
}
