/* ═══════════════════════════════════════════════════════════════
   VLAD — widgets en « plasma » (@cruxgarden/plasma-ui) : panneaux liquides WebGL.
   · Ordinateur seulement : la bibliothèque est gourmande en GPU et déconseillée
     sur mobile → l'iPhone garde les cartes CSS habituelles.
   · Le fond réfracté est le dégradé porcelaine de VLAD, peint dans un canevas
     (WebGL ne lit pas le DOM : on lui donne l'image de ce qu'il y a derrière).
   · Désactivable : localStorage « vlad_plasma » = "0".
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from "react";
import { PlasmaProvider, PlasmaCanvas } from "@cruxgarden/plasma-ui";
import { PlasmaCtx } from "./widgets/_base.jsx";

const ORDI = "(min-width: 1021px) and (pointer: fine)";
const actifParDefaut = () => { try { return localStorage.getItem("vlad_plasma") !== "0"; } catch { return true; } };

// même dégradé que le body (styles.css) : linear-gradient(-45deg, #8691b3, #edeef3)
function peindreFond(cv) {
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  // -45deg en CSS = de bas-droite vers haut-gauche
  const d = (w + h) / 2;
  const cx = w / 2, cy = h / 2, ux = Math.SQRT1_2, uy = Math.SQRT1_2;
  const grad = g.createLinearGradient(cx + ux * d, cy + uy * d, cx - ux * d, cy - uy * d);
  grad.addColorStop(0, "#8691b3"); grad.addColorStop(1, "#edeef3");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
}

// La bibliothèque ne sait pas encore couper une surface dans une zone qui défile :
// un widget à moitié sorti de sa colonne laissait une plaque de verre vide sous la
// colonne. On découpe donc le CANEVAS aux contours des colonnes (en dehors : le fond
// de la page, le même dégradé → découpe invisible). 24 px de marge sur les côtés
// pour garder l'ombre et le reflet ; aucune marge en haut et en bas.
function decoupeColonnes() {
  const parts = [...document.querySelectorAll(".stage .col")].map((c) => {
    const r = c.getBoundingClientRect(), m = 24;
    return `M ${r.left - m} ${r.top} H ${r.right + m} V ${r.bottom} H ${r.left - m} Z`;
  });
  return parts.length ? `path('${parts.join(" ")}')` : "none";
}

function CanevasDecoupe() {
  const [clip, setClip] = useState("none");
  useEffect(() => {
    const maj = () => setClip(decoupeColonnes());
    maj();
    const ro = new ResizeObserver(maj);
    document.querySelectorAll(".stage, .stage .col").forEach((el) => ro.observe(el));
    window.addEventListener("resize", maj);
    return () => { ro.disconnect(); window.removeEventListener("resize", maj); };
  }, []);
  return <PlasmaCanvas zIndex={-1} style={{ clipPath: clip }} />;
}

export default function PlasmaFond({ children }) {
  const [ordi, setOrdi] = useState(() => window.matchMedia(ORDI).matches);
  const [fond, setFond] = useState(null);
  useEffect(() => {
    const mq = window.matchMedia(ORDI);
    const maj = () => setOrdi(mq.matches);
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  useEffect(() => {
    if (!ordi) return;
    const cv = document.createElement("canvas");
    peindreFond(cv); setFond(cv);
    const r = () => peindreFond(cv);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, [ordi]);

  if (!ordi || !fond || !actifParDefaut()) return <PlasmaCtx.Provider value={false}>{children}</PlasmaCtx.Provider>;
  return (
    <PlasmaProvider
      theme="light" background={fond} ground="clear" radius={14}   // « clear » : seulement les panneaux, le vrai fond de VLAD reste visible autour
      tint="#ffffff" opacity={0.38} frost={0.35} elevation={0.22}
      blend={10}               // < écart de 14 px entre widgets : chacun reste distinct
      stretch={0}              // le verre suit exactement le widget (sinon il traîne au défilement)
      viscosity={0.6} grain={0} pointerDrop={false} ambientDrops={false}
      rimColor="#4b6398" rim={0.55} shimmer={0.5} glow={0.6}
      maxSurfaces={20}         // au-delà de 20 widgets, des panneaux perdraient leur verre
      canvas={false}>
      <CanevasDecoupe />
      <PlasmaCtx.Provider value={true}>{children}</PlasmaCtx.Provider>
    </PlasmaProvider>
  );
}
