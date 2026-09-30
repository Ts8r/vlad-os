/**
 * VLAD OS — Prise vocale (onde horizontale)
 * -------------------------------------------
 * Ligne bleue fine sur toute la largeur (réf. image 2) :
 *   au repos   → ondulation douce, entrelacs de 3 sinusoïdes basse amplitude
 *   en activité→ pics nerveux (écoute micro / parole), amplitude élevée
 * Canvas 2D léger (~1 ms/frame), fenêtre gaussienne pour que l'onde meure aux bords.
 */
import React, { useRef, useEffect } from "react";

export default function WaveLine({ active = false, boost = 0 }) {
  const ref = useRef(null);
  const st = useRef({ amp: 0.12, t: 0 });

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf, alive = true;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      cv.width = r.width * devicePixelRatio;
      cv.height = r.height * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      if (!alive) return;
      const W = cv.width, H = cv.height, mid = H / 2;
      const s = st.current;
      s.t += active ? 0.11 : 0.025;
      // amplitude cible : repos 0.12 · actif 0.75 (+ boost temps réel de la voix)
      const target = active ? 0.75 + boost * 0.5 : 0.12;
      s.amp += (target - s.amp) * 0.08;

      ctx.clearRect(0, 0, W, H);
      const layers = [
        { f: 1.0, ph: 0.0, a: 1.0, w: 1.4, al: 0.9 },
        { f: 1.7, ph: 2.1, a: 0.65, w: 1.0, al: 0.45 },
        { f: 2.6, ph: 4.2, a: 0.42, w: 0.8, al: 0.3 },
      ];
      for (const L of layers) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const u = x / W;                                   // 0..1
          const win = Math.exp(-Math.pow((u - 0.5) * 3.4, 2)); // gaussienne centrée
          const jag = active ? Math.sin(u * 90 + s.t * 7 * L.f) * 0.5 : 0; // pics nerveux
          const y = mid + (Math.sin(u * 26 * L.f + s.t * 3 + L.ph) + jag)
                    * win * s.amp * (H * 0.42) * L.a;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(75,99,152,${L.al})`;      // indigo (thème clair CodePen)
        ctx.lineWidth = L.w * devicePixelRatio;
        ctx.shadowColor = "rgba(134,145,179,0.9)";
        ctx.shadowBlur = 8 * devicePixelRatio * (active ? 1.6 : 1);
        ctx.stroke();
      }
      // la ligne de base continue, qui traverse tout l'écran
      ctx.beginPath();
      ctx.moveTo(0, mid); ctx.lineTo(W, mid);
      ctx.strokeStyle = "rgba(75,99,152,0.35)";
      ctx.lineWidth = 1 * devicePixelRatio;
      ctx.shadowBlur = 4 * devicePixelRatio;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [active, boost]);

  return <canvas ref={ref} className="waveline" />;
}
