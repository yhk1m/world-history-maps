// © 2026 김용현
// 2D 선택 지도(d3 전역 사용): 직접 그리기 · 틀(네모·세모·원) · 구역 표시 · 덮을 지도 미리보기.
// 현대 국가·대륙·과거 영토는 page.js 가 목록에서 고른 뒤 setRegion 으로 넘긴다.

import { shapePolygon, KM_LON, KM_LAT } from 'whm/clip';

const NAMES = { rect: '네모', tri: '세모', circle: '원' };

// d3 는 외곽 고리를 시계 방향으로 기대한다
function rewind(geom) {
  const fix = (ring) => (d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI ? ring.slice().reverse() : ring);
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(fix) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(fix)) };
  return geom;
}

export function createSelector(svgEl, { onChange }) {
  const W = 960, H = 500;
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${W} ${H}`);
  const proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
  const path = d3.geoPath(proj);
  const root = svg.append('g');
  root.append('path').attr('class', 's-sphere').attr('d', path({ type: 'Sphere' }));
  root.append('path').attr('class', 's-grat').attr('d', path(d3.geoGraticule10()));
  const gLand = root.append('path').attr('class', 's-land');
  const gOver = root.append('g');
  const gRegion = root.append('path').attr('class', 's-region');
  const gDraft = root.append('g');
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json')
    .then((t) => gLand.attr('d', path(topojson.feature(t, t.objects.land)))).catch(() => {});

  let mode = 'draw', kind = 'rect', rot = 0, shape = null, draft = [], k = 1;
  const zoom = d3.zoom().scaleExtent([1, 40])
    .filter((ev) => (mode === 'shape' ? ev.type === 'wheel' : (!ev.ctrlKey || ev.type === 'wheel') && !ev.button))
    .on('zoom', (ev) => { k = ev.transform.k; root.attr('transform', ev.transform); drawDraft(); });
  svg.call(zoom).on('dblclick.zoom', null);

  const lonLat = (ev) => {
    const t = d3.zoomTransform(svgEl);
    const [x, y] = d3.pointer(ev, svgEl);
    return proj.invert(t.invert([x, y]));
  };

  function drawDraft() {
    gDraft.selectAll('*').remove();
    if (!draft.length) return;
    const pts = draft.map((p) => proj(p));
    gDraft.append('path').attr('class', 's-draft').attr('d', d3.line()(pts));
    gDraft.selectAll('circle').data(pts).join('circle').attr('class', 's-dot').attr('r', 3.5 / k).attr('cx', (d) => d[0]).attr('cy', (d) => d[1]);
  }

  function set(geom, name) {
    gRegion.attr('d', geom ? path(rewind(geom)) : null);
    onChange(geom ? { geom, name } : null);
  }

  // 직접 그리기
  svg.on('click.draw', (ev) => {
    if (mode !== 'draw' || ev.defaultPrevented) return;
    const p = lonLat(ev);
    if (p) { draft.push(p); drawDraft(); }
  });
  svg.on('dblclick.draw', (ev) => {
    if (mode !== 'draw') return;
    ev.preventDefault();
    // 더블클릭의 두 번째 click 이 같은 점을 한 번 더 넣으므로 뺀다
    if (draft.length > 1) draft.pop();
    if (draft.length < 3) return;
    const ring = draft.concat([draft[0]]);
    draft = []; drawDraft();
    set({ type: 'Polygon', coordinates: [ring] }, '직접 그린 구역');
  });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && draft.length) { draft = []; drawDraft(); } });

  // 틀: 누른 곳 = 중심, 끈 거리 = 크기
  const kmBetween = (a, b) => Math.hypot((b[0] - a[0]) * KM_LON * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * KM_LAT);
  const makeShape = () => shapePolygon(shape.kind, { lon: shape.c[0], lat: shape.c[1], rKm: shape.r, rot });
  let dragging = false;
  svg.on('pointerdown.shape', (ev) => {
    if (mode !== 'shape') return;
    const c = lonLat(ev);
    if (!c) return;
    dragging = true; shape = { kind, c, r: 1 };
    svgEl.setPointerCapture(ev.pointerId);
  });
  svg.on('pointermove.shape', (ev) => {
    if (!dragging) return;
    const p = lonLat(ev);
    if (!p) return;
    shape.r = Math.max(1, kmBetween(shape.c, p));
    gRegion.attr('d', path(rewind(makeShape())));
  });
  svg.on('pointerup.shape', () => {
    if (!dragging) return;
    dragging = false;
    if (shape.r < 2) { shape = null; return; }
    set(makeShape(), `${NAMES[shape.kind]} 구역 (${Math.round(shape.r)} km)`);
  });

  return {
    setMode(m) { mode = m; draft = []; drawDraft(); svgEl.dataset.mode = m; },
    setKind(kd) { kind = kd; },
    setRotation(deg) {
      rot = deg;
      if (shape && mode === 'shape') set(makeShape(), `${NAMES[shape.kind]} 구역 (${Math.round(shape.r)} km)`);
    },
    setRegion(geom, name, { zoomTo = true } = {}) {
      shape = null;
      set(geom, name);
      if (zoomTo && geom) {
        const [[x0, y0], [x1, y1]] = path.bounds(rewind(geom));
        const s = Math.max(1, Math.min(40, 0.85 / Math.max((x1 - x0) / W, (y1 - y0) / H)));
        svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
      }
    },
    showOverlay(fc) {
      gOver.selectAll('*').remove();
      if (!fc) return;
      const areas = fc.features.filter((f) => f.properties._t === 'area' && f.geometry);
      gOver.selectAll('path').data(areas).join('path').attr('class', 's-over').attr('d', (f) => path(rewind(f.geometry)));
    },
  };
}
