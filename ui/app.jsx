/**
 * VLAD OS — HUD V.A.U.L.T. (refonte « œil HAL »)
 * ------------------------------------------------
 * Direction visuelle (réf. 2 images + 3 CodePens) :
 *   · centre   : œil HAL — verre sombre, noyau bleu (hal-eye.jsx), 4 états
 *   · dessous  : prise vocale = onde horizontale fine (wave-line.jsx)
 *   · autour   : widgets UTILES uniquement — horloge, tâches, skills,
 *                journal, jauges système RÉELLES (/telemetry) — pas de déco
 *   · vault    : bouton ✺ → graphe neuronal plein écran (inchangé, live)
 * Plomberie conservée : /ask /listen /speak /voices /state /upload.
 */

import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import VLADEye from "./vlad-eye.jsx";
import WaveLine from "./wave-line.jsx";
import VaultOverview from "./vault-overview.jsx";
import AgendaPage from "./agenda.jsx";
import PageCours from "./cours.jsx";
import { HudCtx, BoardCtx } from "./widgets/_base.jsx";
import { useBoard, Colonne, Bibliotheque } from "./widget-board.jsx";
import PlasmaFond from "./plasma-fond.jsx";   // widgets en panneaux liquides (ordinateur)
import HorlogeAraignee from "./horloge.jsx";
import "./styles.css";

const BRIDGE = "/api";
// adresse publique de VLAD (tunnel Cloudflare, etc.) — facultative, dans .env : VITE_VLAD_PUBLIC_URL=https://vlad.mondomaine.fr
const PUBLIC_URL = (import.meta.env.VITE_VLAD_PUBLIC_URL || "").replace(/\/$/, "");
const PUBLIC_HOST = PUBLIC_URL.replace(/^https?:\/\//, "");   // même origine : proxy Vite en local, tunnel Cloudflare à distance
// distant (tunnel) = la voix de VLAD doit sortir de CET appareil, pas du Mac
const REMOTE = !["localhost", "127.0.0.1"].includes(location.hostname) && !location.hostname.endsWith(".local");
// iOS DÉCLARE webkitSpeechRecognition même là où elle ne marche pas (PWA plein écran) :
// sur iPhone/iPad, toujours passer par l'enregistreur → Whisper du Mac.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);


/* ── Session Cloudflare Access (iPhone via le tunnel, VITE_VLAD_PUBLIC_URL) : quand elle expire,
   l'API répond par une redirection de connexion et l'app semblait morte. On le dit. ── */
function SessionAccess() {
  const [expiree, setExpiree] = useState(false);
  useEffect(() => {
    const verif = () => fetch(BRIDGE + "/state", { redirect: "manual", cache: "no-store" })
      .then((r) => setExpiree(r.type === "opaqueredirect" || (!r.ok && r.status === 0) || !(r.headers.get("content-type") || "").includes("json")))
      .catch(() => setExpiree(true));
    verif(); const iv = setInterval(verif, 60000); return () => clearInterval(iv);
  }, []);
  // installée depuis l'adresse LOCALE du Mac (192.168.x.x) : ne marche qu'en Wi-Fi maison
  if (PUBLIC_URL && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) return (
    <a className="acces-banniere douce" href={PUBLIC_URL + "/"}>
      Cette version ne marche qu'en Wi-Fi à la maison — installe VLAD depuis {PUBLIC_HOST} pour l'avoir partout
    </a>
  );
  if (!expiree) return null;
  return (
    <button className="acces-banniere" onClick={() => { location.href = location.origin + "/?t=" + Date.now(); }}>
      Session Cloudflare expirée — appuie ici pour te reconnecter (code reçu par e-mail)
    </button>
  );
}

/* ── Mise à jour de VLAD disponible sur GitHub : bandeau discret, un clic pour l'appliquer.
   Masquable (se représente à la version suivante). ── */
function MiseAJour() {
  const [m, setM] = useState(null);
  const [etat, setEtat] = useState("");
  useEffect(() => {
    const load = () => fetch(BRIDGE + "/maj").then((r) => r.json()).then(setM).catch(() => {});
    load(); const iv = setInterval(load, 3600000); return () => clearInterval(iv);
  }, []);
  const cle = "vlad_maj_vue_" + (m?.distant || "");
  if (!m?.retard || etat === "masque") return null;
  try { if (localStorage.getItem(cle) === "1") return null; } catch {}
  const appliquer = async () => {
    setEtat("en cours");
    const r = await fetch(BRIDGE + "/maj/appliquer", { method: "POST" }).then((x) => x.json()).catch(() => ({ ok: false, raison: "pont injoignable" }));
    if (r.ok && r.relance) { setEtat("relance"); setTimeout(() => location.reload(), 20000); }
    else setEtat("échec : " + (r.raison || "inconnu"));
  };
  const masquer = () => { try { localStorage.setItem(cle, "1"); } catch {} setEtat("masque"); };
  return (
    <div className="acces-banniere douce maj-banniere">
      {etat === "relance" ? "✓ VLAD est à jour — il redémarre, la page se recharge dans 20 s…"
        : etat === "en cours" ? "Mise à jour en cours…"
        : etat.startsWith("échec") ? etat
        : <>
            <span title={(m.nouveautes || []).join("\n")}>Mise à jour de VLAD disponible ({m.retard} nouveauté{m.retard > 1 ? "s" : ""})</span>
            {m.applicable
              ? <button onClick={appliquer}>Mettre à jour</button>
              : <span className="maj-note">{m.conflits?.length ? "tu as modifié : " + m.conflits.join(", ") + " — fais « git pull » à la main" : "fais « git pull » dans le dossier de VLAD"}</span>}
          </>}
      {etat !== "relance" && etat !== "en cours" && <button className="maj-x" onClick={masquer} title="Masquer jusqu'à la prochaine version">×</button>}
    </div>
  );
}

function HUD() {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState([]);
  // journal PARTAGÉ : même conversation sur le Mac et l'iPhone (source = serveur)
  useEffect(() => {
    let alive = true;
    const pull = () => fetch(BRIDGE + "/journal").then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d.messages)) setMessages(d.messages); })
      .catch(() => {});
    pull();
    const iv = setInterval(pull, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  const [draft, setDraft] = useState("");
  const [silent, setSilent] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  // page Agenda : null (fermée) ou { vue, jour }. Liens profonds : #agenda, #agenda/semaine,
  // #agenda/2026-10-05 ; les anciens #cap et #progres ouvrent l'onglet Semaine (ou #cap/habitudes…).
  // page Cours : null (fermée) ou "cours" / "revision" — liens #cours, #cours/revision
  const [pageCours, setPageCours] = useState(() => { const [p, a] = location.hash.slice(1).split("/"); return p === "cours" ? (a || "cours") : null; });
  const [agenda, setAgenda] = useState(() => {
    const [page, arg] = location.hash.slice(1).split("/");
    if (page === "agenda") return /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? { vue: "mois", jour: arg } : { vue: arg || "mois" };
    if (page === "cap" || page === "progres") return { vue: arg || "semaine" };
    return null;
  });
  const setAgendaOpen = (o) => setAgenda(o ? { vue: "mois" } : null);
  const [attached, setAttached] = useState([]);
  const [awake, setAwake] = useState(() => localStorage.getItem("vlad_awake") === "1");   // survit aux rechargements
  useEffect(() => { try { localStorage.setItem("vlad_awake", awake ? "1" : "0"); } catch {} }, [awake]);
  const [logOpen, setLogOpen] = useState(() => localStorage.getItem("vlad_log_open") !== "0");
  const toggleLog = () => setLogOpen((o) => { try { localStorage.setItem("vlad_log_open", o ? "0" : "1"); } catch {} return !o; });
  // Vider = effacer l'affichage ET la mémoire de conversation de VLAD (/reset relance le process)
  const clearLog = () => { setMessages([]); fetch(BRIDGE + "/reset", { method: "POST" }).catch(() => {}); };
  const fileRef = useRef(null);
  const logRef = useRef(null);
  const [mobTab, setMobTab] = useState(() => localStorage.getItem("vlad_mobtab") || "chat");
  const pickTab = (t) => {   // mobile : la page est continue, l'onglet fait défiler vers la zone
    setMobTab(t); try { localStorage.setItem("vlad_mobtab", t); } catch {}
    // « Tableau » vise le premier widget APRÈS le journal (Agenda), qui ouvre la pile de gauche
    const cible = t === "infos" ? document.querySelectorAll(".col.left .widget")[1] : document.querySelector(".stage");
    if (cible) cible.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sndRef = useRef(null);       // lecteur unique (déverrouillé au geste, exigence iOS)
  const unlockAudio = () => {
    if (!REMOTE) return;
    if (!sndRef.current) sndRef.current = new Audio();
    const a = sndRef.current;
    if (a.__unlocked) return;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    a.play().then(() => { a.__unlocked = true; }).catch(() => {});
  };
  const playQueue = async (files) => {
    if (!REMOTE || !files?.length) return;
    if (!sndRef.current) sndRef.current = new Audio();
    const a = sndRef.current;
    setSpeaking(true);
    for (const f of files) {
      await new Promise((done) => {
        a.src = BRIDGE + "/snd/" + f;
        a.onended = done; a.onerror = done;
        a.play().catch(done);
      });
    }
    setSpeaking(false);
  };
  // ── Mains libres : micro ouvert en continu + mot d'éveil « Vlad » ──
  const [handsfree, setHandsfree] = useState(() => localStorage.getItem("vlad_handsfree") === "1");
  // ── Mode exposé (présentation) : la parole s'accumule par diapositive au lieu de partir phrase par phrase ──
  const [expose, setExpose] = useState(() => localStorage.getItem("vlad_expose") === "1");
  const bufRef = useRef("");        // texte accumulé de la diapositive en cours (mains libres)
  const bufTimerRef = useRef(null); // envoi après 5 s de silence
  useEffect(() => { try { localStorage.setItem("vlad_expose", expose ? "1" : "0"); } catch {} if (expose) setAwake(true); }, [expose]);
  const hfRef = useRef(null);      // instance SpeechRecognition continue
  const askRef = useRef(null);     // ask() frais (les callbacks de reco vivent longtemps)
  const stRef = useRef({});        // états frais lisibles depuis les callbacks
  stRef.current = { busy, speaking, awake, handsfree, voice, expose };

  useEffect(() => {
    fetch(BRIDGE + "/voices").then((r) => r.json())
      .then((d) => { setVoices(d.voices || []); if (d.voices?.[0]) setVoice(d.voices[0].id); })
      .catch(() => {});
  }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [messages]);

  async function onAttach(e) {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
        const r = await fetch(BRIDGE + "/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, dataB64: b64 }) });
        const d = await r.json();
        if (d.path) setAttached((a) => [...a, { path: d.path, name: d.name || f.name }]);
      } catch {}
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function ask(text) {
    unlockAudio();                                    // dans le geste utilisateur quand possible
    const files = attached.map((a) => a.path);
    if ((!text.trim() && !files.length) || busy) return;
    const label = attached.length ? `${text} ${attached.map((a) => "📎 " + a.name).join(" ")}`.trim() : text;
    setMessages((m) => [...m, { from: "you", text: label }].slice(-30));
    setBusy(true); setThinking(true); setSpeaking(false);
    setAttached([]);
    const poll = REMOTE ? null : setInterval(async () => {   // /state reflète les hauts-parleurs du MAC
      try {
        const s = await (await fetch(BRIDGE + "/state")).json();
        if (s.speaking) { setSpeaking(true); setThinking(false); }
        else { setSpeaking(false); setThinking(true); }
      } catch {}
    }, 200);
    try {
      const r = await fetch(BRIDGE + "/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, silent, files, remote: REMOTE }),
      });
      const d = await r.json();
      setMessages((m) => [...m, { from: "vlad", text: d.response || "…" }].slice(-30));
      if (REMOTE && !silent && d.audio?.length) playQueue(d.audio);   // la voix sort d'ICI
    } catch {
      setMessages((m) => [...m, { from: "vlad", text: "⚠️ Pont vocal injoignable — lance « npm run vlad »." }].slice(-30));
    }
    if (poll) clearInterval(poll); setThinking(false); if (!REMOTE) setSpeaking(false);
    setBusy(false);
  }
  askRef.current = ask;   // toujours la version fraîche (états à jour)

  // Journal AUTONOME : sa hauteur ne dépend plus
  // de la colonne d'à côté — il suit son contenu jusqu'au plafond CSS, et se
  // replie indépendamment. (L'ancien alignement JS au pixel est supprimé.)

  function onSend(e) {
    e.preventDefault();
    const t = draft.trim(); if (!t && !attached.length) return;
    setDraft(""); ask(t);
  }

  // ── Boucle mains libres : reco continue, mot d'éveil, anti-larsen ──
  useEffect(() => {
    try { localStorage.setItem("vlad_handsfree", handsfree ? "1" : "0"); } catch {}
    if (!handsfree) { try { hfRef.current?.abort(); } catch {} hfRef.current = null; return; }
    const SRC = window.SpeechRecognition || window.webkitSpeechRecognition;
    // iOS : l'API EXISTE mais ne marche pas en PWA — la démarrer réserve le micro
    // pour rien (pastille orange permanente) et onend la relance à l'infini.
    if (!SRC || IOS) {
      setMessages((m) => [...m, { from: "vlad", text: "🎙️ Mains libres indisponible ici (pas de reco vocale native). Sur iPhone : bouton 🎙 — un tap pour parler, un tap pour envoyer." }].slice(-30));
      setHandsfree(false); return;
    }
    let stopped = false;
    const rec = new SRC();
    hfRef.current = rec;
    rec.lang = "fr-FR"; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const st = stRef.current;
      const txt = (e.results[e.results.length - 1][0].transcript || "").trim();
      // anti-larsen : tout ce que le micro capte pendant que VLAD parle/réfléchit est ignoré
      if (!txt || st.busy || st.speaking) return;
      if (st.expose) {
        // exposé : pas de mot d'éveil, la parole s'accumule ; envoi après 5 s de silence ou sur « à vous »
        const cue = /\b(à vous|a vous|je vous écoute|j'ai terminé|jai termine|j'ai fini)\s*[.!?]*\s*$/i;
        const fin = cue.test(txt);
        bufRef.current = (bufRef.current + " " + txt.replace(cue, "")).trim();
        setDraft(bufRef.current);
        clearTimeout(bufTimerRef.current);
        const envoyer = () => { const t = bufRef.current.trim(); bufRef.current = ""; setDraft(""); if (t) askRef.current(t); };
        if (fin) envoyer(); else bufTimerRef.current = setTimeout(envoyer, 5000);
        return;
      }
      if (!st.awake) {
        // en veille : SEUL le mot d'éveil compte — « Vlad » (Whisper/Chrome écrivent parfois Vlade)
        const w = txt.match(/\bvlade?\b/i);
        if (!w) return;
        setAwake(true);
        const after = txt.slice(w.index + w[0].length).replace(/^[\s,.!?]+/, "").trim();
        if (after.length > 2) askRef.current(after);
        else fetch(BRIDGE + "/speak", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Oui ?", voice: st.voice }) }).catch(() => {});
        return;
      }
      // éveillé : chaque phrase est une commande (le « Vlad » d'appel en tête est toléré)
      askRef.current(txt.replace(/^\s*vlade?[\s,]*/i, ""));
    };
    // Chrome coupe la reco (~60 s ou silence long) → on la relance, sauf pendant que VLAD parle
    rec.onend = () => {
      const st = stRef.current;
      if (!stopped && st.handsfree && !st.busy && !st.speaking) { try { rec.start(); } catch {} }
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setHandsfree(false);
        setMessages((m) => [...m, { from: "vlad", text: "🎙️ Autorise le micro dans Chrome (cadenas → Micro) pour le mode mains libres." }].slice(-30));
      }
    };
    try { rec.start(); } catch {}
    return () => { stopped = true; clearTimeout(bufTimerRef.current); try { rec.abort(); } catch {} hfRef.current = null; };
  }, [handsfree]);

  // pendant que VLAD parle : micro coupé NET (sinon il s'entend et se répond) ; on rouvre après
  useEffect(() => {
    const rec = hfRef.current; if (!rec || !handsfree) return;
    if (busy || speaking) { try { rec.abort(); } catch {} }
    else { try { rec.start(); } catch {} }        // déjà démarré → start() jette, on ignore
  }, [busy, speaking, handsfree]);
  // ── Micro iPhone/PWA : MediaRecorder → /transcribe (Whisper du Mac) ──
  // Tap = enregistre (bouton rouge) · re-tap = envoie. Utilisé quand la reco
  // vocale d'Apple est absente (web-app plein écran iOS) ou en panne.
  const mrRef = useRef(null);
  const mrKillRef = useRef(null);  // abandon : libère le micro SANS rien envoyer
  async function recordPhone() {
    if (mrRef.current) { try { mrRef.current.stop(); } catch {} return; }   // 2e tap = stop
    // sentinelle SYNCHRONE avant l'await : un double-tap pendant getUserMedia
    // créerait un 2e enregistreur orphelin qui garderait le micro ouvert
    mrRef.current = "acquiring";
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch {
      mrRef.current = null;
      setMessages((m) => [...m, { from: "vlad", text: IOS ? "🎙️ Micro refusé. Sur iPhone : ouvre " + (PUBLIC_HOST || "l'adresse de VLAD") + " dans Safari une fois, autorise le micro (aA → Réglages du site), puis relance l'app de l'écran d'accueil." : "🎙️ Autorise le micro pour VLAD dans le navigateur." }].slice(-30));
      return;
    }
    // l'app a été masquée pendant l'attente du micro → on n'enregistre pas dans le dos
    if (document.visibilityState === "hidden") { stream.getTracks().forEach((t) => t.stop()); mrRef.current = null; return; }
    const mr = new MediaRecorder(stream);
    const chunks = [];
    let discard = false;
    // filets : enregistrement oublié → coupé seul à 3 min ; app quittée → coupé net
    const guard = setTimeout(() => { discard = true; try { mr.stop(); } catch {} }, stRef.current.expose ? 300000 : 180000);
    mrKillRef.current = () => { discard = true; try { mr.stop(); } catch {} stream.getTracks().forEach((t) => t.stop()); };
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      clearTimeout(guard);
      stream.getTracks().forEach((t) => t.stop());
      // ne nettoyer que si on est ENCORE l'enregistreur courant (onstop tardif)
      if (mrRef.current === mr) { mrRef.current = null; mrKillRef.current = null; setListening(false); }
      if (discard) return;
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/mp4" });
      if (blob.size < 1200) return;                       // tap accidentel, rien dit
      const b64 = await new Promise((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(",")[1] || "");
        fr.readAsDataURL(blob);
      });
      setThinking(true);
      try {
        const d = await (await fetch(BRIDGE + "/transcribe", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: b64, mime: blob.type }),
        })).json();
        setThinking(false);
        if (d.text) ask(d.text);
        else setMessages((m) => [...m, { from: "vlad", text: "Je n'ai rien entendu, réessaie." }].slice(-30));
      } catch { setThinking(false); }
    };
    mrRef.current = mr; setListening(true);
    mr.start();
  }

  // ── Libération du micro quand l'app disparaît (verrouillage, accueil,
  // changement d'app). Sans ça, iOS garde la pastille micro allumée des heures
  // sur une session orpheline. Sur Mac local on ne touche PAS au mains libres :
  // écouter la pièce fenêtre réduite est voulu.
  useEffect(() => {
    const release = (force) => {
      if (!force && document.visibilityState === "visible") return;
      try { mrKillRef.current?.(); } catch {}
      if (IOS) { try { hfRef.current?.abort(); } catch {} }
    };
    const onVis = () => release(false);
    const onHide = () => release(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide); };
  }, []);

  async function onMic() {
    unlockAudio();
    if (busy) return;
    if (mrRef.current) { try { mrRef.current.stop(); } catch {} return; }   // stop de l'enregistrement en cours
    if (listening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    // iOS/distant : l'API peut EXISTER sans fonctionner → enregistreur direct, fiable ;
    // exposé : idem, pour parler une diapositive entière (tap = début, re-tap = envoi)
    if (!SR || IOS || REMOTE || expose) return recordPhone();
    if (SR) {
      const rec = new SR();
      rec.lang = "fr-FR"; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
      setListening(true);
      let got = false;
      rec.onresult = (e) => { got = true; const txt = e.results[0][0].transcript.trim(); setListening(false); if (txt) ask(txt); };
      rec.onerror = (e) => {
        setListening(false);
        if (e.error === "no-speech" || e.error === "aborted") return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed")
          setMessages((m) => [...m, { from: "vlad", text: "🎙️ Autorise le micro dans Chrome (cadenas → Micro)." }].slice(-30));
        else recordPhone();                               // repli : micro de CET appareil + Whisper du Mac
      };
      rec.onend = () => { if (!got) setListening(false); };
      try { rec.start(); } catch { setListening(false); }
      return;
    }
    whisperFallback();
  }
  async function whisperFallback() {
    setListening(true);
    try {
      const r = await fetch(BRIDGE + "/listen", { method: "POST" });
      const d = await r.json();
      setListening(false);
      if (d.text) ask(d.text);
    } catch {
      setListening(false);
      setMessages((m) => [...m, { from: "vlad", text: "⚠️ Micro/pont injoignable — lance « npm run vlad »." }].slice(-30));
    }
  }
  const testVoice = () => fetch(BRIDGE + "/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice }) }).catch(() => {});

  // Réveil : une PAROLE adressée (busy) ou une réponse (speaking) — jamais la simple
  // ouverture du micro : cliquer 🎙 ou activer ∞ le laisse en veille tant qu'on ne lui parle pas.
  useEffect(() => { if (busy || speaking) setAwake(true); }, [busy, speaking]);
  const eyeLabel = !awake ? (handsfree ? "EN VEILLE · DITES « VLAD »" : "EN VEILLE")
    : speaking ? "EN PAROLE" : thinking ? "EN RÉFLEXION" : listening ? (expose ? "EXPOSÉ · JE VOUS ÉCOUTE" : "EN ÉCOUTE") : (expose ? "EXPOSÉ · À VOUS" : "EN REPOS");

  const board = useBoard();
  const [bibCol, setBibCol] = useState(null);   // colonne visée par la bibliothèque ouverte
  const ouvrirPage = (p) => p === "cours" || p === "revision" ? setPageCours(p) : p === "agenda" ? setAgenda({ vue: "mois" }) : ["cap", "semaine", "habitudes", "rapport"].includes(p) ? setAgenda({ vue: p === "cap" ? "semaine" : p }) : p === "vault" ? setVaultOpen(true) : null;
  const hud = { ask, setDraft, ouvrirPage, messages, logOpen, toggleLog, clearLog, logRef };

  if (vaultOpen) return <><VaultOverview onClose={() => setVaultOpen(false)} /></>;   // horloge gravée sur toutes les pages sauf l'accueil
  if (agenda) return <><AgendaPage vueInitiale={agenda.vue} jourInitial={agenda.jour || null} onClose={() => { history.replaceState(null, "", " "); setAgenda(null); }} /></>;
  if (pageCours) return <><PageCours vueInitiale={pageCours} onClose={() => { history.replaceState(null, "", " "); setPageCours(null); }} /></>;

  return (
    <HudCtx.Provider value={hud}><BoardCtx.Provider value={board}><PlasmaFond>
    <div className={`stage tab-${mobTab} ${board.editing ? "editing" : ""}`}>
      <SessionAccess />
      <MiseAJour />
      {/* En-tête : cadran · marque · pages */}
      <header className="topbar">
        <HorlogeAraignee />
        <div className="brand-txt brand-center">V.L.A.D<span className="brand-dot">.</span></div>
        <div className="topbtns">
          <button className="vault-btn" onClick={() => setAgendaOpen(true)} title="Agenda — mois, journées, semaine, habitudes, rapport">◉ AGENDA</button>
          <button className="vault-btn" onClick={() => setVaultOpen(true)} title="Vault — graphe neuronal">✺ VAULT</button>
          <button className="vault-btn" onClick={() => setPageCours("cours")} title="Cours — supports lus par VLAD et révision par QCM">◈ COURS</button>
          <button className={`vault-btn ${board.editing ? "on" : ""}`} onClick={() => board.setEditing((e) => !e)}
            title="Choisir et ranger les widgets de l'accueil">{board.editing ? "✓ TERMINÉ" : "⊞ WIDGETS"}</button>
        </div>
      </header>

      {/* Colonnes de widgets : disposition choisie dans la bibliothèque (⊞ WIDGETS) */}
      <Colonne board={board} col="left" className="col left" onAjouter={setBibCol} />

      {/* Centre : œil (Gleb Kuznetsov, états veille/éveil) + onde vocale */}
      <main className="center">
        <div className="eyegroup">
          <VLADEye awake={awake} speaking={speaking} />
          <div className="hal-label">
            <span className="hal-label-top">ASSISTANT IA</span>
            <span className="hal-label-state">{eyeLabel}</span>
          </div>
          <button className="wake-btn" onClick={() => setAwake((a) => !a)}>
            {awake ? "◐ METTRE EN VEILLE" : "◉ RÉVEILLER"}
          </button>
        </div>
        <div className="wave-zone"><WaveLine active={speaking || listening} boost={speaking ? 0.4 : 0} /></div>
      </main>

      <Colonne board={board} col="right" className="col right" onAjouter={setBibCol} />

      {/* Pied : saisie + voix */}
      <footer className="dock">
        <div className="mobtabs">
          <button className={mobTab === "chat" ? "on" : ""} onClick={() => pickTab("chat")}>Assistant</button>
          <button className={mobTab === "infos" ? "on" : ""} onClick={() => pickTab("infos")}>Tableau</button>
        </div>
        {attached.length > 0 && (
          <div className="attachments">
            {attached.map((a, i) => (
              <span className="attach-chip" key={i}>📎 {a.name}
                <button type="button" onClick={() => setAttached((arr) => arr.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
        )}
        <form className="chatbar" onSubmit={onSend}>
          <button type="button" className={`mic ${listening ? "live" : ""}`} onClick={onMic} title="Parler (une prise)">🎙️</button>
          <button type="button" className={`mic hf ${handsfree ? "live" : ""}`} onClick={() => setHandsfree((h) => !h)}
            title="Mains libres : micro ouvert en continu — en veille, dites « Vlad » pour le réveiller">∞</button>
            <button type="button" className={`mic expo ${expose ? "live" : ""}`} onClick={() => setExpose((e) => !e)}
              title="Mode exposé (présentation) : parle par diapositive — 🎙 un tap pour commencer, un tap pour envoyer ; en ∞ la parole s'accumule et part après 5 s de silence ou sur « à vous »">🎓</button>
          <button type="button" className="attach" onClick={() => fileRef.current?.click()} title="Joindre un document">📎</button>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onAttach} />
          <input className="chat-in" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={silent ? "Écris à VLAD (silencieux)…" : "Parle ou écris à VLAD…"} />
          <button type="submit" className="send" title="Envoyer">↵</button>
        </form>
        <div className="voicebar">
          {/* la voix est fixe (Rémy) — seul reste le coupe-son */}
          <button type="button" className={`vb-toggle ${silent ? "on" : ""}`} onClick={() => setSilent((s) => !s)}>
            {silent ? "🔇 silencieux" : "🔊 voix"}
          </button>
        </div>
        {/* signature de l'auteur — à conserver (voir LICENSE et README) */}
        <a className="credit" href="https://ts8rstudio.com" target="_blank" rel="noopener">VLAD OS · Ts8r Studio</a>
      </footer>
    </div>
    {bibCol && <Bibliotheque board={board} col={bibCol} onClose={() => setBibCol(null)} />}
    </PlasmaFond></BoardCtx.Provider></HudCtx.Provider>
  );
}

const container = document.getElementById("root");
const root = (window.__vladRoot ||= createRoot(container));
root.render(<HUD />);
