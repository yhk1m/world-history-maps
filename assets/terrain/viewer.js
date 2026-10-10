// © 2026 김용현
// 3D 지형 뷰어 — 페이지(terrain.html)와 내보낸 HTML 이 같이 쓴다.
// payload = { title, grid:{w,h,bbox,data}, region(geom), overlay(prepareOverlay 결과|null), credits:[문자열], exag? }
// opts.inlineUI = false 면 화면 위 높이 과장·중심점 조절을 숨긴다(페이지가 사이드바에서 setExag·setCenterVisible 로 조절).
// 화면을 더블클릭하면 그 땅 위 지점이 회전 중심이 된다(e-GIS 와 같은 방식).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArrays, hypso } from 'whm/mesh';
import { tintGrid, sampler, drape } from 'whm/overlay';
import { contains, sizeKm } from 'whm/clip';

const CSS = `
.whm3d{position:relative;overflow:hidden;background:#f6f5f2;font-family:Pretendard,'Instrument Sans',system-ui,sans-serif;color:#111}
.whm3d canvas{display:block;width:100%;height:100%;touch-action:none}
.whm3d .v-title{position:absolute;left:16px;top:12px;font-size:15px;font-weight:600;letter-spacing:-.01em;pointer-events:none;max-width:70%}
.whm3d .v-ctl[hidden]{display:none}
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

function centerSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.lineWidth = 6; x.strokeStyle = 'rgba(255,255,255,.95)';
  x.beginPath(); x.arc(32, 32, 14, 0, Math.PI * 2); x.moveTo(32, 4); x.lineTo(32, 60); x.moveTo(4, 32); x.lineTo(60, 32); x.stroke();
  x.lineWidth = 2.5; x.strokeStyle = '#b3261e';
  x.beginPath(); x.arc(32, 32, 14, 0, Math.PI * 2); x.moveTo(32, 6); x.lineTo(32, 58); x.moveTo(6, 32); x.lineTo(58, 32); x.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.scale.set(0.045, 0.045, 1);
  sp.renderOrder = 20;
  return sp;
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

export const MAX_EXAG = 10;
export const clampExag = (v) => Math.min(MAX_EXAG, Math.max(1, Math.round(v * 2) / 2));

export function createViewer(el, payload, { inlineUI = true } = {}) {
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
  // 높이 과장은 실제 높이(1배)~10배. 처음 값은 구역 크기로 정하되 10배를 넘지 않는다
  let exag = clampExag(payload.exag || (0.03 * Math.hypot(kw, kh)) / relief);

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
    const tp = A.top.positions, ti = A.top.index;
    const sp = tp.slice();
    for (let k = 1; k < sp.length; k += 3) sp[k] = 0;
    // 해발 0 m 아래 꼭짓점이 있는 삼각형만, 해안 저지대와 겹치면 지형이 이기게(polygonOffset)
    const si = [];
    for (let t = 0; t < ti.length; t += 3) {
      if (tp[ti[t] * 3 + 1] < 0 || tp[ti[t + 1] * 3 + 1] < 0 || tp[ti[t + 2] * 3 + 1] < 0) si.push(ti[t], ti[t + 1], ti[t + 2]);
    }
    sea = new THREE.Mesh(geometry({ positions: sp, index: Uint32Array.from(si) }),
      new THREE.MeshLambertMaterial({ color: 0x4f7fa8, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    sea.renderOrder = 2;
    model.add(sea);
  }

  // 경로·지점: 높이 과장이 바뀌면 다시 놓는다(띄우는 높이는 과장과 무관하게)
  const sample = sampler(grid);
  const P = A.project;
  const lift = S * 0.004;
  const routes = new THREE.Group(), points = new THREE.Group(), outlines = new THREE.Group();
  scene.add(routes, points, outlines);
  // 선을 지형에 얹고 구역 안 구간(run)만 남긴다
  const runsOf = (coords) => {
    const pts = drape(coords, sample, Math.max(1, S / 300));
    const runs = []; let cur = [];
    for (const p of pts) {
      if (contains(region, p[0], p[1])) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs;
  };
  const draped = (overlay ? overlay.lines : []).map((l) => ({ runs: runsOf(l.coords), endIn: contains(region, ...l.coords[l.coords.length - 1]) }));
  // 영역 테두리(겹친 영역도 구분되게)
  const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
  const edges = (overlay ? overlay.areas : []).map((a) => ({ color: a.color, runs: rings(a.geom).flatMap(runsOf) }));
  const pins = (overlay ? overlay.points : []).filter((p) => contains(region, p.lon, p.lat));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const pinMat = new THREE.MeshBasicMaterial({ color: 0xb3261e });
  const y3 = (m) => (Math.max(m, 0) / 1000) * exag + lift;
  const toV = (run, up) => run.map(([lon, lat, m]) => { const [x, z] = P(lon, lat); return new THREE.Vector3(x, y3(m) - up, z); });
  const edgeMats = new Map();
  function placeOverlay() {
    routes.clear(); points.clear(); outlines.clear();
    for (const e of edges) {
      if (!edgeMats.has(e.color)) edgeMats.set(e.color, new THREE.LineBasicMaterial({ color: e.color }));
      for (const run of e.runs) if (run.length > 1) outlines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(toV(run, lift * 0.6)), edgeMats.get(e.color)));
    }
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
    <div class="v-ctl"${inlineUI || sea || hasAreas || hasLines || hasPts ? '' : ' hidden'}>
      ${inlineUI ? `<label>높이 과장 <input type="range" min="1" max="${MAX_EXAG}" step="0.5" value="${exag}" data-k="exag"> <b data-k="exagv">${exag}×</b></label>` : ''}
      <div class="v-row">
        ${inlineUI ? '<label title="화면을 더블클릭하면 그 자리가 회전 중심이 됩니다"><input type="checkbox" checked data-k="center">중심점</label>' : ''}
        ${sea ? '<label><input type="checkbox" checked data-k="sea">해수면</label>' : ''}
        ${hasAreas ? '<label><input type="checkbox" checked data-k="areas">영역</label>' : ''}
        ${hasLines ? '<label><input type="checkbox" checked data-k="routes">경로</label>' : ''}
        ${hasPts ? '<label><input type="checkbox" checked data-k="points">지점</label>' : ''}
      </div>
      ${hasAreas ? `<ul class="v-leg">${overlay.areas.map((a) => `<li><i style="background:${a.color}73;border-color:${a.color}"></i>${esc(a.name)}</li>`).join('')}</ul>` : ''}
    </div>
    <div class="v-cred">${(payload.credits || []).map(esc).join('<br>')}</div>`);
  const q = (k) => el.querySelector(`[data-k="${k}"]`);
  // 회전 중심점: 땅 위 고도(m)를 기억해 두었다가 높이 과장이 바뀌어도 땅에 붙어 있게
  const mark = centerSprite();
  scene.add(mark);
  let centerM = 0;
  const setExag = (v) => {
    exag = clampExag(v); model.scale.y = exag; placeOverlay();
    const dy = (centerM / 1000) * exag - controls.target.y;
    controls.target.y += dy; camera.position.y += dy;
    if (inlineUI) { q('exag').value = exag; q('exagv').textContent = exag + '×'; }
  };
  if (inlineUI) q('exag').addEventListener('input', (e) => setExag(+e.target.value));
  const setCenterVisible = (on) => { mark.visible = on; if (inlineUI) q('center').checked = on; };
  if (inlineUI) q('center').addEventListener('change', (e) => setCenterVisible(e.target.checked));

  // 더블클릭 = 그 땅 위 지점으로 회전 중심 옮기기(카메라는 같은 각도·거리로 따라감)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let anim = null;
  renderer.domElement.addEventListener('dblclick', (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(top, false)[0];
    if (!hit) return;
    centerM = (hit.point.y / exag) * 1000;
    const from = controls.target.clone(), to = hit.point.clone(), cam0 = camera.position.clone(), t0 = performance.now();
    anim = (now) => {
      const t = Math.min(1, (now - t0) / 450), e = 1 - (1 - t) ** 3;
      const tgt = from.clone().lerp(to, e);
      camera.position.copy(cam0).add(tgt.clone().sub(from));
      controls.target.copy(tgt);
      if (t >= 1) anim = null;
    };
  });
  if (sea) q('sea').addEventListener('change', (e) => { sea.visible = e.target.checked; });
  if (hasAreas) q('areas').addEventListener('change', (e) => {
    outlines.visible = e.target.checked;
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
    if (anim) anim(performance.now());
    controls.update();
    mark.position.copy(controls.target);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  return {
    scene, camera, model,
    get exag() { return exag; },
    setExag,
    setCenterVisible,
    get target() { return controls.target.clone(); },
    dispose() {
      alive = false; ro.disconnect(); controls.dispose(); renderer.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      el.innerHTML = '';
    },
  };
}
