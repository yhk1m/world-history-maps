// © 2026 김용현
// 3D 지형 뷰어 — 페이지(terrain.html)와 내보낸 HTML 이 같이 쓴다.
// payload = { title, grid:{w,h,bbox,data}, region(geom), overlay(prepareOverlay 결과|null), credits:[문자열], exag? }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArrays, hypso } from 'whm/mesh';
import { tintGrid, sampler, drape } from 'whm/overlay';
import { contains, sizeKm } from 'whm/clip';

const CSS = `
.whm3d{position:relative;overflow:hidden;background:#f6f5f2;font-family:Pretendard,'Instrument Sans',system-ui,sans-serif;color:#111}
.whm3d canvas{display:block;width:100%;height:100%;touch-action:none}
.whm3d .v-title{position:absolute;left:16px;top:12px;font-size:15px;font-weight:600;letter-spacing:-.01em;pointer-events:none;max-width:70%}
.whm3d .v-ctl{position:absolute;left:12px;bottom:12px;background:rgba(255,255,255,.92);border:1px solid #e6e6e6;padding:10px 12px;font-size:12px;line-height:1.6;max-width:min(300px,calc(100% - 24px))}
.whm3d .v-ctl label{display:flex;align-items:center;gap:6px;cursor:pointer}
.whm3d .v-ctl input[type=range]{width:120px}
.whm3d .v-row{display:flex;flex-wrap:wrap;gap:4px 12px}
.whm3d .v-leg{margin:6px 0 0;padding:0;list-style:none;max-height:110px;overflow:auto}
.whm3d .v-leg li{display:flex;align-items:center;gap:6px}
.whm3d .v-leg i{width:12px;height:9px;border:1px solid;flex:none}
.whm3d .v-cred{position:absolute;right:10px;bottom:6px;font-size:10px;color:#777;text-align:right;max-width:55%;pointer-events:none}
.whm3d .v-n{position:absolute;right:14px;top:12px;font:600 11px/1 'JetBrains Mono',monospace;color:#4a4a4a;pointer-events:none}
`;
function injectCSS(doc) {
  if (doc.getElementById('whm3d-css')) return;
  const s = doc.createElement('style');
  s.id = 'whm3d-css'; s.textContent = CSS;
  doc.head.appendChild(s);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function geometry({ positions, colors, index }) {
  const g = new THREE.BufferGeometry();
  const p = positions.slice();
  for (let k = 1; k < p.length; k += 3) p[k] /= 1000; // 고도 m → km(x·z 와 같은 단위)
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (colors) g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

function label(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 28px Pretendard, system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w; c.height = 44;
  ctx.font = font; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(text, 10, 23);
  ctx.fillStyle = '#111'; ctx.fillText(text, 10, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.center.set(0, -0.15);
  sp.scale.set(0.028 * (w / 44), 0.028, 1);
  sp.renderOrder = 10;
  return sp;
}

export function createViewer(el, payload) {
  injectCSS(el.ownerDocument);
  el.classList.add('whm3d');
  el.innerHTML = '';
  const { grid, region, overlay } = payload;

  const tg = overlay && overlay.areas.length ? tintGrid(overlay, grid) : null;
  const A = buildArrays(grid, region, { tintGrid: tg });
  const plain = new Float32Array(grid.w * grid.h * 3);
  for (let k = 0; k < grid.w * grid.h; k++) plain.set(hypso(grid.data[k]), k * 3);
  const tinted = A.top.colors.slice(); // 표면 색 속성은 이 배열을 그대로 쓰므로 복사본을 따로 둔다

  const { w: kw, h: kh } = sizeKm(grid.bbox);
  const S = Math.max(kw, kh);
  const relief = Math.max(0.2, (A.maxIn - A.minIn) / 1000);
  let exag = payload.exag || Math.min(50, Math.max(1, Math.round((0.03 * Math.hypot(kw, kh)) / relief * 2) / 2));

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f6f5f2');
  const camera = new THREE.PerspectiveCamera(40, 1, S / 2000, S * 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = S * 0.05;
  controls.maxDistance = S * 5;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-S, S * 1.3, -S * 0.7); // 북서쪽 위
  scene.add(sun);

  const model = new THREE.Group();
  model.scale.y = exag;
  scene.add(model);
  const topGeom = geometry(A.top);
  const top = new THREE.Mesh(topGeom, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const base = new THREE.Mesh(geometry(A.base), new THREE.MeshLambertMaterial({ color: 0x4a4540, side: THREE.DoubleSide }));
  const walls = new THREE.Mesh(geometry(A.walls), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
  model.add(top, base, walls);

  // 해수면: 구역 모양 그대로(표면과 같은 칸) y = 0 반투명
  let sea = null;
  if (A.minIn < 0) {
    const sp = A.top.positions.slice();
    for (let k = 1; k < sp.length; k += 3) sp[k] = 0;
    sea = new THREE.Mesh(geometry({ positions: sp, index: A.top.index }),
      new THREE.MeshLambertMaterial({ color: 0x4f7fa8, transparent: true, opacity: 0.3, depthWrite: false }));
    sea.renderOrder = 2;
    model.add(sea);
  }

  // 경로·지점: 높이 과장이 바뀌면 다시 놓는다(띄우는 높이는 과장과 무관하게)
  const sample = sampler(grid);
  const P = A.project;
  const lift = S * 0.004;
  const routes = new THREE.Group(), points = new THREE.Group();
  scene.add(routes, points);
  const draped = (overlay ? overlay.lines : []).map((l) => {
    const pts = drape(l.coords, sample, Math.max(1, S / 300));
    const runs = []; let cur = [];
    for (const p of pts) {
      if (contains(region, p[0], p[1])) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return { runs, endIn: contains(region, ...l.coords[l.coords.length - 1]) };
  });
  const pins = (overlay ? overlay.points : []).filter((p) => contains(region, p.lon, p.lat));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xb3261e });
  const y3 = (m) => (Math.max(m, 0) / 1000) * exag + lift;
  function placeOverlay() {
    routes.clear(); points.clear();
    for (const d of draped) {
      d.runs.forEach((run, ri) => {
        if (run.length < 2) return;
        const v = run.map(([lon, lat, m]) => { const [x, z] = P(lon, lat); return new THREE.Vector3(x, y3(m), z); });
        routes.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), lineMat));
        if (d.endIn && ri === d.runs.length - 1) {
          const a = v[v.length - 2], b = v[v.length - 1];
          const cone = new THREE.Mesh(new THREE.ConeGeometry(S * 0.006, S * 0.018, 12), coneMat);
          cone.position.copy(b);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          routes.add(cone);
        }
      });
    }
    for (const p of pins) {
      const [x, z] = P(p.lon, p.lat);
      const y = y3(sample(p.lon, p.lat));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(S * 0.004, 12, 8), pinMat);
      dot.position.set(x, y, z);
      const lb = label(p.name);
      lb.position.set(x, y, z);
      points.add(dot, lb);
    }
  }
  placeOverlay();

  // UI
  const hasAreas = !!(overlay && overlay.areas.length), hasLines = draped.some((d) => d.runs.length), hasPts = pins.length > 0;
  el.insertAdjacentHTML('beforeend', `
    <div class="v-title">${esc(payload.title || '')}</div>
    <div class="v-n">N ↑</div>
    <div class="v-ctl">
      <label>높이 과장 <input type="range" min="1" max="50" step="0.5" value="${exag}" data-k="exag"> <b data-k="exagv">${exag}×</b></label>
      <div class="v-row">
        ${sea ? '<label><input type="checkbox" checked data-k="sea">해수면</label>' : ''}
        ${hasAreas ? '<label><input type="checkbox" checked data-k="areas">영역</label>' : ''}
        ${hasLines ? '<label><input type="checkbox" checked data-k="routes">경로</label>' : ''}
        ${hasPts ? '<label><input type="checkbox" checked data-k="points">지점</label>' : ''}
      </div>
      ${hasAreas ? `<ul class="v-leg">${overlay.areas.map((a) => `<li><i style="background:${a.color}73;border-color:${a.color}"></i>${esc(a.name)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="v-cred">${(payload.credits || []).map(esc).join('<br>')}</div>`);
  const q = (k) => el.querySelector(`[data-k="${k}"]`);
  q('exag').addEventListener('input', (e) => {
    exag = +e.target.value; model.scale.y = exag; q('exagv').textContent = exag + '×'; placeOverlay();
  });
  if (sea) q('sea').addEventListener('change', (e) => { sea.visible = e.target.checked; });
  if (hasAreas) q('areas').addEventListener('change', (e) => {
    topGeom.getAttribute('color').copyArray(e.target.checked ? tinted : plain);
    topGeom.getAttribute('color').needsUpdate = true;
  });
  if (hasLines) q('routes').addEventListener('change', (e) => { routes.visible = e.target.checked; });
  if (hasPts) q('points').addEventListener('change', (e) => { points.visible = e.target.checked; });

  // 모형 전체가 화면에 들어오게: 위에서 비스듬히(약 45°) 본 거리
  let fitted = false;
  const fit = () => {
    const vf = (camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    const dist = Math.max((kh * 0.5) / Math.tan(vf) * 1.25, (kw * 0.5) / Math.tan(hf) * 1.15);
    camera.position.set(0, dist * 0.72, dist * 0.69);
    controls.target.set(0, 0, 0);
    controls.update();
  };
  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!fitted && el.clientWidth) { fit(); fitted = true; }
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  let alive = true;
  (function loop() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  return {
    get exag() { return exag; },
    dispose() {
      alive = false; ro.disconnect(); controls.dispose(); renderer.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      el.innerHTML = '';
    },
  };
}
