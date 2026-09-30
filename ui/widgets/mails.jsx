import React, { useState, useEffect } from "react";
import { Fold, Gauge, BRIDGE, useHud } from "./_base.jsx";

export const meta = {"id": "mails", "titre": "Mails", "icone": "✉", "categorie": "Connecteurs", "description": "Tri automatique de la boîte : urgent, à répondre, fils sans réponse.", "colonne": "right", "requiert": ["MAIL_USER"], "perso": false};

export default function MailWidget() {
  const [m, setM] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(BRIDGE + "/mail").then((r) => r.json()).then((d) => alive && setM(d)).catch(() => {});
    load();
    const iv = setInterval(load, 120000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const clean = (f) => (f || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const Row = ({ mail, tone }) => (
    <div className={`mail-row ${tone}`}>
      <b>{clean(mail.from).slice(0, 26)}</b>
      <span>{mail.subject}</span>
    </div>
  );
  return (
    <Fold id="mails" title="Mails">
      {!m?.at && <p className="dim">premier tri dans ~1 min après lancement…</p>}
      {m?.at && (
        <>
          <div className="mail-meta">{m.nonLus} non lus · trié {new Date(m.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
          {m.urgent.map((x, i) => <Row key={"u" + i} mail={x} tone="hot" />)}
          {m.aRepondre.map((x, i) => <Row key={"r" + i} mail={x} tone="" />)}
          {m.urgent.length === 0 && m.aRepondre.length === 0 && <p className="dim">rien d'urgent ni à répondre ✓</p>}
          {(m.filsATraiter || []).length > 0 && (
            <>
              <div className="mail-meta" style={{ marginTop: 8 }}>fils sans réponse de toi</div>
              {m.filsATraiter.slice(0, 5).map((t, i) => (
                <div className="mail-row" key={"t" + i}>
                  <b>{clean(t.from).slice(0, 22)} · {t.joursDepuis} j</b>
                  <span>{t.subject}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </Fold>
  );
}
