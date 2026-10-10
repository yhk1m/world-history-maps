// © 2026 김용현
// 선택 지도(웹 지형도 OpenTopoMap, Leaflet 전역 L): 직접 그리기 · 틀(네모·세모·원) · 단면선 · 구역 표시 · 덮을 지도 미리보기.
// 현대 국가·대륙·과거 영토는 page.js 가 목록에서 고른 뒤 setRegion 으로 넘긴다.
// 좌표는 [경도, 위도]. 날짜변경선을 넘어 그리면 경도가 ±180 밖으로 이어진다(구역 처리는 clip.unwrapGeom 이 맡는다).

import { shapePolygon, KM_LON, KM_LAT } from 'whm/clip';

const NAMES = { rect: '네모', tri: '세모', circle: '원' };
const RED = '#b3261e', PINK = '#e0007a';

export function createSelector(el, { onChange, onProfile }) {
  const map = L.map(el, { zoomSnap: 0.25, doubleClickZoom: false, worldCopyJump: false, minZoom: 1, maxZoom: 13 }).setView([35, 60], 2);
  // 바탕: OpenTopoMap 지형도(등고선·음영). 출처 표기는 이용 조건(CC-BY-SA)대로
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 13, subdomains: 'abc',
    attribution: '지도 자료 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | 지도 양식 © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }).addTo(map);
  const overL = L.geoJSON(null, { interactive: false, style: { color: '#1f4e79', weight: 1, opacity: 0.6, fillColor: '#1f4e79', fillOpacity: 0.1 } }).addTo(map);
  const regionL = L.geoJSON(null, { interactive: false, style: { color: RED, weight: 2, fillColor: RED, fillOpacity: 0.14 } }).addTo(map);
  const draftL = L.layerGroup().addTo(map);
  const profileL = L.layerGroup().addTo(map);

  let mode = 'draw', kind = 'rect', rot = 0, ratio = 0, shape = null, draft = [];
  // 지도 위 안내 띠: 지금 무엇을 하는 중인지
  const hint = L.DomUtil.create('div', 't-maphint', el);
  const HINTS = {
    draw: '구역 그리기 — 클릭으로 점, <b>오른쪽 클릭</b>으로 확정, Esc 취소',
    profile: '단면선 — 클릭으로 점, <b>오른쪽 클릭</b>(또는 더블클릭)으로 끝, Esc 취소',
    shape: '틀 — 지도에서 끌어 그리기',
  };
  const showHint = () => { hint.innerHTML = HINTS[mode] || ''; hint.hidden = !HINTS[mode]; };
  showHint();
  const ll = (c) => [c[1], c[0]];
  const lonLat = (e) => [e.latlng.lng, e.latlng.lat];

  function drawDraft() {
    draftL.clearLayers();
    if (!draft.length) return;
    const color = mode === 'profile' ? PINK : RED;
    draftL.addLayer(L.polyline(draft.map(ll), { color, weight: 2, dashArray: '5 4', interactive: false }));
    draft.forEach((c) => draftL.addLayer(L.circleMarker(ll(c), { radius: 4, color, weight: 1, fillColor: color, fillOpacity: 1, interactive: false })));
  }
  function set(geom, name) {
    regionL.clearLayers();
    if (geom) regionL.addData(geom);
    onChange(geom ? { geom, name } : null);
  }
  function finish() {
    if (mode === 'draw' && draft.length >= 3) {
      const ring = draft.concat([draft[0]]);
      draft = []; drawDraft();
      set({ type: 'Polygon', coordinates: [ring] }, '직접 그린 구역');
    } else if (mode === 'profile' && draft.length >= 2) {
      const line = draft.slice();
      draft = []; drawDraft();
      showProfile(line);
      if (onProfile) onProfile(line);
    }
  }

  // 직접 그리기·단면선: 클릭 = 점, 오른쪽 클릭 또는 더블클릭 = 확정(e-GIS 와 같은 방식), Esc = 취소
  map.on('click', (e) => {
    if (mode !== 'draw' && mode !== 'profile') return;
    draft.push(lonLat(e)); drawDraft();
  });
  map.on('dblclick', () => {
    if (mode !== 'draw' && mode !== 'profile') return;
    if (draft.length > 1) draft.pop(); // 더블클릭의 두 번째 click 이 같은 점을 한 번 더 넣으므로 뺀다
    finish();
  });
  map.on('contextmenu', () => { if (mode === 'draw' || mode === 'profile') finish(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && draft.length) { draft = []; drawDraft(); } });

  // 틀 — 네모: 한 모서리에서 대각선으로 끌기(비율 고정 가능), 세모·원: 누른 곳 = 중심, 끈 거리 = 크기
  const kx = (lat) => KM_LON * Math.cos((lat * Math.PI) / 180);
  const kmBetween = (a, b) => Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * KM_LAT);
  const makeShape = () => (shape.kind === 'rect'
    ? shapePolygon('rect', { lon: shape.c[0], lat: shape.c[1], wKm: shape.w, hKm: shape.h, rot })
    : shapePolygon(shape.kind, { lon: shape.c[0], lat: shape.c[1], rKm: shape.r, rot }));
  const shapeName = () => (shape.kind === 'rect' ? '네모 구역' : `${NAMES[shape.kind]} 구역 (반지름 ${Math.round(shape.r).toLocaleString()} km)`);
  const big = () => (shape.kind === 'rect' ? Math.max(shape.w, shape.h) : shape.r) >= 2;
  const evLonLat = (ev) => { const p = map.mouseEventToLatLng(ev); return [p.lng, p.lat]; };
  let dragging = false;
  el.addEventListener('pointerdown', (ev) => {
    if (mode !== 'shape' || ev.button) return;
    if (ev.target.closest('.leaflet-control')) return;
    const c = evLonLat(ev);
    dragging = true;
    shape = kind === 'rect' ? { kind, a: c, c, w: 0, h: 0 } : { kind, c, r: 1 };
    try { el.setPointerCapture(ev.pointerId); } catch { /* 합성 이벤트 등 */ }
    ev.preventDefault();
  });
  el.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const p = evLonLat(ev);
    if (shape.kind === 'rect') {
      const a = shape.a;
      let dx = (p[0] - a[0]) * kx(a[1]), dy = (p[1] - a[1]) * KM_LAT;
      if (ratio) {
        const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
        if (Math.abs(dx) > Math.abs(dy) * ratio) dy = (sy * Math.abs(dx)) / ratio;
        else dx = sx * Math.abs(dy) * ratio;
      }
      shape.w = Math.abs(dx) / 2; shape.h = Math.abs(dy) / 2;
      shape.c = [a[0] + dx / 2 / kx(a[1]), a[1] + dy / 2 / KM_LAT];
    } else {
      shape.r = Math.max(1, kmBetween(shape.c, p));
    }
    regionL.clearLayers(); regionL.addData(makeShape());
  });
  const up = () => {
    if (!dragging) return;
    dragging = false;
    if (!big()) { shape = null; regionL.clearLayers(); return; }
    set(makeShape(), shapeName());
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  function showProfile(line) {
    profileL.clearLayers();
    if (!line) return;
    profileL.addLayer(L.polyline(line.map(ll), { color: PINK, weight: 3, interactive: false }));
    [line[0], line[line.length - 1]].forEach((c, i) => profileL.addLayer(L.marker(ll(c), {
      interactive: false,
      icon: L.divIcon({ className: 't-ab', html: i ? 'B' : 'A', iconSize: [18, 18] }),
    })));
  }

  return {
    map,
    setMode(m) {
      mode = m; draft = []; drawDraft(); el.dataset.mode = m; showHint();
      if (m === 'shape') map.dragging.disable(); else map.dragging.enable();
    },
    get mode() { return mode; },
    setKind(kd) { kind = kd; },
    setRatio(r) { ratio = r; },
    setRotation(deg) {
      rot = deg;
      if (shape && mode === 'shape' && big()) set(makeShape(), shapeName());
    },
    setRegion(geom, name, { zoomTo = true } = {}) {
      shape = null;
      set(geom, name);
      if (zoomTo && geom) map.fitBounds(regionL.getBounds(), { padding: [24, 24], maxZoom: 9 });
    },
    showOverlay(fc) {
      overL.clearLayers();
      if (fc) overL.addData({ type: 'FeatureCollection', features: fc.features.filter((f) => f.geometry && (f.properties._t === 'area' || /Polygon/.test(f.geometry.type))) });
    },
    showProfile,
    invalidate() { map.invalidateSize(); },
  };
}
