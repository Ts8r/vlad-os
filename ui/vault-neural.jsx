/**
 * VLAD OS — Vault « cerveau » : un neurone par département + noyau VLAD central.
 * Déploiement « PLANTE » : les branches poussent depuis le soma vers l'extérieur (front
 * de croissance, sous-branches après la branche mère) + légère ondulation organique.
 * Soma/noyau présents d'emblée. Clic sur un neurone → panneau des dossiers (+ commande /).
 */
import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const BRIDGE = "http://localhost:8788";
const DEPT_COLOR = {
  "Projets": 0xff2db5, "Notes": 0x9b3ce0, "MCP": 0x18e0c8, "Agents": 0xff7ac0,
  "design": 0x00bfff, "dev-visuel": 0x3b6bff, "media-ia": 0xff8c00, "documents": 0xb06bff,
  "infra": 0x32cd32, "business": 0xff1493, "dev-flow": 0x00e5ff, "divers": 0x9aa7ff, "Skills": 0x00bfff,
};
const deptLabel = { "design": "SKILLS · DESIGN", "dev-visuel": "SKILLS · DEV VISUEL", "media-ia": "SKILLS · MÉDIA IA", "documents": "SKILLS · DOCUMENTS", "infra": "SKILLS · INFRA", "business": "SKILLS · BUSINESS", "dev-flow": "SKILLS · DEV FLOW", "divers": "SKILLS · DIVERS" };
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// shader des branches : révélation progressive (front uGrow) + ondulation (sway)
function branchMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uGrow: { value: 0 }, uTime: { value: 0 }, uMax: { value: 1 } },
    vertexShader: `attribute float aU; uniform float uGrow, uTime, uMax; varying float vShown;
      void main(){ vShown = uGrow - aU; float s = aU / max(1.0, uMax); float amp = 1.1 * s;
        vec3 p = position; p.x += sin(uTime * 0.7 + aU * 0.10) * amp; p.z += cos(uTime * 0.6 + aU * 0.10) * amp;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying float vShown; void main(){ if (vShown < 0.0) discard; gl_FragColor = vec4(uColor, 0.9); }`,
  });
}

export default function VaultNeural({ onClose }) {
  const mountRef = useRef(null), labelRef = useRef(null), tagsRef = useRef(null);
  const [counts, setCounts] = useState(null);
  const [sel, setSel] = useState(null);
  const [deptData, setDeptData] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); try { await fetch(BRIDGE + "/vault?refresh=1"); } catch {} setSel(null); setReloadKey((k) => k + 1); setRefreshing(false); };

  useEffect(() => {
    const mount = mountRef.current;
    let raf, composer, controls, renderer, disposed = false;

    (async () => {
      let data; try { data = await (await fetch(BRIDGE + "/vault")).json(); } catch { data = { nodes: [], edges: [] }; }
      if (disposed) return;
      setCounts(data.counts || null);
      const nodes = data.nodes || [];
      const deptOf = (n) => n.kind === "project" ? "Projets" : n.kind === "memory" ? "Notes" : n.kind === "mcp" ? "MCP" : n.kind === "agent" ? "Agents" : n.kind === "skill" ? (n.cat || "divers") : null;
      const depts = {};
      nodes.forEach((n, i) => { const d = deptOf(n); if (!d) return; (depts[d] ||= []).push(i); });
      const names = Object.keys(depts), D = names.length;

      const dd = {};
      names.forEach((name) => { dd[name] = { label: deptLabel[name] || name.toUpperCase(), color: "#" + (DEPT_COLOR[name] ?? 0x9aa7ff).toString(16).padStart(6, "0"), members: depts[name].map((i) => ({ label: nodes[i].label, info: nodes[i].info || "", kind: nodes[i].kind, cmd: nodes[i].cmd })) }; });
      dd["VLAD"] = { label: "VLAD · NOYAU", color: "#eaf2ff", members: names.map((name) => ({ label: deptLabel[name] || name.toUpperCase(), info: depts[name].length + " éléments" })) };
      setDeptData(dd);

      const w = mount.clientWidth, h = mount.clientHeight;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, w / h, 0.1, 4000);
      camera.position.set(0, 0, 170);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.toneMapping = THREE.ReinhardToneMapping;
      mount.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.05; controls.minDistance = 15; controls.maxDistance = 800;
      controls.autoRotate = true; controls.autoRotateSpeed = 0.25;
      scene.add(new THREE.AmbientLight(0x404040, 0.8));

      function irregularSphere(radius, seg, irr) {
        const g = new THREE.SphereGeometry(radius, seg, seg), p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), dir = new THREE.Vector3(x, y, z).normalize(); const n = Math.sin(x*3+y*2)*0.3 + Math.cos(y*4+z*3)*0.2 + Math.sin(z*5+x*4)*0.15 + Math.random()*0.35; dir.multiplyScalar(radius * (1 + n * irr)); p.setXYZ(i, dir.x, dir.y, dir.z); }
        g.computeVertexNormals(); return g;
      }
      // branche récursive : tube + attribut aU (longueur cumulée depuis le soma) ; sous-branches décalées
      function branch(start, dir, length, level, geos, ends, startDist) {
        if (level <= 0) return;
        const seg = 8, pts = [start.clone()]; let cur = start.clone();
        for (let i = 1; i <= seg; i++) { cur.add(dir.clone().multiplyScalar(length/seg)).add(new THREE.Vector3((Math.random()-0.5)*length/seg*0.5,(Math.random()-0.5)*length/seg*0.5,(Math.random()-0.5)*length/seg*0.5)); pts.push(cur.clone()); }
        const path = new THREE.CatmullRomCurve3(pts);
        const baseR = 0.16 * (level/3) * (1 + Math.random()*0.2);
        const tube = new THREE.TubeGeometry(path, 18, baseR, 6, false);
        const pa = tube.attributes.position, au = new Float32Array(pa.count);
        for (let i = 0; i < pa.count; i++) { const ring = Math.floor(i / 7), u = ring / 18; const cp = path.getPointAt(Math.min(u, 1)); const d = new THREE.Vector3(pa.getX(i),pa.getY(i),pa.getZ(i)).sub(cp); d.setLength(baseR * (1 - Math.pow(u,1.5)*0.85)).add(cp); pa.setXYZ(i, d.x, d.y, d.z); au[i] = startDist + u * length; }
        tube.setAttribute("aU", new THREE.BufferAttribute(au, 1)); tube.computeVertexNormals(); geos.push(tube);
        if (ends) ends.push({ pos: cur.clone(), u: startDist + length });
        const subs = level > 1 ? (1 + (Math.random()*2|0)) : 0;
        for (let i = 0; i < subs; i++) { const bi = 2 + (Math.random()*(seg-3)|0); const ns = pts[bi]; const nd = new THREE.Vector3().subVectors(pts[bi+1], ns).normalize().add(new THREE.Vector3((Math.random()-0.5)*1.3,(Math.random()-0.5)*1.3,(Math.random()-0.5)*1.3)).normalize(); branch(ns, nd, length*(0.45+Math.random()*0.3), level-1, geos, null, startDist + (bi/seg)*length); }
      }

      const cv = document.createElement("canvas"); cv.width = cv.height = 64; const cx = cv.getContext("2d");
      const gr = cx.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,"rgba(255,255,255,1)"); gr.addColorStop(0.4,"rgba(255,255,255,0.6)"); gr.addColorStop(1,"rgba(255,255,255,0)");
      cx.fillStyle = gr; cx.beginPath(); cx.arc(32,32,32,0,Math.PI*2); cx.fill(); const sprite = new THREE.CanvasTexture(cv);

      const R = 98, gold = Math.PI * (3 - Math.sqrt(5));
      const neurons = [], tips = [], pulses = [];
      names.forEach((name, k) => {
        const yy = 1 - (k / Math.max(1, D - 1)) * 2, rr = Math.sqrt(1 - yy*yy), th = gold * k;
        const center = new THREE.Vector3(Math.cos(th)*rr, yy*0.6, Math.sin(th)*rr).multiplyScalar(R * (0.78 + Math.random() * 0.5));
        const color = DEPT_COLOR[name] ?? 0x9aa7ff;
        const group = new THREE.Group(); group.position.copy(center); scene.add(group);
        const soma = new THREE.Mesh(irregularSphere(2.6, 26, 0.1), new THREE.MeshStandardMaterial({ color, emissive: color, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.78 })); soma.scale.setScalar(0); group.add(soma);
        const core = new THREE.Mesh(irregularSphere(0.9, 18, 0.15), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, transparent: true, opacity: 0.95 })); core.scale.setScalar(0); group.add(core);
        const geos = [], ends = [];
        depts[name].forEach((ni, j) => { const y2 = 1 - (j / Math.max(1, depts[name].length - 1)) * 2, r2 = Math.sqrt(1 - y2*y2), t2 = gold * j; const dir = new THREE.Vector3(Math.cos(t2)*r2, y2, Math.sin(t2)*r2).normalize().add(new THREE.Vector3((Math.random()-0.5)*0.5,(Math.random()-0.5)*0.5,(Math.random()-0.5)*0.5)).normalize(); branch(dir.clone().multiplyScalar(2.6), dir, 22 + Math.random()*24, 3, geos, ends, 2.6); });
        const mat = branchMaterial(color); let maxU = 1;
        if (geos.length) { const merged = mergeGeometries(geos); maxU = Math.max(...ends.map((e) => e.u), 10); mat.uniforms.uMax.value = maxU; group.add(new THREE.Mesh(merged, mat)); }
        const idxN = neurons.length;
        ends.forEach((e, j) => tips.push({ dept: idxN, local: e.pos, endU: e.u, base: 1.5 + (nodes[depts[name][j]]?.kind === "project" ? 1.2 : 0), ni: depts[name][j], color }));
        neurons.push({ group, center, name, color, soma, core, mat, maxU, delay: 0.5 + k * 0.55, gr: 0, uGrow: 0 });
      });

      // ── NOYAU VLAD : présent d'emblée ; axones qui poussent vers les départements ──
      {
        const cg = new THREE.Group(); scene.add(cg);
        const soma = new THREE.Mesh(irregularSphere(5.6, 34, 0.12), new THREE.MeshStandardMaterial({ color: 0xeaf2ff, emissive: 0xcfe3ff, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 })); soma.scale.setScalar(0); cg.add(soma);
        const coreMesh = new THREE.Mesh(irregularSphere(2.5, 24, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, transparent: true, opacity: 0.98 })); coreMesh.scale.setScalar(0); cg.add(coreMesh);
        const coreIdx = neurons.length, ageos = []; let amax = 1;
        neurons.forEach((n) => {
          const c = n.center, mid = c.clone().multiplyScalar(0.5).add(new THREE.Vector3((Math.random()-0.5)*22,(Math.random()-0.5)*22,(Math.random()-0.5)*22));
          // l'axone va du noyau JUSQU'À la surface du soma du département (le touche)
          const path = new THREE.CatmullRomCurve3([c.clone().setLength(5.6), mid, c.clone().setLength(Math.max(6, c.length() - 2.4))]);
          const len = c.length(); n.axonLen = len; n.delay = 0;   // déclencheur = quand le front d'axone atteint ce département
          const tube = new THREE.TubeGeometry(path, 26, 0.5, 8, false);
          const pa = tube.attributes.position, au = new Float32Array(pa.count);
          for (let i = 0; i < pa.count; i++) { const u = Math.floor(i / 9) / 26; au[i] = u * len; } amax = Math.max(amax, len);
          tube.setAttribute("aU", new THREE.BufferAttribute(au, 1)); ageos.push(tube);
          pulses.push({ dept: coreIdx, path, len, t: Math.random(), s: 0.05 + Math.random()*0.05 });
        });
        const amat = branchMaterial(0xdfeeff); amat.uniforms.uMax.value = amax;
        if (ageos.length) cg.add(new THREE.Mesh(mergeGeometries(ageos), amat));
        neurons.push({ group: cg, center: new THREE.Vector3(0,0,0), name: "VLAD", color: 0xffffff, soma, core: coreMesh, mat: amat, maxU: amax, delay: 0, gr: 0, uGrow: 0, isCore: true });
      }

      tips.forEach((t) => { t.mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: new THREE.Color(t.color).lerp(new THREE.Color(0xffffff), 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); t.mesh.scale.setScalar(0); scene.add(t.mesh); });
      pulses.forEach((p) => { p.mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); p.mesh.scale.setScalar(0); scene.add(p.mesh); });

      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.3, 0.6, 0.1));

      const tags = tagsRef.current; tags.innerHTML = "";
      const tagEls = neurons.map((nrn) => { const el = document.createElement("div"); el.className = "vault-tag" + (nrn.isCore ? " core" : ""); el.textContent = deptLabel[nrn.name] || nrn.name.toUpperCase(); el.style.color = nrn.isCore ? "#ffffff" : "#" + nrn.color.toString(16).padStart(6, "0"); tags.appendChild(el); return el; });

      let hover = -1, mx = -1e3, my = -1e3;
      const onMove = (ev) => { const r = renderer.domElement.getBoundingClientRect(); mx = ev.clientX - r.left; my = ev.clientY - r.top; };
      renderer.domElement.addEventListener("mousemove", onMove);
      const v = new THREE.Vector3(), tw = new THREE.Vector3();
      const worldTip = (t) => tw.copy(t.local).add(neurons[t.dept].center);
      const pick = () => { let bi = -1, bd = 20*20; for (let i = 0; i < tips.length; i++) { v.copy(worldTip(tips[i])).project(camera); if (v.z>1) continue; const sxp=(v.x*0.5+0.5)*w, syp=(-v.y*0.5+0.5)*h; const dd2=(sxp-mx)**2+(syp-my)**2; if (dd2<bd){bd=dd2;bi=i;} } return bi; };

      let downX = 0, downY = 0;
      const onDown = (e) => { downX = e.clientX; downY = e.clientY; };
      const onUp = (e) => { if (Math.hypot(e.clientX-downX, e.clientY-downY) > 6) return; const r = renderer.domElement.getBoundingClientRect(), cxp = e.clientX-r.left, cyp = e.clientY-r.top; let best = -1, bd = 85*85; for (let i = 0; i < neurons.length; i++) { v.copy(neurons[i].center).project(camera); if (v.z>1) continue; const sxp=(v.x*0.5+0.5)*w, syp=(-v.y*0.5+0.5)*h; const d=(sxp-cxp)**2+(syp-cyp)**2; if (d<bd){bd=d;best=i;} } if (best>=0) setSel(neurons[best].isCore ? "VLAD" : neurons[best].name); };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);

      const clock = new THREE.Clock(); let T = 0;
      function animate() {
        raf = requestAnimationFrame(animate);
        const dt = Math.min(0.05, clock.getDelta()); T += dt;
        const vlad = neurons[neurons.length - 1];                      // le noyau (poussé en dernier)
        neurons.forEach((n) => {
          let appear;
          if (n.isCore) { appear = ease(clamp01(T / 0.6)); n.gr += dt * (n.maxU / 4.5); }   // noyau d'emblée, axones poussent
          else { if (vlad.uGrow >= n.axonLen) n.gr += dt * (n.maxU / 4.5); appear = ease(clamp01(n.gr / 2.5)); } // dept pousse SEULEMENT quand l'axone l'atteint
          n._appear = appear;
          n.uGrow = Math.min(n.maxU, n.gr);
          n.soma.scale.setScalar(appear);
          n.core.scale.setScalar(appear * (n.isCore ? (1 + 0.14 * Math.sin(T * 2.1)) : 1));
          n.mat.uniforms.uGrow.value = n.uGrow; n.mat.uniforms.uTime.value = T;
        });
        hover = pick();
        tips.forEach((t, i) => { const ug = neurons[t.dept].uGrow; const rev = clamp01((ug - (t.endU - 3)) / 3); t.mesh.position.copy(worldTip(t)); t.mesh.scale.setScalar(t.base * rev * (i === hover ? 2.6 : 1)); });
        for (const p of pulses) { const n = neurons[p.dept]; const reveal = n.uGrow / (p.len || 1); if (reveal < 0.06) { p.mesh.scale.setScalar(0); continue; } const maxT = Math.min(1, reveal); p.t += dt * p.s * 8; if (p.t > maxT) p.t = 0; p.mesh.position.copy(p.path.getPointAt(p.t)).add(n.center); p.mesh.scale.setScalar(2 * ease(clamp01(reveal))); }
        for (let i = 0; i < neurons.length; i++) { v.copy(neurons[i].center).project(camera); const el = tagEls[i]; const a = neurons[i]._appear || 0; if (v.z < 1) { el.style.display = "block"; el.style.left = ((v.x*0.5+0.5)*w)+"px"; el.style.top = ((-v.y*0.5+0.5)*h - 18)+"px"; el.style.opacity = String(0.9 * a); } else el.style.display = "none"; }
        const lab = labelRef.current;
        if (hover >= 0 && lab) { v.copy(worldTip(tips[hover])).project(camera); lab.style.display="block"; lab.style.left=((v.x*0.5+0.5)*w)+"px"; lab.style.top=((-v.y*0.5+0.5)*h-20)+"px"; lab.textContent=nodes[tips[hover].ni]?.label || ""; }
        else if (lab) lab.style.display = "none";
        controls.update(); composer.render();
      }
      animate();

      const onResize = () => { const W = mount.clientWidth, H = mount.clientHeight; camera.aspect = W/H; camera.updateProjectionMatrix(); renderer.setSize(W,H); composer.setSize(W,H); };
      window.addEventListener("resize", onResize);
      const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
      window.addEventListener("keydown", onKey);
      mount.__cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); renderer.domElement.removeEventListener("mousemove", onMove); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp); renderer.dispose(); try { mount.removeChild(renderer.domElement); } catch {}; try { tags.innerHTML = ""; } catch {} };
    })();

    return () => { disposed = true; if (mount.__cleanup) mount.__cleanup(); };
  }, [reloadKey]);

  return (
    <div className="vault-overlay">
      <div ref={mountRef} className="vault-canvas" />
      <div ref={tagsRef} className="vault-tags" />
      <div ref={labelRef} className="vault-label" />
      <div className="vault-head">
        <span className="vault-title">VAULT · CERVEAU CLAUDE CODE</span>
        {counts && <span className="vault-counts">{counts.projects} projets · {counts.skills} skills · {counts.notes} notes · {counts.mcp} MCP · {counts.agents} agents</span>}
      </div>
      <button className="vault-refresh" onClick={refresh} title="Actualiser (re-scanne projets, skills, notes, agents)">{refreshing ? "…" : "↻"}</button>
      <button className="vault-close" onClick={onClose} title="Fermer (Échap)">✕</button>
      {sel && deptData[sel] && (
        <div className="vault-panel">
          <div className="vault-panel-head" style={{ color: deptData[sel].color }}>
            <span>{deptData[sel].label}</span><span className="vault-panel-n">{deptData[sel].members.length}</span>
            <button onClick={() => setSel(null)} title="Fermer">✕</button>
          </div>
          <div className="vault-panel-list">
            {deptData[sel].members.map((m, i) => (
              <div className="vault-item" key={i}>
                <b>{m.cmd ? <code className="vault-cmd">{m.cmd}</code> : m.label}</b>
                {m.info && <span>{m.info}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
