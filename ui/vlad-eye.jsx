/**
 * VLAD OS — Œil (d'après « Eye visual » de Gleb Kuznetsov, CodePen fourni)
 * --------------------------------------------------------------------------
 * L'original boucle en 4 s : déployé (0-33 %) → replié (40-90 %) → déployé.
 * Ici la boucle est DÉCOUPÉE en deux états stables pilotés par les props :
 *   awake=false → .asleep : bille nue, anneaux repliés (pose 65 % de la boucle)
 *   awake=true  → .awake  : tout se déploie (pose 0 %) + micro-animations
 *   speaking    → .talk   : pulsation lumineuse de la pupille
 * + EYE-TRACKER : la pupille (vrai élément, plus un ::after) suit le curseur
 *   en douceur (lissage rAF), uniquement à l'éveil.
 */
import React, { useRef, useEffect } from "react";
import "./vlad-eye.css";

export default function VLADEye({ awake = false, speaking = false }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const pupil = root.querySelector(".pupil");
    let tx = 0, ty = 0, cx = 0, cy = 0, raf;
    const onMove = (e) => {
      if (!root.classList.contains("awake")) { tx = 0; ty = 0; return; }
      const r = root.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      const dist = Math.min(36, Math.hypot(mx, my) / 9);   // débattement max ~36px
      const dir = Math.atan2(my, mx);
      tx = Math.cos(dir) * dist; ty = Math.sin(dir) * dist;
    };
    const onLeave = () => { tx = 0; ty = 0; };
    const tick = () => {                                    // lissage : l'iris « glisse »
      cx += (tx - cx) * 0.10; cy += (ty - cy) * 0.10;
      pupil.style.setProperty("--tx", cx.toFixed(1) + "px");
      pupil.style.setProperty("--ty", cy.toFixed(1) + "px");
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={rootRef} className={`vlad-eye ${awake ? "awake" : "asleep"}${speaking ? " talk" : ""}`}>
      <div className="eye"><span className="pupil" /></div>
      {Array.from({ length: 14 }, (_, i) => <div key={i} className={`circle-${i + 1}`} />)}
      <div className="glitch" />
      <div className="fragment-1" /><div className="fragment-2" /><div className="fragment-3" />
      <svg width="0" height="0" viewBox="0 0 190 190" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <clipPath id="bagel1"><path fillRule="evenodd" clipRule="evenodd" d="M95 190C147.467 190 190 147.467 190 95C190 42.533 147.467 0 95 0C42.533 0 0 42.533 0 95C0 147.467 42.533 190 95 190ZM95 120C108.807 120 120 108.807 120 95C120 81.1929 108.807 70 95 70C81.1929 70 70 81.1929 70 95C70 108.807 81.1929 120 95 120Z" /></clipPath>
          <clipPath id="bagel2"><path fillRule="evenodd" clipRule="evenodd" d="M71 142C110.212 142 142 110.212 142 71C142 31.7878 110.212 0 71 0C31.7878 0 0 31.7878 0 71C0 110.212 31.7878 142 71 142ZM71 139C108.555 139 139 108.555 139 71C139 33.4446 108.555 3 71 3C33.4446 3 3 33.4446 3 71C3 108.555 33.4446 139 71 139Z" /></clipPath>
          <clipPath id="bagel3"><path fillRule="evenodd" clipRule="evenodd" d="M60 120C93.1372 120 120 93.1372 120 60C120 26.8628 93.1372 0 60 0C26.8628 0 0 26.8628 0 60C0 93.1372 26.8628 120 60 120ZM60 115C90.3757 115 115 90.3757 115 60C115 29.6243 90.3757 5 60 5C29.6243 5 5 29.6243 5 60C5 90.3757 29.6243 115 60 115Z" /></clipPath>
          <clipPath id="bagel4"><path fillRule="evenodd" clipRule="evenodd" d="M38 76C58.9868 76 76 58.9868 76 38C76 17.0132 58.9868 0 38 0C17.0132 0 0 17.0132 0 38C0 58.9868 17.0132 76 38 76ZM38 72C56.7777 72 72 56.7776 72 38C72 19.2224 56.7777 4 38 4C19.2223 4 4 19.2224 4 38C4 56.7776 19.2223 72 38 72Z" /></clipPath>
        </defs>
      </svg>
    </div>
  );
}
