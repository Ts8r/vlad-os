import React, { useEffect, useState } from "react";
import { Fold, ListeReglages, postJson, useWidgetConfig } from "./_base.jsx";

export const meta = {"id": "sites", "titre": "Statut des sites", "icone": "◍", "categorie": "Travail", "description": "Tes sites répondent-ils ? Statut HTTP et temps de réponse, toutes les 5 min.", "colonne": "right", "requiert": [], "perso": false};

export default function Sites() {
  const [urls, setUrls] = useWidgetConfig("sites", []);
  const [reglage, setReglage] = useState(false);
  const [r, setR] = useState(null);
  useEffect(() => {
    if (!urls.length) return;
    let alive = true;
    const load = () => postJson("/sites", { urls }).then((d) => alive && setR(d)).catch(() => {});
    load();
    const iv = setInterval(load, 300000);
    return () => { alive = false; clearInterval(iv); };
  }, [urls.join("|")]);
  const hote = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
  const enPanne = (r?.sites || []).filter((s) => !s.ok).length;
  return (
    <Fold id="sites" title={enPanne ? `Sites · ${enPanne} KO` : "Sites"}
      extra={<button className="w-fold" onClick={() => setReglage((x) => !x)} title="Choisir les sites">⚙</button>}>
      {(reglage || !urls.length) && (
        <ListeReglages valeurs={urls} aide="Une adresse par ligne (https://…)" placeholder="https://monsite.fr"
          onSave={(v) => { setUrls(v); setReglage(false); setR(null); }} />
      )}
      {!reglage && urls.length > 0 && !r && <p className="dim">vérification…</p>}
      {!reglage && (r?.sites || []).map((s) => (
        <a key={s.url} className="proj" href={s.url} target="_blank" rel="noopener" title={s.url}>
          <span className={`proj-dot ${s.ok ? "on" : "ko"}`} />
          <span className="proj-name">{hote(s.url)}</span>
          <i>{s.ok ? `${s.ms} ms` : s.status ? `HTTP ${s.status}` : s.erreur}</i>
        </a>
      ))}
    </Fold>
  );
}
