// © 2026 김용현
// 크로키 레시피: 역사 지도를 깔고 펜·형광펜·화살표·글자로 그린 뒤 PNG·GeoJSON 으로 저장.
// d3 는 전역(index.html 의 script). 획은 경위도로 저장해 확대·이동해도 땅에 붙는다.

import { createStore } from './strokes.js';
import { lonExtent } from '../terrain/clip.js';

const W = 760, H = 500;
const AREA_COLORS = ['#b3261e', '#1f4e79', '#2e7d4f', '#b8860b', '#6a3d9a', '#00838f', '#c2185b', '#5d4037'];
const WIDTHS = { thin: 1.6, mid: 3, thick: 6 };
const FONT = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const $ = (id) => document.getElementById(id);
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
const store = createStore();
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

// d3 는 외곽 고리를 시계 방향으로 기대한다
function rewind(geom) {
  const fix = (ring) => (d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI ? ring.slice().reverse() : ring);
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(fix) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(fix)) };
  return geom;
}

const svgEl = $('skSvg');
if (svgEl) init();

function init() {
  const svg = d3.select(svgEl).attr('viewBox', `0 0 ${W} ${H}`).style('touch-action', 'none');
  const defs = svg.append('defs');
  const bg = svg.append('rect').attr('width', W).attr('height', H).attr('fill', '#f6f5f2');
  const root = svg.append('g');
  const gLand = root.append('path').attr('fill', '#e3e1db');
  const gMap = root.append('g');
  const gInk = root.append('g');
  const gDraft = root.append('g');
  let proj = d3.geoEqualEarth(), path = d3.geoPath(proj), k = 1, land = null, fc = null, mapId = '';
  let tool = 'pen', color = '#b3261e', width = 'mid', space = false, hover = false;
  // 학습지 모드(지명 숨김)와 바탕 레이어 고르기: 숨긴 것은 아예 그리지 않아 PNG 에도 빠진다
  let worksheet = ls.get('sa-sketch-worksheet') === '1';
  let hiddenAreas = new Set(), showLines = true, showPoints = true;

  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json')
    .then((t) => { land = topojson.feature(t, t.objects.land); drawBase(); }).catch(() => {});

  const zoom = d3.zoom().scaleExtent([1, 30])
    .filter((ev) => ev.type === 'wheel' || (space && !ev.button))
    .on('zoom', (ev) => { k = ev.transform.k; root.attr('transform', ev.transform); scaleText(); });
  svg.call(zoom).on('dblclick.zoom', null);

  // 화살촉: 색마다 하나
  const marker = (c) => {
    const id = 'skArw' + c.slice(1);
    if (defs.select('#' + id).empty()) {
      defs.append('marker').attr('id', id).attr('viewBox', '0 0 10 10').attr('refX', 7).attr('refY', 5)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('fill', c);
    }
    return `url(#${id})`;
  };

  function drawBase() {
    gLand.attr('d', land ? path(land) : null);
    gMap.selectAll('*').remove();
    if (!fc) return;
    let ci = 0;
    for (const f of fc.features) {
      const p = f.properties || {}, g = f.geometry;
      if (!g) continue;
      if (p._t === 'area') {
        const ai = ci++, c = AREA_COLORS[ai % AREA_COLORS.length];   // 숨겨도 색 순서는 그대로
        if (hiddenAreas.has(ai)) continue;
        gMap.append('path').attr('d', path(rewind(g))).attr('fill', c).attr('fill-opacity', 0.16)
          .attr('stroke', c).attr('stroke-opacity', 0.7).attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
      }
    }
    for (const f of fc.features) {
      const p = f.properties || {}, g = f.geometry;
      if (p._t === 'line' && g) {
        if (!showLines) continue;
        gMap.append('path').attr('d', path(g)).attr('fill', 'none').attr('stroke', '#555').attr('stroke-width', 1)
          .attr('stroke-dasharray', '4 3').attr('vector-effect', 'non-scaling-stroke');
      } else if (p._t === 'point' && g) {
        if (!showPoints) continue;
        const xy = proj(g.coordinates);
        if (!xy) continue;
        gMap.append('circle').attr('class', 'sk-pt').attr('cx', xy[0]).attr('cy', xy[1]).attr('r', 2.4 / k).attr('fill', '#111');
        if (worksheet) continue;
        gMap.append('text').attr('class', 'sk-scale').attr('data-size', 10).attr('x', xy[0] + 4 / k).attr('y', xy[1] - 3 / k)
          .attr('font-family', FONT).attr('font-size', 10 / k).attr('fill', '#333').attr('paint-order', 'stroke')
          .attr('stroke', '#fff').attr('stroke-width', 2.5 / k).text(p.name || '');
      }
    }
    drawInk();
  }

  function strokeEl(g, s) {
    if (s.tool === 'text') {
      const xy = proj(s.coords[0]);
      if (!xy) return;
      g.append('text').attr('data-id', s.id).attr('class', 'sk-scale').attr('data-size', 16)
        .attr('x', xy[0]).attr('y', xy[1]).attr('font-family', FONT).attr('font-weight', 700)
        .attr('font-size', 16 / k).attr('fill', s.color).attr('paint-order', 'stroke').attr('stroke', '#fff').attr('stroke-width', 3 / k)
        .text(s.text);
      return;
    }
    const pts = s.tool === 'arrow' ? [s.coords[0], s.coords[s.coords.length - 1]] : s.coords;
    const d = d3.line()(pts.map((c) => proj(c)).filter(Boolean));
    const el = g.append('path').attr('data-id', s.id).attr('d', d).attr('fill', 'none').attr('stroke', s.color)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('vector-effect', 'non-scaling-stroke');
    if (s.tool === 'hi') el.attr('stroke-width', s.width * 4).attr('stroke-opacity', 0.35);
    else el.attr('stroke-width', s.width);
    if (s.tool === 'arrow') el.attr('marker-end', marker(s.color));
  }
  function drawInk() {
    gInk.selectAll('*').remove();
    store.list().forEach((s) => strokeEl(gInk, s));
    scaleText();
  }
  // 글자·점은 확대해도 화면 크기가 같게
  function scaleText() {
    root.selectAll('.sk-scale').each(function () {
      const t = d3.select(this), sz = +t.attr('data-size');
      t.attr('font-size', sz / k).attr('stroke-width', (sz > 12 ? 3 : 2.5) / k);
    });
    root.selectAll('.sk-pt').attr('r', 2.4 / k);
  }

  // 바탕 지도 바꾸기: 그리던 것은 지도별로 브라우저에 기억
  async function setMap(id) {
    if (mapId !== null) ls.set('sa-sketch:' + mapId, store.dump());
    mapId = id;
    fc = id ? await getJSON('data/lite/maps/' + enc(id) + '.json') : null;
    if (fc) {
      const lons = [], pts = [];
      const walk = (c) => { if (typeof c[0] === 'number') { lons.push(c[0]); pts.push(c); } else c.forEach(walk); };
      fc.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
      const [w, e] = lonExtent(lons);
      proj = d3.geoEqualEarth().rotate([-(w + e) / 2, 0]).fitExtent([[20, 20], [W - 20, H - 20]], { type: 'MultiPoint', coordinates: pts });
    } else {
      proj = d3.geoEqualEarth().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'Sphere' });
    }
    path = d3.geoPath(proj);
    svg.call(zoom.transform, d3.zoomIdentity);
    store.load(ls.get('sa-sketch:' + id) || '[]');
    hiddenAreas = new Set(); showLines = true; showPoints = true;
    buildLayers();
    drawBase();
  }

  // 바탕 레이어 목록: 영역(이름 + 색) · 경로 · 지점
  function buildLayers() {
    const box = $('skLayers');
    if (!box) return;
    box.innerHTML = '';
    const feats = fc ? fc.features.filter((f) => f.geometry) : [];
    const areas = feats.filter((f) => (f.properties || {})._t === 'area');
    const nLine = feats.filter((f) => (f.properties || {})._t === 'line').length;
    const nPt = feats.filter((f) => (f.properties || {})._t === 'point').length;
    const item = (label, swatch, on, fn, extra) => {
      const lab = document.createElement('label');
      lab.className = 'sk-check' + (extra ? ' ' + extra : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = on;
      cb.addEventListener('change', () => { fn(cb.checked); drawBase(); });
      lab.appendChild(cb);
      if (swatch) { const sw = document.createElement('i'); sw.className = 'sk-sw'; sw.style.setProperty('--c', swatch); lab.appendChild(sw); }
      lab.appendChild(document.createTextNode(label));
      box.appendChild(lab);
    };
    areas.forEach((f, i) => item(f.properties.name || `영역 ${i + 1}`, AREA_COLORS[i % AREA_COLORS.length], !hiddenAreas.has(i),
      (on) => { if (on) hiddenAreas.delete(i); else hiddenAreas.add(i); }));
    if (nLine) item(`경로 (${nLine})`, null, showLines, (on) => { showLines = on; }, 'grp');
    if (nPt) item(`지점 (${nPt})`, null, showPoints, (on) => { showPoints = on; }, 'grp');
    if (!box.childNodes.length) box.innerHTML = '<p class="sk-none">이 바탕에는 고를 레이어가 없습니다.</p>';
  }

  // 그리기
  const lonLat = (ev) => {
    const [x, y] = d3.zoomTransform(svgEl).invert(d3.pointer(ev, svgEl));
    return proj.invert([x, y]);
  };
  let cur = null, lastPx = null;
  svg.on('pointerdown.sk', (ev) => {
    if (space || ev.button) return;
    ev.preventDefault();
    if (tool === 'erase') {
      const id = ev.target.getAttribute && ev.target.getAttribute('data-id');
      if (id) store.erase(id);
      return;
    }
    const p = lonLat(ev);
    if (!p) return;
    if (tool === 'text') { askText(ev, p); return; }
    cur = { tool, color, width: WIDTHS[width], coords: [p] };
    lastPx = d3.pointer(ev, svgEl);
    try { svgEl.setPointerCapture(ev.pointerId); } catch { /* 합성 이벤트 등 */ }
  });
  svg.on('pointermove.sk', (ev) => {
    if (!cur) {
      if (tool === 'erase' && ev.buttons === 1) { const id = ev.target.getAttribute && ev.target.getAttribute('data-id'); if (id) store.erase(id); }
      return;
    }
    const px = d3.pointer(ev, svgEl);
    if (Math.hypot(px[0] - lastPx[0], px[1] - lastPx[1]) < 2) return;
    lastPx = px;
    const p = lonLat(ev);
    if (!p) return;
    if (cur.tool === 'arrow') cur.coords[1] = p; else cur.coords.push(p);
    gDraft.selectAll('*').remove();
    strokeEl(gDraft, { ...cur, id: 'draft' });
  });
  const end = () => {
    if (!cur) return;
    gDraft.selectAll('*').remove();
    if (cur.coords.length > 1) store.add(cur);
    cur = null;
  };
  svg.on('pointerup.sk', end).on('pointercancel.sk', end);

  // 글자: 누른 자리에 입력 칸을 띄운다(브라우저 대화상자 대신)
  function askText(ev, p) {
    const fig = svgEl.parentElement, r = fig.getBoundingClientRect();
    const box = document.createElement('input');
    box.className = 'sk-input'; box.placeholder = '글자 입력 후 Enter';
    box.style.left = (ev.clientX - r.left) + 'px'; box.style.top = (ev.clientY - r.top - 14) + 'px';
    box.style.color = color;
    fig.appendChild(box);
    setTimeout(() => box.focus(), 0);
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      const t = box.value.trim();
      box.remove();
      if (ok && t) store.add({ tool: 'text', color, width: 2, coords: [p], text: t });
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    box.addEventListener('blur', () => finish(true));
  }

  store.onChange(() => {
    drawInk();
    ls.set('sa-sketch:' + mapId, store.dump());
    $('skUndo').disabled = !store.canUndo();
    $('skRedo').disabled = !store.canRedo();
  });

  // 키보드: 지도 위에 마우스가 있을 때 Space = 이동, Ctrl+Z / Ctrl+Y
  svgEl.addEventListener('pointerenter', () => { hover = true; });
  svgEl.addEventListener('pointerleave', () => { hover = false; });
  window.addEventListener('keydown', (e) => {
    if (!hover || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { space = true; svgEl.classList.add('panning'); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; svgEl.classList.remove('panning'); } });

  // 도구 단추
  const pick = (sel, attr, fn) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(sel).forEach((x) => x.classList.toggle('on', x === b));
    fn(b.dataset[attr]);
  }));
  pick('#skTools button', 'tool', (v) => { tool = v; svgEl.dataset.tool = v; });
  pick('#skWidths button', 'w', (v) => { width = v; });
  pick('#skColors button', 'c', (v) => { color = v; });
  $('skUndo').addEventListener('click', () => store.undo());
  $('skRedo').addEventListener('click', () => store.redo());
  $('skClear').addEventListener('click', () => store.clear());
  $('skFit').addEventListener('click', () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity));
  $('skMap').addEventListener('change', (e) => setMap(e.target.value));
  const ws = $('skWorksheet');
  if (ws) {
    ws.checked = worksheet;
    ws.addEventListener('change', () => { worksheet = ws.checked; ls.set('sa-sketch-worksheet', worksheet ? '1' : '0'); drawBase(); });
  }

  const save = (name, blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const baseName = () => '크로키_' + ($('skMap').selectedOptions[0]?.textContent || '지도').replace(/[\\/:*?"<>|·]+/g, '_').replace(/\s+/g, '');
  $('skGeo').addEventListener('click', () => save(baseName() + '.geojson', new Blob([JSON.stringify(store.toGeoJSON())], { type: 'application/geo+json' })));
  $('skPng').addEventListener('click', () => {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W * 2); clone.setAttribute('height', H * 2);
    // 화면 굵기를 유지하는 선(non-scaling)은 2배 크기 그림에서 같은 비율이 되도록 굵기도 2배
    clone.querySelectorAll('[vector-effect]').forEach((e) => e.setAttribute('stroke-width', (+e.getAttribute('stroke-width') || 1) * 2));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = W * 2; cv.height = H * 2;
      cv.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => save(baseName() + '.png', b), 'image/png');
    };
    img.src = url;
  });

  // 바탕 지도 목록: 한국사 + 세계사 교과서
  Promise.all([getJSON('data/index.json'), getJSON('data/lite/korea_index.json').catch(() => ({ maps: [] }))]).then(([world, korea]) => {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const opt = (id, label) => `<option value="${esc(id)}">${esc(label)}</option>`;
    $('skMap').innerHTML = opt('', '바탕만 (세계)')
      + `<optgroup label="한국사">${korea.maps.map((m) => opt(m.id, '한국사 · ' + m.title)).join('')}</optgroup>`
      + `<optgroup label="세계사 교과서">${world.maps.map((m) => opt(m.id, `${m.vol}권 ${m.page}쪽 · ${m.title}`)).join('')}</optgroup>`;
    const first = world.maps.find((m) => m.id.includes('p080')) || world.maps[0];
    $('skMap').value = first.id;
    mapId = null;
    setMap(first.id);
  }).catch((e) => console.error('[SA] sketch', e));

  window.__sketch = { store, setMap, get proj() { return proj; }, setWorksheet: (v) => { if (ws) ws.checked = v; worksheet = v; drawBase(); }, zoom: (t) => svg.call(zoom.transform, t) };
}
