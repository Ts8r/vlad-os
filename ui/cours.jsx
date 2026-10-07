/* ═══════════════════════════════════════════════════════════════
   VLAD — page COURS : supports lus par VLAD (résumé, notions, points à savoir)
   et RÉVISION par QCM, générés cours par cours au fil de l'année.
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useMemo, useState } from "react";
import { HorlogeSegments } from "./horloge-segments.jsx";
import "./progres.css";
import "./cours.css";
import BranchedMenu from "./BranchedMenu.jsx";   // React Bits : arbre animé (matières → cours)
import { Book02Icon, Alert02Icon } from "@hugeicons/core-free-icons";

const BRIDGE = "/api";
const post = (p, o) => fetch(BRIDGE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) }).then((r) => r.json());
const date = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

function Cours({ d, recharger, reviser }) {
  const [ouvert, setOuvert] = useState(null);
  const [msg, setMsg] = useState("");
  const [survol, setSurvol] = useState(false);
  const [occupe, setOccupe] = useState(null);
  const deposer = async (files) => {
    for (const f of files) {
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); });
      const r = await post("/cours/deposer", { name: f.name, dataB64: b64 });
      setMsg(r.error ? `${f.name} : ${r.error}` : `✓ ${f.name} déposé — VLAD le lit et prépare son QCM (30 à 90 s)`);
    }
    recharger();
  };
  const stat = (id) => (d.parCours || []).find((s) => s.id === id) || { total: 0, maitrisees: 0, aRevoir: 0 };
  // arbre : une branche par matière, ses cours en feuilles (React Bits · BranchedMenu)
  const matieres = [...new Set(d.cours.map((c) => c.matiere || "Autre"))];
  const sections = matieres.map((m) => ({
    label: m,
    children: d.cours.filter((c) => (c.matiere || "Autre") === m).map((c) => ({ value: c.id, label: c.titre, icon: stat(c.id).aRevoir ? Alert02Icon : Book02Icon })),
  }));
  const c = d.cours.find((x) => x.id === ouvert) || d.cours[0];
  const brancheOuverte = Math.max(0, sections.findIndex((sc) => sc.children.some((k) => k.value === c?.id)));
  const s = c ? stat(c.id) : null, pct = s?.total ? Math.round((s.maitrisees / s.total) * 100) : 0;
  return (
    <>
      <div className={`pg-card co-depot ${survol ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }} onDragLeave={() => setSurvol(false)}
        onDrop={(e) => { e.preventDefault(); setSurvol(false); deposer([...e.dataTransfer.files]); }}>
        <div>
          <p className="pg-h" style={{ margin: 0 }}>Ajouter un cours</p>
          <p className="pg-mono pg-hint">glisse un PDF ici · VLAD le lit, le résume et en tire un QCM de 10 questions</p>
        </div>
        <label className="pg-btn co-choisir">choisir…<input type="file" multiple accept=".pdf,.md,.txt" hidden onChange={(e) => deposer([...e.target.files])} /></label>
      </div>
      {msg && <p className="pg-mono co-msg">{msg}</p>}
      {d.cours.length === 0 && <p className="pg-empty">Aucun cours pour l'instant. Dépose ton premier support ci-dessus.</p>}
      {c && (
        <div className="co-nav">
          <div className="pg-card co-menu">
            <BranchedMenu items={sections} defaultOpen={[brancheOuverte]} defaultActive={c.id} onSelect={(v) => setOuvert(v)}
              color="#38406A" accentColor="#4b6398" lineColor="rgba(75,99,152,.28)" width={300}
              rowHeight={34} indent={38} fontSize={13} />
          </div>
          <div className="pg-card co-fiche">
            <div className="co-tete">
              <div className="co-titre"><b>{c.titre}</b><span className="pg-mono">{c.matiere} · {date(c.ajoute)} · {c.qcm.length} questions{s.aRevoir ? ` · ${s.aRevoir} à revoir` : ""}</span></div>
              <div className="co-maitrise" title={`${s.maitrisees} / ${s.total} questions maîtrisées`}><i style={{ width: pct + "%" }} /></div>
            </div>
            <div className="co-corps">
              <p className="pg-text">{c.resume}</p>
              {c.notions.length > 0 && <><p className="pg-h">Notions</p><ul className="co-liste">{c.notions.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
              {c.aSavoir.length > 0 && <><p className="pg-h">À savoir</p><ul className="co-liste">{c.aSavoir.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
              <div className="co-actions">
                {c.qcm.length > 0 && <button className="pg-btn" onClick={() => reviser(c.id)}>Réviser ce cours</button>}
                <button className="pg-btn" disabled={occupe === c.id} onClick={async () => { setOccupe(c.id); const r = await post("/cours/qcm", { id: c.id }); setMsg(r.error ? "QCM : " + r.error : `✓ nouveau QCM : ${r.questions} questions`); setOccupe(null); recharger(); }}>
                  {occupe === c.id ? "VLAD rédige…" : c.qcm.length ? "Refaire le QCM" : "Générer le QCM"}
                </button>
                <button className="pg-lnk co-retirer" onClick={async () => { if (confirm("Retirer ce cours ? (le fichier reste dans le dossier cours/)")) { await post("/cours/supprimer", { id: c.id }); setOuvert(null); recharger(); } }}>retirer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Revision({ d, coursInitial, recharger }) {
  const [reglage, setReglage] = useState({ cours: coursInitial || "", mode: "melange", n: 10 });
  const [qs, setQs] = useState(null);
  const [i, setI] = useState(0);
  const [choix, setChoix] = useState(null);
  const [reps, setReps] = useState([]);
  const [fin, setFin] = useState(null);
  useEffect(() => { if (coursInitial) setReglage((r) => ({ ...r, cours: coursInitial })); }, [coursInitial]);
  const lancer = async () => {
    const p = new URLSearchParams({ n: reglage.n, mode: reglage.mode, ...(reglage.cours ? { cours: reglage.cours } : {}) });
    const r = await fetch(BRIDGE + "/cours/tirage?" + p).then((x) => x.json());
    setQs(r.questions || []); setI(0); setChoix(null); setReps([]); setFin(null);
  };
  const repondre = (k) => { if (choix !== null) return; setChoix(k); setReps((a) => [...a, { cle: qs[i].cle, juste: k === qs[i].bonne }]); };
  const suivante = async () => {
    if (i + 1 < qs.length) { setI(i + 1); setChoix(null); return; }
    await post("/cours/resultat", { reponses: reps, cours: reglage.cours || null });
    setFin({ bonnes: reps.filter((r) => r.juste).length, total: reps.length }); recharger();
  };
  const total = d.cours.reduce((t, c) => t + c.qcm.length, 0);

  if (!qs || fin) return (
    <div className="pg-card co-reglage">
      {fin && <p className="co-score"><b>{fin.bonnes} / {fin.total}</b><span>{fin.bonnes === fin.total ? "parfait" : fin.bonnes >= fin.total * 0.7 ? "bien — les erreurs reviendront à la prochaine révision" : "les questions ratées reviendront en priorité"}</span></p>}
      {qs && qs.length === 0 && !fin && <p className="pg-empty">Aucune question pour ce choix — essaie « mélange » ou un autre cours.</p>}
      <p className="pg-h">Réviser {total ? `· ${total} questions sur ${d.cours.length} cours` : ""}</p>
      {total === 0 ? <p className="pg-empty">Les QCM apparaissent ici dès qu'un cours a été lu (onglet COURS).</p> : <>
        <div className="co-champs">
          <select className="pg-freq" value={reglage.cours} onChange={(e) => setReglage({ ...reglage, cours: e.target.value })}>
            <option value="">Tous les cours</option>
            {d.cours.filter((c) => c.qcm.length).map((c) => <option key={c.id} value={c.id}>{c.titre}</option>)}
          </select>
          <select className="pg-freq" value={reglage.mode} onChange={(e) => setReglage({ ...reglage, mode: e.target.value })}>
            <option value="melange">Mélange (erreurs d'abord)</option>
            <option value="revoir">Seulement à revoir</option>
            <option value="nouvelles">Seulement les nouvelles</option>
          </select>
          <select className="pg-freq" value={reglage.n} onChange={(e) => setReglage({ ...reglage, n: +e.target.value })}>
            {[5, 10, 20, 40].map((n) => <option key={n} value={n}>{n} questions</option>)}
          </select>
          <button className="pg-btn" onClick={lancer}>{fin ? "Recommencer" : "C'est parti"}</button>
        </div>
        {(d.essais || []).length > 0 && <p className="pg-mono pg-hint co-histo">derniers essais : {d.essais.slice(-8).reverse().map((e) => `${e.bonnes}/${e.total}`).join(" · ")}</p>}
      </>}
    </div>
  );

  const q = qs[i];
  return (
    <div className="pg-card co-quiz">
      <div className="co-quiz-tete pg-mono"><span>question {i + 1} / {qs.length}</span><span>{q.coursTitre}</span></div>
      <p className="co-question">{q.q}</p>
      <div className="co-choix">
        {q.choix.map((c, k) => (
          <button key={k} onClick={() => repondre(k)}
            className={choix === null ? "" : k === q.bonne ? "juste" : k === choix ? "faux" : "eteint"}>{c}</button>
        ))}
      </div>
      {choix !== null && <>
        <p className={`co-verdict ${choix === q.bonne ? "juste" : "faux"}`}>{choix === q.bonne ? "✓ Juste" : "✗ Raté"} — {q.explication}</p>
        <button className="pg-btn" onClick={suivante}>{i + 1 < qs.length ? "Question suivante →" : "Voir le score"}</button>
      </>}
    </div>
  );
}

export default function PageCours({ onClose, vueInitiale }) {
  const [vue, setVue] = useState(vueInitiale === "revision" ? "revision" : "cours");
  const [d, setD] = useState(null);
  const [coursRevise, setCoursRevise] = useState(null);
  const recharger = () => fetch(BRIDGE + "/cours").then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { recharger(); const iv = setInterval(recharger, 10000); return () => clearInterval(iv); }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose?.(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return (
    <div className="pg">
      <div className="pg-topbar">
        <div className="pg-titre"><div><div className="pg-brand">V.L.A.D</div><div className="pg-brandsub">COURS · {vue === "cours" ? "SUPPORTS" : "RÉVISION"}</div></div><HorlogeSegments /></div>
        <div className="pg-tabs">{[["cours", "COURS"], ["revision", "RÉVISION"]].map(([k, l]) => <button key={k} className={vue === k ? "on" : ""} onClick={() => setVue(k)}>{l}</button>)}</div>
        <div className="pg-icons"><button className="pg-ic" onClick={onClose} title="Fermer (Échap)">✕</button></div>
      </div>
      {!d && <p className="pg-empty">chargement…</p>}
      {d && vue === "cours" && <Cours d={d} recharger={recharger} reviser={(id) => { setCoursRevise(id); setVue("revision"); }} />}
      {d && vue === "revision" && <Revision d={d} coursInitial={coursRevise} recharger={recharger} />}
    </div>
  );
}
