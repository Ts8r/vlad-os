/* ═══ VLAD — HORLOGE ARAIGNÉE : le CodePen « spider watch » porté tel quel
   (structure SVG, tweens GSAP et MorphSVG d'origine), recoloré porcelaine.
   Cadran à chiffres dessinés, six petits rouages « toile » qui tictaquent,
   araignée dont les pattes sont les aiguilles : retournement de patte (scaleX)
   quand l'aiguille change de côté, pli (morph) au hasard, clignement.
   Pas les grands rouages floutés. Date et heure digitales dessous. ═══ */
import React, { useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { TRACES as P } from "./horloge-paths.js";

gsap.registerPlugin(MorphSVGPlugin);
// horloge = temps réel : quand l'onglet revient d'arrière-plan (iPhone, volet masqué),
// pas de « lissage » qui ferait ramper les rouages et les pattes pendant des secondes
gsap.ticker.lagSmoothing(0);
const ENCRE = "#38406A", ARDOISE = "#4b6398";

export default function HorlogeAraignee() {
  const root = useRef();
  const [txt, setTxt] = useState({ date: "", heure: "" });
  useLayoutEffect(() => {
    const svg = root.current.querySelector("svg");
    const q = gsap.utils.selector(svg);
    const sec = q("#ara-sec")[0], min = q("#ara-min")[0], hr = q("#ara-hr")[0];
    const handSec = q("#ara-hand-sec")[0], handMin = q("#ara-hand-min")[0], handHr = q("#ara-hand-hr")[0], face = q("#ara-face")[0];

    const cibles = [sec, min, hr, handSec, handMin, handHr, face, ...q(".cog")];
    // PAS de gsap.context() : il retiendrait chaque gsap.set/to créé dans les callbacks
    // (un par demi-seconde pour l'aiguille des secondes) jusqu'au démontage — fuite vérifiée.
    // Les animations infinies sont gardées ici et tuées au démontage ; les sets ponctuels
    // s'auto-retirent de la timeline globale une fois joués, comme dans le CodePen.
    const vivants = [];
    {
      /* ── startAnimation() d'origine ── */
      function setTimeSec() { gsap.set(sec, { rotation: geSecRotation, transformOrigin: "50% 50%" }); }
      function setTimeMinHr() {
        gsap.set(min, { rotation: getMinRotation, transformOrigin: "50% 50%" });
        gsap.set(hr, { rotation: getHrRotation, transformOrigin: "50% 50%" });
      }
      // la patte change de côté (scaleX −1) quand l'aiguille passe l'autre moitié du cadran
      function geSecRotation() {
        const rotation = new Date().getSeconds() * 6;
        const scaleXSec = gsap.getProperty(sec, "scaleX");
        if (Math.abs(gsap.getProperty(sec, "rotation") - rotation) >= 12) gsap.set(sec, { rotation, transformOrigin: "50% 50%" });
        if (rotation >= 180 && rotation < 360 && scaleXSec == 1) gsap.to(sec, { scaleX: -1, duration: 0.25 });
        else if ((rotation < 180 || rotation >= 360) && scaleXSec == -1) gsap.to(sec, { scaleX: 1, duration: 0.25 });
        return rotation;
      }
      function getMinRotation() {
        const n = new Date();
        const rotation = n.getMinutes() * 6 + (n.getSeconds() * 6) / 59;
        const scaleXMin = gsap.getProperty(min, "scaleX");
        if (Math.abs(gsap.getProperty(min, "rotation") - rotation) >= 5) gsap.set(min, { rotation, transformOrigin: "50% 50%" });
        if (rotation >= 180 && rotation < 360 && scaleXMin == 1) gsap.to(min, { scaleX: -1, duration: 0.25 });
        else if ((rotation < 180 || rotation >= 360) && scaleXMin == -1) gsap.to(min, { scaleX: 1, duration: 0.25 });
        return rotation;
      }
      function getHrRotation() {
        const n = new Date();
        const rotation = (n.getHours() % 12) * 30 + n.getMinutes() * 0.5;
        const scaleHr = gsap.getProperty(hr, "scaleX");
        if (Math.abs(gsap.getProperty(hr, "rotation") - rotation) >= 5) gsap.set(hr, { rotation, transformOrigin: "50% 50%" });
        if (rotation >= 180 && rotation < 360 && scaleHr == 1) gsap.to(hr, { scaleX: -1, duration: 0.25 });
        else if ((rotation < 180 || rotation >= 360) && scaleHr == -1) gsap.to(hr, { scaleX: 1, duration: 0.25 });
        return rotation;
      }

      setTimeSec();
      setTimeMinHr();

      // rouages : un cran avec rebond, une seconde de pause, et on recommence
      const cran = function () { this.invalidate().delay(1).restart(true); };
      vivants.push(
        gsap.to(q(".cw.t24"), { duration: 1, rotation: "-=15", transformOrigin: "50% 50%", ease: "bounce", onComplete: cran }),
        gsap.to(q(".cw.t20"), { duration: 1, rotation: "-=18", transformOrigin: "50% 50%", ease: "bounce", onComplete: cran }),
        gsap.to(q(".ccw.t12"), { duration: 1, rotation: "+=30", transformOrigin: "50% 50%", ease: "bounce", onComplete: cran }));

      vivants.push(gsap.to(min, { duration: 0.5, rotation: getMinRotation, transformOrigin: "50% 50%", ease: "none", onComplete: function () {
        if (gsap.getProperty(min, "rotation") >= 360) gsap.set(min, { rotation: 0, transformOrigin: "50% 50%" });
        this.invalidate().delay(5).restart(true);
      } }));
      vivants.push(gsap.to(hr, { duration: 0.5, rotation: getHrRotation, transformOrigin: "50% 50%", ease: "none", onComplete: function () {
        if (gsap.getProperty(hr, "rotation") >= 360) gsap.set(hr, { rotation: 0, transformOrigin: "50% 50%" });
        this.invalidate().delay(5).restart(true);
      } }));
      vivants.push(gsap.to(sec, { duration: 0.5, rotation: geSecRotation, transformOrigin: "50% 50%", ease: "bounce", onComplete: function () {
        setTimeSec();
        if (gsap.getProperty(sec, "rotation") >= 360) gsap.set(sec, { rotation: 0, transformOrigin: "50% 50%" });
        this.invalidate().delay(0).restart(true);
      } }));

      // clignement : morph face01 → face02, 4 allers-retours, puis pause de 4 à 8 s
      const tg0 = gsap.timeline({ repeat: -1, repeatDelay: 5, defaults: { duration: 0.5, ease: "power1.out" } })
        .to(face, { morphSVG: P.face02, repeat: 4, yoyo: true, onComplete() { tg0.repeatDelay(gsap.utils.random(4, 8, 0.25)); } });
      vivants.push(tg0);

      // pli des pattes : morph vers la variante pliée puis retour, seulement si la patte
      // n'est pas près de la verticale (fenêtres d'angle d'origine), toutes les 6 à 10 s
      const pli = (groupe, main, plie, droite, fenetre, depart) => {
        const tg = gsap.timeline({ repeat: -1, repeatDelay: 5, defaults: { duration: 1.5, ease: "bounce" } })
          .delay(depart)
          .call(() => {
            const rotation = parseFloat(gsap.getProperty(groupe, "rotation").toFixed(1));
            if (fenetre(rotation)) {
              gsap.timeline({ repeat: 0, defaults: { duration: 0.25, ease: "bounce.in" } })
                .to(main, { morphSVG: plie })
                .to(main, { morphSVG: droite });
            }
          })
          .set(groupe, { onComplete() { tg.repeatDelay(gsap.utils.random(6, 10, 0.25)); tg.delay(0); } });
        return tg;
      };
      vivants.push(
        pli(sec, handSec, P.handSec02, P.handSec01, (r) => (r > 30 && r < 150) || (r > 210 && r < 330), 1),
        pli(min, handMin, P.handMin02, P.handMin01, (r) => (r > 5 && r < 175) || (r > 185 && r < 355), 5),
        pli(hr, handHr, P.handHr02, P.handHr01, (r) => (r > 2 && r < 178) || (r > 182 && r < 358), 7));
    }

    // date et heure digitales sous le cadran
    const tick = () => {
      const n = new Date();
      const heure = n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setTxt((t) => (t.heure === heure ? t : { date: n.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), heure }));
    };
    tick(); const i = setInterval(tick, 500);
    return () => { vivants.forEach((a) => a.kill()); gsap.killTweensOf(cibles); clearInterval(i); };
  }, []);

  return (
    <div className="ara" ref={root} title={txt.date}>
      {/* espace 300×300 d'origine ; le cadran et les pattes débordent → viewBox élargi, centré sur (150,150) */}
      <svg viewBox="-65 -65 430 430" overflow="visible">
        <defs>
          <path id="ara-cog1" d={P.cog1} /><path id="ara-cog2" d={P.cog2} /><path id="ara-cog5" d={P.cog5} />
          <filter id="ara-ombre" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="0" stdDeviation="1" floodColor="#ffffff" floodOpacity=".9" /></filter>
          <filter id="ara-ombre2" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="0" stdDeviation="1.25" floodColor="#ffffff" floodOpacity=".9" /></filter>
        </defs>

        {/* les six rouages de premier plan, transformations d'origine */}
        <g transform="matrix(0.97,0.02,-0.02,0.97,19.19,-6.07)"><use className="cog cw t24" fillOpacity="0.4" href="#ara-cog1" fill={ARDOISE} /></g>
        <use className="cog ccw t12" href="#ara-cog2" fillOpacity="0.4" fill={ARDOISE} />
        <g transform="matrix(0.93,0,0,0.93,9.460262,5.75)"><use className="cog cw t24" fillOpacity="0.4" href="#ara-cog1" fill={ARDOISE} transform="rotate(-51.810031,132.27636,-30.515465)" /></g>
        <g transform="rotate(-3.7621103,160.78969,349.2265)"><use className="cog cw t20" fillOpacity="0.4" href="#ara-cog5" fill={ARDOISE} /></g>
        <g transform="rotate(-2.7463672,162.45282,88.573956)"><use className="cog ccw t12" href="#ara-cog2" fillOpacity="0.5" fill={ARDOISE} transform="rotate(-117.25759,103.54258,173.50156)" /></g>
        <g transform="rotate(-10.176195,143.10035,73.854981)"><use className="cog ccw t12" href="#ara-cog2" fillOpacity="0.5" fill={ARDOISE} transform="rotate(-34.224386,-107.18833,39.101999)" /></g>

        <path id="ara-cadran" d={P.arabic} fill={ENCRE} fillOpacity=".55" filter="url(#ara-ombre)" />

        <g id="ara-spider" transform="matrix(3.7795276,0,0,3.7795276,0,0)" fill={ENCRE}>
          <path d={P.petites} filter="url(#ara-ombre)" />
          <g id="ara-hr"><circle fillOpacity="0" cx="39.75" cy="39.14" r="56.37" /><path id="ara-hand-hr" d={P.handHr01} filter="url(#ara-ombre)" /></g>
          <g id="ara-min"><circle fillOpacity="0" cx="39.75" cy="39.14" r="56.37" /><path id="ara-hand-min" d={P.handMin01} filter="url(#ara-ombre)" /></g>
          <g id="ara-sec"><circle fillOpacity="0" cx="39.75" cy="39.14" r="56.37" /><path id="ara-hand-sec" d={P.handSec01} filter="url(#ara-ombre)" /></g>
          <path d={P.corps} filter="url(#ara-ombre2)" />
          <path id="ara-face" d={P.face01} fill="#ffffff" filter="url(#ara-ombre2)" />
          <path d={P.cacheOmbre} />
        </g>
      </svg>
      <div className="ara-txt"><span>{txt.date}</span><b>{txt.heure}</b></div>
    </div>
  );
}
