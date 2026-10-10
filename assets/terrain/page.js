// © 2026 김용현
// terrain.html 조립: 구역 고르기 → 고도 격자 → 3D 뷰어, HTML 내보내기.

import { createSelector } from 'whm/select';
import { unwrapGeom, bboxOf, sizeKm, lonExtent } from 'whm/clip';
import { loadGrid } from 'whm/dem';
import { prepareOverlay } from 'whm/overlay';
import { createViewer, MAX_EXAG } from 'whm/viewer';
import { buildHTML, download } from 'whm/export';

const DATA = 'data/';
// 지형 고도색(초록·황갈)과 섞여도 구분되도록 초록 계열은 뺀 영역 색
const PALETTE = ['#b3261e', '#1f4e79', '#6a3d9a', '#b8860b', '#c2185b', '#00838f', '#5d4037', '#455a64'];
const CREDITS = ['고도·수심: AWS Terrain Tiles (SRTM, GEBCO, ETOPO1 등)', '경계: Natural Earth', '역사 지도: SpaceArchive (yhk1m.github.io/space-archive)'];
const $ = (id) => document.getElementById(id);
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const mapCache = new Map();
const loadMap = (id) => {
  if (!mapCache.has(id)) mapCache.set(id, getJSON(DATA + 'lite/maps/' + enc(id) + '.json'));
  return mapCache.get(id);
};

let region = null, viewer = null, last = null, index = null;

const sel = createSelector($('selMap'), {
  onChange(r) {
    region = r;
    if (!r) { $('regionInfo').textContent = '구역을 고르세요.'; return; }
    const { w, h } = sizeKm(bboxOf(unwrapGeom(r.geom).geom));
    $('regionInfo').innerHTML = `<b>${esc(r.name)}</b> · 약 ${Math.round(w).toLocaleString()} × ${Math.round(h).toLocaleString()} km`;
    $('build').disabled = false;
  },
});

// 선택 방식 탭
const panes = { draw: 'paneDraw', shape: 'paneShape', country: 'paneCountry', continent: 'paneContinent', history: 'paneHistory' };
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x === b));
  for (const [m, id] of Object.entries(panes)) $(id).hidden = m !== b.dataset.mode;
  sel.setMode(b.dataset.mode === 'shape' ? 'shape' : b.dataset.mode === 'draw' ? 'draw' : 'pick');
}));
document.querySelectorAll('#kinds button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#kinds button').forEach((x) => x.classList.toggle('on', x === b));
  sel.setKind(b.dataset.kind);
  const rect = b.dataset.kind === 'rect';
  $('ratios').hidden = !rect;
  $('shapeHelp').innerHTML = rect
    ? '네모는 한 모서리에서 <b>대각선으로 끌어</b> 그립니다(비율은 가로:세로, 실제 거리 기준). 휠은 확대.'
    : '누른 곳이 <b>중심</b>, 끈 거리가 크기입니다. 휠은 확대.';
}));
document.querySelectorAll('#ratios button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#ratios button').forEach((x) => x.classList.toggle('on', x === b));
  sel.setRatio(+b.dataset.r);
}));
$('rot').addEventListener('input', (e) => { $('rotv').textContent = e.target.value + '°'; sel.setRotation(+e.target.value); });

// 검색 목록: items = [{label, sub, pick()}]
function list(ul, input, items) {
  const render = () => {
    const q = input ? input.value.trim() : '';
    const hits = items.filter((it) => !q || it.label.includes(q) || (it.sub || '').includes(q) || (it.en || '').toLowerCase().includes(q.toLowerCase())).slice(0, 200);
    ul.innerHTML = hits.map((it, i) => `<li><button data-i="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button></li>`).join('');
    ul.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      ul.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      hits[+b.dataset.i].pick();
    }));
  };
  if (input) input.addEventListener('input', render);
  render();
}

// 덮을 역사 지도
function setOverlayMap(id) {
  $('overMap').value = id;
  $('wholeMap').disabled = !id;
  if (!id) { sel.showOverlay(null); return; }
  loadMap(id).then((fc) => { if ($('overMap').value === id) sel.showOverlay(fc); });
}
$('overMap').addEventListener('change', (e) => setOverlayMap(e.target.value));
// 지도 전체 범위: 날짜변경선을 넘는 지도도 짧은 쪽 경도 구간으로
$('wholeMap').addEventListener('click', async () => {
  const id = $('overMap').value;
  const m = index.maps.find((x) => x.id === id);
  if (!m) return;
  const lons = [], lats = [];
  const walk = (c) => { if (typeof c[0] === 'number') { lons.push(c[0]); lats.push(c[1]); } else c.forEach(walk); };
  for (const f of (await loadMap(id)).features) if (f.geometry) walk(f.geometry.coordinates);
  const [w, e] = lonExtent(lons);
  const s = Math.min(...lats), n = Math.max(...lats);
  const pw = (e - w) * 0.04, ph = (n - s) * 0.04;
  sel.setRegion({ type: 'Polygon', coordinates: [[[w - pw, s - ph], [e + pw, s - ph], [e + pw, n + ph], [w - pw, n + ph], [w - pw, s - ph]]] }, m.title);
});

Promise.all([getJSON(DATA + 'index.json'), getJSON(DATA + 'lite/ne_countries.json'), getJSON(DATA + 'lite/korea_index.json')]).then(([world, ne, korea]) => {
  // 세계사 교과서 지도 + 한국사 시기별 영토를 한 목록으로(label = 목록·선택 상자에 보일 이름)
  world.maps.forEach((m) => { m.label = `${m.vol}권 ${m.page}쪽 · ${m.title}`; });
  korea.maps.forEach((m) => { m.label = `한국사 · ${m.title}`; });
  const idx = { maps: world.maps.concat(korea.maps) };
  index = idx;
  const opts = (ms) => ms.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  $('overMap').insertAdjacentHTML('beforeend', `<optgroup label="한국사">${opts(korea.maps)}</optgroup><optgroup label="세계사 교과서">${opts(world.maps)}</optgroup>`);
  const countries = ne.features.filter((f) => f.properties.kind === 'country');
  list($('countryList'), $('countryQ'), countries.map((f) => ({
    label: f.properties.name, sub: f.properties.continent, en: f.properties.en,
    pick: () => sel.setRegion(f.geometry, f.properties.name),
  })));
  list($('continentList'), null, ne.features.filter((f) => f.properties.kind === 'continent').map((f) => ({
    label: f.properties.name, pick: () => sel.setRegion(f.geometry, f.properties.name),
  })));
  const hist = [];
  for (const m of idx.maps) for (const f of m.files) {
    if (!f.startsWith('영역_') || f === '영역_전체.geojson') continue;
    const name = f.slice(3, -8);
    hist.push({ label: name, sub: m.label, pick: async () => {
      const fc = await loadMap(m.id);
      const g = fc.features.find((x) => x.properties._t === 'area' && x.properties.name === name);
      if (!g) return;
      setOverlayMap(m.id);
      sel.setRegion(g.geometry, name);
    } });
  }
  list($('histList'), $('histQ'), hist);
}).catch((e) => { console.error('[3D]', e); $('status').textContent = '목록을 불러오지 못했습니다.'; });

// 3D 만들기
$('build').addEventListener('click', async () => {
  if (!region) return;
  const { geom } = unwrapGeom(region.geom);
  const bbox = bboxOf(geom);
  const { w, h } = sizeKm(bbox);
  if (Math.max(w, h) < 2) { $('status').textContent = '구역이 너무 작습니다(한 변 2 km 이상).'; return; }
  const wide = bbox[2] - bbox[0] > 180;
  $('build').disabled = true; $('export').disabled = true;
  $('status').textContent = '고도 타일을 받는 중…';
  try {
    const grid = await loadGrid(bbox, { onProgress: (d, t) => { $('status').textContent = `고도 타일 ${d}/${t}`; } });
    const id = $('overMap').value;
    const overlay = id ? prepareOverlay(await loadMap(id), bbox, PALETTE) : null;
    const mapTitle = id ? index.maps.find((m) => m.id === id).title : '';
    const payload = { title: region.name + (mapTitle && mapTitle !== region.name ? ` · ${mapTitle}` : ''), grid, region: geom, overlay, credits: CREDITS };
    if (viewer) viewer.dispose();
    viewer = createViewer($('view'), payload, { inlineUI: false });
    viewer.setCenterVisible($('centerOn').checked);
    $('exag').disabled = false; $('exag').max = MAX_EXAG; $('exag').value = viewer.exag; $('exagv').textContent = viewer.exag + '×';
    last = payload;
    $('export').disabled = false;
    $('status').textContent = (grid.failed ? `타일 ${grid.failed}장을 받지 못해 0 m 로 채웠습니다. ` : '')
      + (wide ? '넓은 구역이라 지형이 거칠어집니다. ' : '')
      + `격자 ${grid.w}×${grid.h} (확대 단계 ${grid.z})`;
  } catch (e) {
    console.error('[3D]', e);
    $('status').textContent = '지형을 만들지 못했습니다: ' + e.message;
  } finally {
    $('build').disabled = false;
  }
});

// 높이 과장(사이드바)
$('exag').addEventListener('input', (e) => {
  if (!viewer) return;
  viewer.setExag(+e.target.value);
  $('exagv').textContent = viewer.exag + '×';
});

$('centerOn').addEventListener('change', (e) => { if (viewer) viewer.setCenterVisible(e.target.checked); });

// HTML 내보내기
$('export').addEventListener('click', async () => {
  if (!last) return;
  $('export').disabled = true;
  $('status').textContent = 'HTML 파일을 만드는 중…';
  try {
    const html = await buildHTML({ ...last, exag: viewer ? viewer.exag : undefined });
    download(`3D지형_${region ? region.name : '구역'}.html`, html);
    $('status').textContent = `내보냈습니다 (${(html.length / 1e6).toFixed(1)} MB).`;
  } catch (e) {
    console.error('[3D]', e);
    $('status').textContent = '내보내지 못했습니다: ' + e.message;
  } finally {
    $('export').disabled = false;
  }
});

// 확인용 훅(헤드리스 캡처)
window.__terrain = { sel, setOverlayMap, build: () => $('build').click(), get last() { return last; }, get viewer() { return viewer; }, buildHTML };
