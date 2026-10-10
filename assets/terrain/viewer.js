// © 2026 김용현
// 3D 지형 뷰어 — 페이지(terrain.html)와 내보낸 HTML 이 같이 쓴다.
// payload = { title, grid:{w,h,bbox,data}, region(geom), overlay(prepareOverlay 결과|null), credits:[문자열],
//             exag?, seaLevel?, view?(getView 결과) }
// opts.inlineUI = false 면 화면 위 높이 과장·해수면·중심점 조절을 숨긴다(페이지가 사이드바에서 set○○ 로 조절).
// 화면을 더블클릭하면 그 땅 위 지점이 회전 중심이 된다(e-GIS 와 같은 방식).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildArrays, hypso, flatArrow } from 'whm/mesh';
import { tintGrid, sampler, drape } from 'whm/overlay';
import { contains, sizeKm } from 'whm/clip';

// 화면 위 조절판은 SEED Design(당근, 중립색) 토큰 값을 그대로 담는다 — 내보낸 HTML 에는 SEED CSS 가 없으므로
// 페이지(SEED 변수 있음)와 파일(없음)이 똑같이 보이도록 값으로 적는다: 회색 900 #2a3038, 1000 #1a1c20, 400 #dcdee3
const CSS = `
.whm3d{position:relative;overflow:hidden;background:#f6f5f2;font-family:Pretendard,'Instrument Sans',system-ui,sans-serif;color:#1a1c20}
.whm3d canvas{display:block;width:100%;height:100%;touch-action:none}
.whm3d .v-title{position:absolute;left:16px;top:12px;font-size:15px;font-weight:700;letter-spacing:-.01em;pointer-events:none;max-width:70%}
.whm3d .v-ctl[hidden]{display:none}
.whm3d .v-ctl{position:absolute;left:12px;bottom:12px;background:#fff;border-radius:12px;box-shadow:0 2px 10px #0000001a;padding:12px 14px;font-size:13px;line-height:1.5;max-width:min(320px,calc(100% - 24px))}
.whm3d .v-ctl label{display:flex;align-items:center;gap:8px;cursor:pointer;min-height:28px}
.whm3d .v-ctl input[type=range]{width:110px;accent-color:#2a3038}
.whm3d .v-ctl input[type=number]{width:58px;height:28px;box-sizing:border-box;font:inherit;padding:0 8px;border:1px solid #dcdee3;border-radius:8px;background:#fff;color:#1a1c20}
.whm3d .v-ctl input[type=number]:focus-visible{outline:2px solid #5e98fe;outline-offset:1px}
.whm3d .v-ctl input[type=checkbox]{-webkit-appearance:none;appearance:none;flex:none;width:20px;height:20px;margin:0;border:1px solid #dcdee3;border-radius:4px;background:#fff;cursor:pointer;transition:background-color .15s}
.whm3d .v-ctl input[type=checkbox]:hover{background:#f3f4f5}
.whm3d .v-ctl input[type=checkbox]:checked{border-width:0;background:#2a3038 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 10.5l3.2 3.2L15 7'/%3E%3C/svg%3E") center/100% 100% no-repeat}
.whm3d .v-ctl input[type=checkbox]:focus-visible{outline:2px solid #5e98fe;outline-offset:2px}
.whm3d .v-ctl input[type=checkbox]:active{scale:.95}
.whm3d .v-row{display:flex;flex-wrap:wrap;gap:2px 14px}
.whm3d .v-leg{margin:8px 0 0;padding:8px 0 0;border-top:1px solid #f3f4f5;list-style:none;max-height:110px;overflow:auto;color:#555d6d}
.whm3d .v-leg li{display:flex;align-items:center;gap:8px;min-height:22px}
.whm3d .v-leg i{width:14px;height:10px;border:1px solid;border-radius:2px;flex:none}
.whm3d .v-cred{position:absolute;right:10px;bottom:6px;font-size:10px;color:#555d6d;text-align:right;max-width:55%;pointer-events:none}
.whm3d .v-n{position:absolute;right:12px;top:10px;width:44px;height:44px;padding:0;border-radius:50%;border:0;background:#fff;box-shadow:0 1px 4px #00000014,0 0 0 1px #00000010;cursor:pointer;transition:scale .1s}
.whm3d .v-n:hover{box-shadow:0 2px 10px #0000001a,0 0 0 1px #dcdee3}
.whm3d .v-n:active{scale:.95}
.whm3d .v-n:focus-visible{outline:2px solid #5e98fe;outline-offset:2px}
.whm3d .v-n svg{display:block;width:100%;height:100%}
`;
function injectCSS(doc) {
  if (doc.getElementById('whm3d-css')) return;
  const s = doc.createElement('style');
  s.id = 'whm3d-css'; s.textContent = CSS;
  doc.head.appendChild(s);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255);

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

function label(text, color = '#111') {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 28px Pretendard, system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w; c.height = 44;
  ctx.font = font; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(text, 10, 23);
  ctx.fillStyle = color; ctx.fillText(text, 10, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.center.set(0, -0.15);
  sp.scale.set(0.028 * (w / 44), 0.028, 1);
  sp.renderOrder = 10;
  return sp;
}

export const MAX_EXAG = 20;
// 슬라이더는 0.5배씩, 숫자 칸은 0.1배까지 받는다
export const clampExag = (v) => (Number.isFinite(+v) ? Math.min(MAX_EXAG, Math.max(1, Math.round(v * 10) / 10)) : 1);
export const SEA_MIN = -150, SEA_MAX = 150; // 해수면 조절 범위(m) — 빙하기 해수면(약 -120 m)까지

export function createViewer(el, payload, { inlineUI = true } = {}) {
  injectCSS(el.ownerDocument);
  el.classList.add('whm3d');
  el.innerHTML = '';
  const { grid, region } = payload;
  let overlay = payload.overlay || null;

  const A = buildArrays(grid, region);
  const n = grid.w * grid.h;
  const plain = A.top.colors.slice(); // 영역색 없는 고도색
  let tinted = plain;

  const { w: kw, h: kh } = sizeKm(grid.bbox);
  const S = Math.max(kw, kh);
  const relief = Math.max(0.2, (A.maxIn - A.minIn) / 1000);
  // 높이 과장은 실제 높이(1배)~20배. 처음 값은 구역 크기로 정하되 10배를 넘지 않는다
  let exag = clampExag(payload.exag || Math.min(10, Math.round((0.03 * Math.hypot(kw, kh)) / relief * 2) / 2));
  let seaLevel = Math.max(SEA_MIN, Math.min(SEA_MAX, payload.seaLevel || 0));

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

  // 해수면: 구역 모양 그대로, 해수면보다 낮은 꼭짓점이 있는 삼각형만. 해안 저지대와 겹치면 지형이 이기게(polygonOffset)
  const hasSea = A.minIn < SEA_MAX;
  let sea = null, seaOn = A.minIn < 0;
  if (hasSea) {
    const sp = A.top.positions.slice();
    sea = new THREE.Mesh(geometry({ positions: sp, index: new Uint32Array(3) }),
      new THREE.MeshLambertMaterial({ color: 0x4f7fa8, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
    sea.renderOrder = 2;
    model.add(sea);
  }
  function placeSea() {
    if (!sea) return;
    const tp = A.top.positions, ti = A.top.index, pos = sea.geometry.getAttribute('position');
    for (let k = 0; k < pos.count; k++) pos.setY(k, seaLevel / 1000);
    pos.needsUpdate = true;
    const si = [];
    for (let t = 0; t < ti.length; t += 3) {
      if (tp[ti[t] * 3 + 1] < seaLevel || tp[ti[t + 1] * 3 + 1] < seaLevel || tp[ti[t + 2] * 3 + 1] < seaLevel) si.push(ti[t], ti[t + 1], ti[t + 2]);
    }
    sea.geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(si.length ? si : [0, 0, 0]), 1));
    sea.visible = seaOn && si.length > 0;
  }
  placeSea();

  // 경로·지점·영역 테두리·단면선: 높이 과장이 바뀌면 다시 놓는다(띄우는 높이는 과장과 무관하게)
  const sample = sampler(grid);
  const P = A.project;
  const lift = S * 0.004;
  const routes = new THREE.Group(), points = new THREE.Group(), outlines = new THREE.Group(), profileG = new THREE.Group();
  scene.add(routes, points, outlines, profileG);
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
  const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
  let draped = [], edges = [], pins = [], profile = null;
  const mats = new Map();
  const lineMat = (c) => { if (!mats.has('l' + c)) mats.set('l' + c, new THREE.LineBasicMaterial({ color: c })); return mats.get('l' + c); };
  const meshMat = (c) => { if (!mats.has('m' + c)) mats.set('m' + c, new THREE.MeshBasicMaterial({ color: c })); return mats.get('m' + c); };
  // 평평한 화살표용: 양면, 지형과 겹쳐도 화살표가 이기게
  const flatMat = (c) => {
    if (!mats.has('f' + c)) mats.set('f' + c, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    return mats.get('f' + c);
  };
  const ARROW_W = S * 0.007; // 화살표 몸통 폭(모형 크기의 0.7%)
  const ground = (m) => Math.max(m, sea && sea.visible ? seaLevel : 0);
  const y3 = (m) => (ground(m) / 1000) * exag + lift;
  const toV = (run, up = 0) => run.map(([lon, lat, m]) => { const [x, z] = P(lon, lat); return new THREE.Vector3(x, y3(m) - up, z); });

  function prepare() {
    draped = (overlay ? overlay.lines : []).map((l) => ({ runs: runsOf(l.coords), color: l.color || '#111111', arrow: l.arrow !== false, endIn: contains(region, ...l.coords[l.coords.length - 1]) }));
    edges = (overlay ? overlay.areas : []).map((a) => ({ color: a.color, runs: rings(a.geom).flatMap(runsOf) }));
    pins = (overlay ? overlay.points : []).filter((p) => contains(region, p.lon, p.lat));
    // 영역색: 고도색에 섞기
    if (overlay && overlay.areas.length) {
      const tg = tintGrid(overlay, grid);
      tinted = plain.slice();
      for (let k = 0; k < n; k++) {
        const a = tg[k * 4 + 3];
        if (a > 0) for (let q = 0; q < 3; q++) tinted[k * 3 + q] = plain[k * 3 + q] * (1 - a) + tg[k * 4 + q] * a;
      }
    } else tinted = plain;
  }
  let areasOn = true;
  const paintAreas = () => {
    topGeom.getAttribute('color').copyArray(areasOn ? tinted : plain);
    topGeom.getAttribute('color').needsUpdate = true;
    outlines.visible = areasOn;
  };
  function placeOverlay() {
    routes.clear(); points.clear(); outlines.clear(); profileG.clear();
    for (const e of edges) for (const run of e.runs) if (run.length > 1) outlines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(toV(run, lift * 0.6)), lineMat(e.color)));
    for (const d of draped) {
      d.runs.forEach((run, ri) => {
        if (run.length < 2) return;
        // 지형 위에 납작하게 깔린 띠 + 끝의 삼각형 머리(구역 안에서 끝나는 마지막 구간만)
        const v = toV(run).map((p) => [p.x, p.y, p.z]);
        const f = flatArrow(v, ARROW_W, d.arrow && d.endIn && ri === d.runs.length - 1);
        if (!f.index.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(f.positions, 3));
        g.setIndex(new THREE.BufferAttribute(f.index, 1));
        routes.add(new THREE.Mesh(g, flatMat(d.color)));
      });
    }
    for (const p of pins) {
      const [x, z] = P(p.lon, p.lat);
      const y = y3(sample(p.lon, p.lat));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(S * 0.004, 12, 8), meshMat(p.color || '#b3261e'));
      dot.position.set(x, y, z);
      const lb = label(p.name, p.color || '#111');
      lb.position.set(x, y, z);
      points.add(dot, lb);
    }
    if (profile) {
      for (const run of profile.runs) if (run.length > 1) profileG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(toV(run, -lift * 0.5)), lineMat('#e0007a')));
      profile.ends.forEach(([lon, lat], i) => {
        if (!contains(region, lon, lat)) return;
        const [x, z] = P(lon, lat);
        const lb = label(i ? 'B' : 'A', '#e0007a');
        lb.position.set(x, y3(sample(lon, lat)), z);
        profileG.add(lb);
      });
    }
  }

  // UI(화면 위): 레이어 켜고 끄기 · 범례, inlineUI 면 높이 과장 · 해수면 · 중심점까지
  const ui = document.createElement('div');
  el.appendChild(ui);
  ui.innerHTML = `<div class="v-title">${esc(payload.title || '')}</div><button class="v-n" title="나침반 — 누르면 북쪽이 위로" aria-label="나침반, 누르면 북쪽이 위로 오게 돌립니다"><svg viewBox="0 0 44 44"><g class="v-nr"><path d="M22 9 27 22h-10z" fill="#b3261e"/><path d="M22 35 27 22h-10z" fill="#c9c6bf"/><text x="22" y="8" text-anchor="middle" font-size="8" font-weight="700" font-family="'JetBrains Mono',monospace" fill="#111">N</text></g></svg></button>
    <div class="v-ctl"></div><div class="v-cred">${(payload.credits || []).map(esc).join('<br>')}</div>`;
  const ctl = ui.querySelector('.v-ctl');
  const q = (k) => ctl.querySelector(`[data-k="${k}"]`);
  let markOn = true;
  function renderCtl() {
    const hasAreas = !!(overlay && overlay.areas.length), hasLines = draped.some((d) => d.runs.length), hasPts = pins.length > 0;
    ctl.innerHTML = `
      ${inlineUI ? `<label>높이 과장 <input type="range" min="1" max="${MAX_EXAG}" step="0.5" value="${exag}" data-k="exag"> <input type="number" min="1" max="${MAX_EXAG}" step="0.1" value="${exag}" data-k="exagv" aria-label="높이 과장(배)">×</label>` : ''}
      ${inlineUI && hasSea ? `<label>해수면 <input type="range" min="${SEA_MIN}" max="${SEA_MAX}" step="5" value="${seaLevel}" data-k="seaLv"> <b data-k="seaLvv">${seaLevel} m</b></label>` : ''}
      <div class="v-row">
        ${inlineUI ? `<label title="화면을 더블클릭하면 그 자리가 회전 중심이 됩니다"><input type="checkbox" ${markOn ? 'checked' : ''} data-k="center">중심점</label>` : ''}
        ${hasSea ? `<label><input type="checkbox" ${seaOn ? 'checked' : ''} data-k="sea">해수면</label>` : ''}
        ${hasAreas ? `<label><input type="checkbox" ${areasOn ? 'checked' : ''} data-k="areas">영역</label>` : ''}
        ${hasLines ? `<label><input type="checkbox" ${routes.visible ? 'checked' : ''} data-k="routes">경로</label>` : ''}
        ${hasPts ? `<label><input type="checkbox" ${points.visible ? 'checked' : ''} data-k="points">지점</label>` : ''}
      </div>
      ${hasAreas ? `<ul class="v-leg">${overlay.areas.filter((a) => a.name).map((a) => `<li><i style="background:${a.color}73;border-color:${a.color}"></i>${esc(a.name)}</li>`).join('')}</ul>` : ''}`;
    ctl.hidden = !ctl.querySelector('input');
    if (q('exag')) q('exag').addEventListener('input', (e) => setExag(+e.target.value));
    if (q('exagv')) {
      q('exagv').addEventListener('change', (e) => { setExag(+e.target.value); e.target.value = exag; });
      q('exagv').addEventListener('keydown', (e) => { if (e.key === 'Enter') setExag(+e.target.value); });
    }
    if (q('seaLv')) q('seaLv').addEventListener('input', (e) => setSeaLevel(+e.target.value));
    if (q('center')) q('center').addEventListener('change', (e) => setCenterVisible(e.target.checked));
    if (q('sea')) q('sea').addEventListener('change', (e) => { seaOn = e.target.checked; placeSea(); placeOverlay(); });
    if (q('areas')) q('areas').addEventListener('change', (e) => { areasOn = e.target.checked; paintAreas(); });
    if (q('routes')) q('routes').addEventListener('change', (e) => { routes.visible = e.target.checked; });
    if (q('points')) q('points').addEventListener('change', (e) => { points.visible = e.target.checked; });
  }

  // 회전 중심점: 땅 위 고도(m)를 기억해 두었다가 높이 과장이 바뀌어도 땅에 붙어 있게
  const mark = centerSprite();
  scene.add(mark);
  let centerM = 0;
  const keepCenter = () => {
    const dy = (centerM / 1000) * exag - controls.target.y;
    controls.target.y += dy; camera.position.y += dy;
  };
  function setExag(v) {
    exag = clampExag(v); model.scale.y = exag; keepCenter(); placeOverlay();
    if (q('exag')) { q('exag').value = exag; if (document.activeElement !== q('exagv')) q('exagv').value = exag; }
  }
  function setSeaLevel(m) {
    seaLevel = Math.max(SEA_MIN, Math.min(SEA_MAX, Math.round(m)));
    placeSea(); placeOverlay();
    if (q('seaLv')) { q('seaLv').value = seaLevel; q('seaLvv').textContent = seaLevel + ' m'; }
  }
  function setCenterVisible(on) { markOn = on; mark.visible = on; if (q('center')) q('center').checked = on; }
  function setOverlay(ov) { overlay = ov || null; prepare(); paintAreas(); placeOverlay(); renderCtl(); }
  // 단면선: [[lon,lat],…] 를 지형 위에 분홍 선으로(구역 밖 구간은 빼고), 끝점에 A·B
  function setProfile(coords) {
    profile = coords && coords.length > 1 ? { runs: runsOf(coords), ends: [coords[0], coords[coords.length - 1]] } : null;
    placeOverlay();
  }

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

  // 시점: 카메라·중심·높이 과장·해수면을 묶어 저장·복원(내보낸 파일도 이 시점으로 열린다)
  const getView = () => ({ pos: camera.position.toArray(), target: controls.target.toArray(), centerM, exag, seaLevel });
  function setView(v) {
    if (!v) return;
    anim = null;
    if (v.exag) { exag = clampExag(v.exag); model.scale.y = exag; if (q('exag')) { q('exag').value = exag; if (document.activeElement !== q('exagv')) q('exagv').value = exag; } }
    if (v.seaLevel !== undefined) setSeaLevel(v.seaLevel);
    centerM = v.centerM || 0;
    camera.position.fromArray(v.pos); controls.target.fromArray(v.target);
    controls.update(); placeOverlay();
  }

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
    if (!fitted && el.clientWidth) { fit(); fitted = true; if (payload.view) setView(payload.view); }
  };

  prepare(); paintAreas(); placeOverlay(); renderCtl();
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  // 나침반을 누르면 각도·거리는 그대로 두고 북쪽이 위로 오게 돌린다
  const needle = ui.querySelector('.v-nr');
  let lastAz = NaN;
  ui.querySelector('.v-n').addEventListener('click', () => {
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off), th0 = sph.theta, t0 = performance.now();
    anim = (now) => {
      const t = Math.min(1, (now - t0) / 500), e = 1 - (1 - t) ** 3;
      sph.theta = th0 * (1 - e);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      if (t >= 1) anim = null;
    };
  });
  let alive = true;
  (function loop() {
    if (!alive) return;
    if (anim) anim(performance.now());
    controls.update();
    mark.position.copy(controls.target);
    // 나침반: 카메라 방위각만큼 돌려 늘 실제 북쪽(-z)을 가리키게
    const az = controls.getAzimuthalAngle();
    if (!(Math.abs(az - lastAz) < 1e-4)) { lastAz = az; needle.setAttribute('transform', `rotate(${(az * 180) / Math.PI} 22 22)`); }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  return {
    scene, camera, model,
    get exag() { return exag; },
    get seaLevel() { return seaLevel; },
    get target() { return controls.target.clone(); },
    hasSea,
    setExag, setSeaLevel, setCenterVisible, setOverlay, setProfile, getView, setView, fit: () => { centerM = 0; fit(); },
    toPNG: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      alive = false; ro.disconnect(); controls.dispose(); renderer.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
      el.innerHTML = '';
    },
  };
}
