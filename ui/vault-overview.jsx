/**
 * VLAD OS — VAULT OVERVIEW (porcelaine)
 * ---------------------------------------------------------------------------
 * Scène 3D CSS (perspective + plan incliné) : noyau sombre « CENTRAL
 * INTELLIGENCE » sur podium de disques blancs, pods départements neumorphiques
 * sur un anneau, reliés par des lignes parcourues d'impulsions de données.
 * Ouverture : le noyau se déploie (comme l'œil), puis les départements
 * apparaissent DANS LE SENS HORAIRE (12 h → …).
 * Panneaux : compteurs réels (gauche) · System Status + Neural Network
 * Activity (canvas vivant) + Data Stream (droite). Clic pod → liste membres.
 */
import React, { useState, useRef, useEffect, useMemo } from "react";
import RemplirVault from "./vault-remplir.jsx";
import { HorlogeSegments } from "./horloge-segments.jsx";
import "./vault-overview.css";

const BRIDGE = "/api";   // même origine : proxy Vite en local, tunnel Cloudflare à distance
const RX = 358, RY = 358;                        // CERCLE parfait des départements (px)

// ordre horaire depuis 12 h + icônes minimalistes (style porcelaine)
const DEPT_META = [
  { key: "Notes",      label: "NOTES",              icon: "✎" },
  { key: "Projets",    label: "PROJECTS",           icon: "▣" },
  { key: "Contrats",   label: "CONTRATS",           icon: "§" },
  { key: "Clients",    label: "CLIENTS",            icon: "◈" },
  { key: "infra",      label: "SKILLS · INFRA",     icon: "☰" },
  { key: "business",   label: "SKILLS · BUSINESS",  icon: "◫" },
  { key: "design",     label: "SKILLS · DESIGN",    icon: "✦" },
  { key: "media-ia",   label: "SKILLS · MÉDIA IA",  icon: "▶" },
  { key: "Agents",     label: "AGENTS",             icon: "◉" },
  { key: "documents",  label: "SKILLS · DOCUMENTS", icon: "≡" },
  { key: "dev-flow",   label: "SKILLS · DEV FLOW",  icon: "⌥" },
  { key: "MCP",        label: "MCP",                icon: "⌘" },
  { key: "dev-visuel", label: "SKILLS · DEV VISUEL",icon: "◭" },
  { key: "divers",     label: "SKILLS · DIVERS",    icon: "✳" },
];

// département d'un nœud du graphe (clé de DEPT_META)
const deptDe = (n) => n.kind === "project" ? "Projets" : n.kind === "contract" ? "Contrats" : n.kind === "client" ? "Clients" : n.kind === "memory" ? "Notes" : n.kind === "mcp" ? "MCP" : n.kind === "agent" ? "Agents" : n.kind === "skill" ? (n.cat || "divers") : null;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
// lignes du « data stream » : nom, valeur 0..1 tirée d'un relevé de télémétrie
const RANGS = [["TOURS", (h) => (h.tour ? 1 : 0)], ["VOIX", (h) => (h.parle ? 1 : 0)], ["CPU", (h) => h.cpu / 100], ["MÉM.", (h) => h.ram / 100], ["OREILLE", (h) => (h.oreille ? 1 : 0)], ["CERVEAU", (h) => (h.cerveau ? 1 : 0)]];

export default function VaultOverview({ onClose }) {
  const [data, setData] = useState(null);
  const [tele, setTele] = useState(null);
  const [lien, setLien] = useState(true);            // le pont répond-il ? (télémétrie fraîche)
  const [sel, setSel] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [remplir, setRemplir] = useState(false);   // panneau « Remplir le vault »
  const [clock, setClock] = useState(0);          // uptime affiché (s)
  const netRef = useRef(null), streamRef = useRef(null), barsRef = useRef(null);
  const histRef = useRef([]);                        // relevés de télémétrie successifs (data stream)

  const load = () => fetch(BRIDGE + "/vault").then((r) => r.json()).then(setData).catch(() => setData({ nodes: [], counts: {} }));
  const refresh = async () => { setRefreshing(true); try { await fetch(BRIDGE + "/vault?refresh=1"); } catch {} await load(); setSel(null); setRefreshing(false); };

  useEffect(() => {
    load();
    const sonde = () => fetch(BRIDGE + "/telemetry", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
      const prev = histRef.current[histRef.current.length - 1];
      histRef.current = [...histRef.current.slice(-29), { tour: !!prev && d.turns > prev.turns, turns: d.turns, parle: !!d.speaking, cpu: d.cpuLoad || 0, ram: d.ramUsedPct || 0, oreille: !!d.stt, cerveau: !!d.brain && !d.authExpired }];
      setTele(d); setLien(true);
    }).catch(() => setLien(false));
    sonde();
    const iv = setInterval(sonde, 5000);
    const tick = setInterval(() => setClock((c) => c + 1), 1000);
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => { clearInterval(iv); clearInterval(tick); window.removeEventListener("keydown", onKey); };
  }, []);

  // départements : ordre horaire fixe, seulement ceux qui existent
  const depts = useMemo(() => {
    if (!data) return [];
    const groups = {};
    (data.nodes || []).forEach((n) => { const d = deptDe(n); if (d) (groups[d] ||= []).push(n); });
    return DEPT_META.filter((m) => groups[m.key]?.length).map((m, _, arr) => ({ ...m, members: groups[m.key] }));
  }, [data]);

  /* ── données vivantes lues par les canvas (refs : les boucles rAF voient l'état courant) ── */
  const teleRef = useRef(null), selRef = useRef(null);
  teleRef.current = tele; selRef.current = sel;

  /* ── Neural Network Activity : le VRAI graphe du Vault sur une sphère — un point par
     nœud, groupés par département (calottes), un trait par lien ; tourne plus vite quand
     VLAD parle ou vient de répondre ; le département sélectionné s'allume ── */
  const graphe = useMemo(() => {
    if (!data) return null;
    // nœuds triés par département → chaque département = une bande contiguë de la spirale
    // de Fibonacci (densité uniforme sur toute la sphère, pas de paquet ni de pôle écrasé)
    const noeuds = (data.nodes || []).filter((n) => deptDe(n));
    // les gros départements au milieu (équateur, projection fidèle), les petits vers les pôles
    const tailles = {}; noeuds.forEach((n) => { tailles[deptDe(n)] = (tailles[deptDe(n)] || 0) + 1; });
    const ordre = []; Object.keys(tailles).sort((a, b) => tailles[b] - tailles[a]).forEach((k, i) => (i % 2 ? ordre.unshift(k) : ordre.push(k)));
    noeuds.sort((a, b) => ordre.indexOf(deptDe(a)) - ordre.indexOf(deptDe(b)));
    const N = noeuds.length;
    const pts = noeuds.map((n, i) => {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), ph = i * 2.399963;
      return { p: [r * Math.cos(ph), y, r * Math.sin(ph)], dept: deptDe(n) };
    });
    const idx = new Map(noeuds.map((n, k) => [n.id, k]));
    const liens = (data.edges || []).map((e) => [idx.get(e.a), idx.get(e.b)]).filter(([a, b]) => a != null && b != null && a !== b);
    // les nœuds liés se rapprochent un peu (attraction douce le long de la sphère), sans s'agglutiner
    for (let it = 0; it < 30; it++) {
      for (const [a, b] of liens) {
        const A = pts[a].p, B = pts[b].p;
        for (let k = 0; k < 3; k++) { const d = (B[k] - A[k]) * 0.006; A[k] += d; B[k] -= d; }
      }
      pts.forEach((q) => { q.p = norm(q.p); });
    }
    return { pts, liens, n: N };
  }, [data]);
  useEffect(() => {
    const cv = netRef.current; if (!cv || !graphe) return;
    const ctx = cv.getContext("2d");
    let a = 0, raf, alive = true;
    const draw = () => {
      if (!alive) return;
      const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.44;
      const t = teleRef.current, actif = !!(t && (t.speaking || histRef.current[histRef.current.length - 1]?.tour));
      a += actif ? 0.012 : 0.0025;
      const S = selRef.current;
      // rotation autour de l'axe vertical, puis légère inclinaison vers le regard (les bandes polaires ne sont plus vues par la tranche)
      const pr = graphe.pts.map(({ p: [x, y, z] }) => { const X = x * Math.cos(a) + z * Math.sin(a), Z0 = -x * Math.sin(a) + z * Math.cos(a); const Y = y * 0.94 - Z0 * 0.34, Z = y * 0.34 + Z0 * 0.94; return [cx + X * r, cy + Y * r * 0.92, Z]; });
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = devicePixelRatio * 0.5;
      for (const [i, j] of graphe.liens) {
        const prof = (pr[i][2] + pr[j][2] + 2) / 4, on = S && (graphe.pts[i].dept === S || graphe.pts[j].dept === S);
        ctx.strokeStyle = on ? `rgba(128,120,255,${0.35 + 0.45 * prof})` : `rgba(120,126,190,${0.05 + 0.18 * prof})`;
        ctx.beginPath(); ctx.moveTo(pr[i][0], pr[i][1]); ctx.lineTo(pr[j][0], pr[j][1]); ctx.stroke();
      }
      pr.forEach((q, i) => {
        const on = S && graphe.pts[i].dept === S, devant = q[2] > 0;
        ctx.fillStyle = on ? `rgba(128,120,255,${devant ? 0.8 : 0.4})` : `rgba(110,116,185,${devant ? 0.7 : 0.22})`;
        ctx.beginPath(); ctx.arc(q[0], q[1], devicePixelRatio * (on ? 1.5 : devant ? 1.1 : 0.8), 0, 7); ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [graphe]);

  /* ── Data Stream : les 26 derniers relevés de télémétrie (un toutes les 5 s ≈ 2 min),
     une ligne par signal, colonne de droite = maintenant ── */
  useEffect(() => {
    const cv = streamRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
    const dpr = devicePixelRatio, L = 46 * dpr, cols = 26, gy = H / RANGS.length, gx = (W - L) / cols;
    const hist = histRef.current;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${7 * dpr}px ${getComputedStyle(cv).fontFamily}`; ctx.textBaseline = "middle";
    RANGS.forEach(([nom, f], y) => {
      ctx.fillStyle = "rgba(122,132,166,.9)"; ctx.fillText(nom, 0, gy * (y + 0.5));
      for (let x = 0; x < cols; x++) {
        const h = hist[hist.length - cols + x], v = h ? f(h) : null;
        ctx.fillStyle = `rgba(110,116,185,${v == null ? 0.08 : 0.16 + 0.72 * v})`;
        ctx.beginPath(); ctx.arc(L + gx * (x + 0.5), gy * (y + 0.5), dpr * (v >= 0.5 ? 1.8 : 1.1), 0, 7); ctx.fill();
      }
    });
  }, [tele]);

  /* ── barres : charge RÉELLE de chaque cœur (relevé du pont), ambre au-delà de 85 % ── */
  useEffect(() => {
    const cv = barsRef.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
    const t = teleRef.current;
    const cores = t?.cores?.some((c) => c != null) ? t.cores.map((c) => c ?? 0) : Array.from({ length: t?.cores?.length || 12 }, () => t?.cpuLoad || 0);
    const bw = W / cores.length;
    ctx.clearRect(0, 0, W, H);
    cores.forEach((pct, i) => {
      const h = Math.max(devicePixelRatio, (H * pct) / 100);
      ctx.fillStyle = pct >= 85 ? "rgba(217,164,65,.8)" : "rgba(110,116,185,.55)";
      ctx.fillRect(i * bw + bw * 0.22, H - h, bw * 0.56, h);
    });
  }, [tele]);

  const c = data?.counts || {};
  const up = (tele?.uptimeMin || 0) * 60 + clock;
  const uptime = [Math.floor(up / 3600), Math.floor(up / 60) % 60, up % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const N = depts.length;
  // état réel : ce qui cloche, du plus grave (2, rouge) au simple avertissement (1, ambre)
  const soucis = [];
  if (!lien) soucis.push([2, "PONT INJOIGNABLE"]);
  else if (tele) {
    if (tele.authExpired) soucis.push([2, "SESSION CLAUDE EXPIRÉE"]);
    else if (!tele.brain) soucis.push([2, "CERVEAU ARRÊTÉ"]);
    // oreille (Whisper) et voix chargent pendant ~2 min après un redémarrage du pont : pas une panne
    const chauffe = (tele.uptimeMin || 0) < 2;
    if (!tele.stt && !chauffe) soucis.push([1, "OREILLE HORS LIGNE"]);
    if (!tele.tts && !chauffe) soucis.push([1, "VOIX HORS LIGNE"]);
    if (tele.cpuLoad >= 85) soucis.push([1, `CPU ${tele.cpuLoad} %`]);
    if (tele.ramUsedPct >= 92) soucis.push([1, `MÉMOIRE ${tele.ramUsedPct} %`]);
    if (tele.diskUsedPct >= 90) soucis.push([1, `DISQUE ${tele.diskUsedPct} %`]);
  }
  const niveau = soucis.length ? Math.max(...soucis.map((s) => s[0])) : 0;
  const etat = soucis.length ? soucis.map((s) => s[1]).join(" · ") : "ALL SYSTEMS NOMINAL";

  return (
    <div className="vo">
      {remplir && <RemplirVault onClose={() => setRemplir(false)} onFait={refresh} />}
      {/* en-tête + rails */}
      <header className="vo-head">
        <div className="pg-titre"><div><div className="vo-brand">V.L.A.D</div><div className="vo-sub">VAULT OVERVIEW</div></div><HorlogeSegments /></div>
        <div className="vo-actions">
          <button className="vo-remplir" onClick={() => setRemplir(true)} title="Indexer tes skills, agents, CLAUDE.md, mémoires, notes…">⊕ REMPLIR</button>
          <button onClick={refresh} title="Re-scanner">{refreshing ? "…" : "↻"}</button>
          <button onClick={onClose} title="Fermer (Échap)">✕</button>
        </div>
      </header>

      <aside className="vo-rail">
        {[["▣", c.projects, "PROJECTS"], ["§", c.contracts, "CONTRATS"], ["◈", c.clients, "CLIENTS"], ["✦", c.skills, "SKILLS"], ["✎", c.notes, "NOTES"], ["⌘", c.mcp, "MCP"], ["◉", c.agents, "AGENTS"]].map(([ic, n, l]) => (
          <div className="vo-count" key={l}><span className="vo-count-ic">{ic}</span><div><b>{n ?? "—"}</b><span>{l}</span></div></div>
        ))}
        <div className={`vo-online ${lien ? "" : "ko"}`}>{lien ? "SYSTEM ONLINE" : "SYSTEM OFFLINE"}</div>
      </aside>

      {/* scène 3D */}
      {/* MOBILE : la scène 3D est illisible réduite → liste native des départements */}
      <div className="vo-mobile">
        <div className="vo-mobile-core"><b>VLAD</b><span>VAULT</span></div>
        {depts.map((d) => (
          <button key={d.key} className={`vo-mrow ${sel === d.key ? "on" : ""}`}
            onClick={() => setSel(sel === d.key ? null : d.key)}>
            <span className="vo-mrow-ic">{d.icon}</span>
            <span className="vo-mrow-name">{d.label}</span>
            <i>{d.members.length}</i>
          </button>
        ))}
      </div>

      {/* scène : composition frontale (réf. : illustration quasi face caméra) */}
      <div className="vo-scene">
        <div className="vo-stage">
          {/* orbites pointillées */}
          <svg className="vo-links" viewBox="-700 -450 1400 900">
            <ellipse className="vo-orbit" rx={RX * 1.18} ry={RY * 1.18} cx="0" cy="0" />
            <ellipse className="vo-orbit o2" rx={RX * 0.62} ry={RY * 0.62} cx="0" cy="0" />
            {depts.map((d, i) => {
              const ang = (-90 + (360 / N) * i) * Math.PI / 180;
              const x = Math.cos(ang) * RX, y = Math.sin(ang) * RY;
              const x0 = Math.cos(ang) * 225, y0 = Math.sin(ang) * 225;
              const dur = 2.2 + (i % 4) * 0.5, beg = 1.4 + i * 0.3;
              return (
                <g key={d.key}>
                  <line x1={x0} y1={y0} x2={x} y2={y} className="vo-link" style={{ animationDelay: `${0.9 + i * 0.12}s` }} />
                  <circle r="3" className="vo-pulse">
                    <animate attributeName="cx" values={`${x0};${x}`} dur={`${dur}s`} begin={`${beg}s`} repeatCount="indefinite" />
                    <animate attributeName="cy" values={`${y0};${y}`} dur={`${dur}s`} begin={`${beg}s`} repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0;.9;.9;0" dur={`${dur}s`} begin={`${beg}s`} repeatCount="indefinite" />
                  </circle>
                </g>
              );
            })}
          </svg>
          {/* podium : anneaux elliptiques sous la lentille */}
          <div className="vo-podium">
            {[0, 1, 2, 3].map((i) => <span key={i} className={`vo-disc d${i}`} />)}
          </div>
          {/* la boule de l'œil (sans iris) — VLAD VAULT à sa place */}
          <div className="vo-core">
            <div className="vo-core-ball" />
            <div className="vo-core-txt"><b>VLAD</b><span>VAULT</span></div>
          </div>
          {/* pods départements — sens horaire, face caméra, profondeur par échelle/flou */}
          {depts.map((d, i) => {
            const ang = (-90 + (360 / N) * i) * Math.PI / 180;
            const x = Math.cos(ang) * RX, y = Math.sin(ang) * RY;
            const depth = (Math.sin(ang) + 1) / 2;              // 0 = loin (haut) · 1 = proche (bas)
            // étiquette : dans le prolongement du rayon (haut → au-dessus, bas → dessous, côtés → à côté)
            const cx = Math.cos(ang), cy = Math.sin(ang);
            const lpos = cx > 0.35 ? "r" : cx < -0.35 ? "l" : "c";
            return (
              <div className="vo-anchor" key={d.key}
                style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`,
                         zIndex: 2 + Math.round(depth * 3),
                         animationDelay: `${0.8 + i * 0.12}s`,
                         "--depth": 0.9 + depth * 0.2 }}>
                <span className="vo-underglow" />
                <button className={`vo-pod ${sel === d.key ? "on" : ""}`} onClick={() => setSel(sel === d.key ? null : d.key)}>{d.icon}</button>
                <div className={`vo-pod-label ${lpos}`} style={{ "--cx": cx.toFixed(3), "--cy": cy.toFixed(3) }}>
                  <b>{d.label}</b><span>{d.members.length} {d.key === "Projets" ? "PROJECTS" : d.key === "Contrats" ? "CONTRATS" : d.key === "Notes" ? "NOTES" : d.key === "Agents" ? "AGENTS" : d.key === "MCP" ? "MCP" : "SKILLS"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* panneau membres */}
      {sel && (
        <div className="vo-members">
          <div className="vo-members-head">
            <span>{depts.find((d) => d.key === sel)?.label}</span>
            <button onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="vo-members-list">
            {depts.find((d) => d.key === sel)?.members.map((m, i) => (
              <div className="vo-member" key={i}><b>{m.cmd || m.label}</b>{m.info && <span>{m.info}</span>}</div>
            ))}
          </div>
        </div>
      )}

      {/* panneau droit */}
      <aside className="vo-side">
        <div className="vo-card">
          <h4>SYSTEM STATUS <i className={`vo-dot n${niveau}`} title={etat} /></h4>
          {[["CPU", tele?.cpuLoad], ["MEMORY", tele?.ramUsedPct], ["DISK", tele?.diskUsedPct]].map(([l, v]) => (
            <div className="vo-stat" key={l}>
              <div className="vo-stat-l"><span>{l}</span><b>{v ?? "—"}%</b></div>
              <div className="vo-stat-rail"><span style={{ width: (v || 0) + "%" }} /></div>
            </div>
          ))}
          <div className="vo-stat-l"><span>AI PROCESSES</span><b className="vo-active">{tele?.brain ? "ACTIVE" : "OFF"}</b></div>
        </div>
        <div className="vo-card">
          <h4>NEURAL NETWORK ACTIVITY <span className="vo-cap">{graphe ? `${graphe.n} nœuds · ${graphe.liens.length} liens` : "…"}</span></h4>
          <canvas ref={netRef} className="vo-net" />
        </div>
        <div className="vo-card">
          <h4>DATA STREAM <span className="vo-cap">2 dernières minutes</span></h4>
          <canvas ref={streamRef} className="vo-stream" />
        </div>
        <div className="vo-card">
          <div className="vo-os"><b>V.L.A.D OS</b><span>VLAD OS · pont vocal</span></div>
          <div className="vo-up-l">UPTIME<b>{uptime}</b></div>
          <div className="vo-up-l"><span>CPU · {tele?.cores?.length || 12} CŒURS</span><span>{tele?.cpuLoad ?? "—"} %</span></div>
          <canvas ref={barsRef} className="vo-bars" />
        </div>
      </aside>

      <footer className={`vo-foot n${niveau}`}><i className={`vo-dot n${niveau}`} /> {etat}</footer>
    </div>
  );
}
