// © 2026 김용현
// terrain.html 조립: 구역 고르기(웹지도) → 고도 격자 → 3D 뷰어. 보기(높이 과장·해수면·시점·PNG), 단면도, 시나리오 3D, HTML 내보내기.

import { createSelector } from 'whm/select';
import { unwrapGeom, bboxOf, sizeKm, lonExtent, KM_LON, KM_LAT } from 'whm/clip';
import { loadGrid } from 'whm/dem';
import { prepareOverlay, mergeOverlays, sampler } from 'whm/overlay';
import { createViewer, MAX_EXAG, SEA_MIN, SEA_MAX } from 'whm/viewer';
import { buildHTML, download } from 'whm/export';

const DATA = 'data/';
// 지형 고도색(초록·황갈)과 섞여도 구분되도록 초록 계열은 뺀 영역 색
const PALETTE = ['#b3261e', '#1f4e79', '#6a3d9a', '#b8860b', '#c2185b', '#00838f', '#5d4037', '#455a64'];
const CREDITS = ['고도·수심: AWS Terrain Tiles (SRTM, GEBCO, ETOPO1 등)', '경계: Natural Earth', '지도 자료: SpaceArchive (yhk1m.github.io/space-archive)'];
const $ = (id) => document.getElementById(id);
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const status = (t) => { $('status').textContent = t; };

const mapCache = new Map();
const loadMap = (id) => {
  if (!mapCache.has(id)) mapCache.set(id, getJSON(DATA + 'lite/maps/' + enc(id) + '.json'));
  return mapCache.get(id);
};

let region = null, viewer = null, last = null, index = null, userFc = null, savedView = null, scenarios = [], scen = null;

const sel = createSelector($('selMap'), {
  onChange(r) {
    region = r;
    if (!r) { $('regionInfo').textContent = '구역을 고르세요.'; return; }
    const { w, h } = sizeKm(bboxOf(unwrapGeom(r.geom).geom));
    $('regionInfo').innerHTML = `<b>${esc(r.name)}</b> · 약 ${Math.round(w).toLocaleString()} × ${Math.round(h).toLocaleString()} km`;
    $('build').disabled = false;
  },
  onProfile: (line) => drawProfile(line),
});

// 선택 방식 탭
const panes = { draw: 'paneDraw', shape: 'paneShape', country: 'paneCountry', continent: 'paneContinent', history: 'paneHistory' };
let tabMode = 'draw';
const selModeOf = (m) => (m === 'shape' ? 'shape' : m === 'draw' ? 'draw' : 'pick');
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x === b));
  for (const [m, id] of Object.entries(panes)) $(id).hidden = m !== b.dataset.mode;
  tabMode = b.dataset.mode;
  sel.setMode(selModeOf(tabMode));
  $('profileBtn').classList.remove('on');
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

// 경위도 목록 → 짧은 쪽 경도 구간으로 감싼 네모(날짜변경선을 넘는 지도도)
function boxAround(coordsLists, pad = 0.04) {
  const lons = [], lats = [];
  const walk = (c) => { if (typeof c[0] === 'number') { lons.push(c[0]); lats.push(c[1]); } else c.forEach(walk); };
  coordsLists.forEach(walk);
  const [w, e] = lonExtent(lons);
  const s = Math.min(...lats), n = Math.max(...lats);
  const pw = (e - w) * pad, ph = (n - s) * pad;
  return { type: 'Polygon', coordinates: [[[w - pw, s - ph], [e + pw, s - ph], [e + pw, n + ph], [w - pw, n + ph], [w - pw, s - ph]]] };
}

// 덮을 자료: 교과서 지도 + 내 GeoJSON. 3D 가 있으면 바로 바꿔 덮는다(시나리오 재생 중에는 시나리오가 우선)
async function overlayFor(bbox) {
  const id = $('overMap').value;
  const base = id ? prepareOverlay(await loadMap(id), bbox, PALETTE) : null;
  const mine = userFc ? prepareOverlay(userFc, bbox, PALETTE.slice(3)) : null;
  return base || mine ? mergeOverlays(base, mine) : null;
}
async function refreshOverlay() {
  if (!viewer || !last || scen) return;
  last.overlay = await overlayFor(last.grid.bbox);
  viewer.setOverlay(last.overlay);
}
function setOverlayMap(id) {
  $('overMap').value = id;
  $('wholeMap').disabled = !id;
  if (!id) sel.showOverlay(null);
  else loadMap(id).then((fc) => { if ($('overMap').value === id) sel.showOverlay(fc); });
  refreshOverlay();
}
$('overMap').addEventListener('change', (e) => setOverlayMap(e.target.value));
$('wholeMap').addEventListener('click', async () => {
  const id = $('overMap').value;
  const m = index.maps.find((x) => x.id === id);
  if (!m) return;
  const fc = await loadMap(id);
  sel.setRegion(boxAround(fc.features.filter((f) => f.geometry).map((f) => f.geometry.coordinates)), m.title);
});
$('userGeo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const fc = JSON.parse(await f.text());
    const feats = fc.type === 'FeatureCollection' ? fc.features : fc.type === 'Feature' ? [fc] : [];
    if (!feats.length) throw new Error('도형이 없습니다');
    userFc = { type: 'FeatureCollection', features: feats };
    $('userGeoInfo').hidden = false;
    $('userGeoInfo').querySelector('span').textContent = `${f.name} · 도형 ${feats.length}개`;
    refreshOverlay();
  } catch (err) {
    status('GeoJSON 을 읽지 못했습니다: ' + err.message);
  }
  e.target.value = '';
});
$('userGeoClear').addEventListener('click', () => { userFc = null; $('userGeoInfo').hidden = true; refreshOverlay(); });

Promise.all([getJSON(DATA + 'index.json'), getJSON(DATA + 'lite/ne_countries.json'), getJSON(DATA + 'lite/korea_index.json'), getJSON(DATA + 'lite/scenarios.json')]).then(([world, ne, korea, scs]) => {
  // 세계사 교과서 지도 + 한국사 시기별 영토를 한 목록으로(label = 목록·선택 상자에 보일 이름)
  world.maps.forEach((m) => { m.label = `${m.vol}권 ${m.page}쪽 · ${m.title}`; });
  korea.maps.forEach((m) => { m.label = `한국사 · ${m.title}`; });
  index = { maps: world.maps.concat(korea.maps) };
  const opts = (ms) => ms.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  $('overMap').insertAdjacentHTML('beforeend', `<optgroup label="한국사">${opts(korea.maps)}</optgroup><optgroup label="세계사 교과서">${opts(world.maps)}</optgroup>`);
  list($('countryList'), $('countryQ'), ne.features.filter((f) => f.properties.kind === 'country').map((f) => ({
    label: f.properties.name, sub: f.properties.continent, en: f.properties.en,
    pick: () => sel.setRegion(f.geometry, f.properties.name),
  })));
  list($('continentList'), null, ne.features.filter((f) => f.properties.kind === 'continent').map((f) => ({
    label: f.properties.name, pick: () => sel.setRegion(f.geometry, f.properties.name),
  })));
  const hist = [];
  for (const m of index.maps) for (const f of m.files) {
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
  scenarios = scs;
  $('scenSel').insertAdjacentHTML('beforeend', scs.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join(''));
}).catch((e) => { console.error('[3D]', e); status('목록을 불러오지 못했습니다.'); });

// 3D 만들기(구역·시나리오 공용)
async function make(geom0, title, overlayOf) {
  const { geom } = unwrapGeom(geom0);
  const bbox = bboxOf(geom);
  const { w, h } = sizeKm(bbox);
  if (Math.max(w, h) < 2) { status('구역이 너무 작습니다(한 변 2 km 이상).'); return false; }
  const wide = bbox[2] - bbox[0] > 180;
  $('build').disabled = true; $('export').disabled = true; $('scenBuild').disabled = true;
  status('고도 타일을 받는 중…');
  try {
    const grid = await loadGrid(bbox, { onProgress: (d, t) => status(`고도 타일 ${d}/${t}`) });
    const overlay = await overlayOf(bbox);
    const payload = { title, grid, region: geom, overlay, credits: CREDITS };
    if (viewer) viewer.dispose();
    if ($('viewWrap').classList.contains('t-folded')) setFold('viewWrap', false);
    viewer = createViewer($('view'), payload, { inlineUI: false });
    last = payload; savedView = null;
    viewer.setCenterVisible($('centerOn').checked);
    document.querySelector('.t-sec[data-sec="4"]').open = true;
    syncViewUI();
    $('profileBox').hidden = true;
    sel.showProfile(null);
    status((grid.failed ? `타일 ${grid.failed}장을 받지 못해 0 m 로 채웠습니다. ` : '')
      + (wide ? '넓은 구역이라 지형이 거칠어집니다. ' : '')
      + `격자 ${grid.w}×${grid.h} (확대 단계 ${grid.z})`);
    return true;
  } catch (e) {
    console.error('[3D]', e);
    status('지형을 만들지 못했습니다: ' + e.message);
    return false;
  } finally {
    $('build').disabled = !region; $('export').disabled = !viewer; $('scenBuild').disabled = $('scenSel').value === '';
  }
}
$('build').addEventListener('click', () => {
  if (!region) return;
  stopScenario(true);
  const id = $('overMap').value;
  const mapTitle = id ? index.maps.find((m) => m.id === id).title : '';
  make(region.geom, region.name + (mapTitle && mapTitle !== region.name ? ` · ${mapTitle}` : ''), overlayFor);
});

// 보기: 높이 과장·해수면(슬라이더와 숫자 칸)·중심점·시점·PNG
const viewInputs = ['exag', 'exagNum', 'sea', 'seaNum', 'viewSave', 'viewFit', 'viewPng'];
function syncViewUI() {
  for (const k of viewInputs) $(k).disabled = !viewer;
  $('viewLoad').disabled = !viewer || !savedView;
  if (!viewer) return;
  $('exag').max = $('exagNum').max = MAX_EXAG;
  $('exag').value = viewer.exag; if (document.activeElement !== $('exagNum')) $('exagNum').value = viewer.exag;
  $('sea').min = $('seaNum').min = SEA_MIN; $('sea').max = $('seaNum').max = SEA_MAX;
  $('sea').disabled = $('seaNum').disabled = !viewer.hasSea;
  $('sea').value = viewer.seaLevel; if (document.activeElement !== $('seaNum')) $('seaNum').value = viewer.seaLevel;
}
$('exag').addEventListener('input', (e) => { if (viewer) { viewer.setExag(+e.target.value); syncViewUI(); } });
const numInput = (id, apply) => {
  const go = () => { if (viewer) { apply(+$(id).value); $(id).blur(); syncViewUI(); } };
  $(id).addEventListener('change', go);
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
};
numInput('exagNum', (v) => viewer.setExag(v));
$('sea').addEventListener('input', (e) => { if (viewer) { viewer.setSeaLevel(+e.target.value); syncViewUI(); } });
numInput('seaNum', (v) => viewer.setSeaLevel(v));
$('centerOn').addEventListener('change', (e) => { if (viewer) viewer.setCenterVisible(e.target.checked); });
$('viewSave').addEventListener('click', () => { savedView = viewer.getView(); syncViewUI(); status('지금 시점을 기억했습니다. 내보낸 HTML 도 이 시점으로 열립니다.'); });
$('viewLoad').addEventListener('click', () => { if (savedView) { viewer.setView(savedView); syncViewUI(); } });
$('viewFit').addEventListener('click', () => viewer.fit());
const fileName = (ext) => `3D지형_${(last && last.title) || '구역'}`.replace(/[\\/:*?"<>|·]+/g, '_').replace(/\s+/g, '') + ext;
$('viewPng').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = viewer.toPNG(); a.download = fileName('.png');
  document.body.appendChild(a); a.click(); a.remove();
});

// 단면도: 지도에 선을 긋고 오른쪽 클릭 → 고도 격자에서 표집해 csat-chart.js 꺾은선으로.
// 3D 가 있고 선이 그 범위 안이면 그 격자를, 아니면 선 둘레의 고도를 따로 받아 쓴다(3D 없이도 된다)
$('profileBtn').addEventListener('click', () => {
  const on = sel.mode !== 'profile';
  if (on && $('selWrap').classList.contains('t-folded')) setFold('selWrap', false);
  sel.setMode(on ? 'profile' : selModeOf(tabMode));
  $('profileBtn').classList.toggle('on', on);
  if (on) status('위 지도에 단면선을 그으세요 — 클릭으로 점, 오른쪽 클릭으로 끝.');
});
let profile = null, fontsReady = null;
async function drawProfile(line) {
  sel.setMode(selModeOf(tabMode));
  $('profileBtn').classList.remove('on');
  let grid = last && last.grid, L = line;
  const inside = (b, pts) => pts.every(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  if (grid) {
    const lon0 = (grid.bbox[0] + grid.bbox[2]) / 2;
    L = line.map(([x, y]) => [x + 360 * Math.round((lon0 - x) / 360), y]);
  }
  const onModel = !!grid && inside(grid.bbox, L);
  if (!onModel) {
    const { geom } = unwrapGeom({ type: 'Polygon', coordinates: [line.concat([line[0]])] });
    L = geom.coordinates[0].slice(0, -1);
    const b = bboxOf(geom), px = Math.max(0.02, (b[2] - b[0]) * 0.03), py = Math.max(0.02, (b[3] - b[1]) * 0.03);
    status('단면선 고도를 받는 중…');
    try {
      grid = await loadGrid([b[0] - px, b[1] - py, b[2] + px, b[3] + py], { maxCells: 512 });
    } catch (e) { status('고도를 받지 못했습니다: ' + e.message); return; }
  }
  // 거리(km)를 따라 같은 간격으로 121점
  const seg = [], cum = [0];
  for (let i = 1; i < L.length; i++) {
    const c = Math.cos((((L[i - 1][1] + L[i][1]) / 2) * Math.PI) / 180);
    seg.push(Math.hypot((L[i][0] - L[i - 1][0]) * KM_LON * c, (L[i][1] - L[i - 1][1]) * KM_LAT));
    cum.push(cum[i - 1] + seg[i - 1]);
  }
  const total = cum[cum.length - 1], N = 121, sample = sampler(grid), vals = [], labels = [];
  // 눈금: 1·2·5×10ⁿ km 간격 중 5~8칸이 되는 것, 그 배수를 처음 넘는 점에 이름
  const raw = total / 6, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const tick = [1, 2, 5, 10].map((m) => m * mag).find((t) => t >= raw) || raw;
  let nextTick = 0;
  for (let k = 0; k < N; k++) {
    const d = (total * k) / (N - 1);
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const t = seg[i - 1] ? (d - cum[i - 1]) / seg[i - 1] : 0;
    const lon = L[i - 1][0] + (L[i][0] - L[i - 1][0]) * t, lat = L[i - 1][1] + (L[i][1] - L[i - 1][1]) * t;
    vals.push(Math.round(sample(lon, lat)));
    if (d + 1e-9 >= nextTick) { labels.push(String(Math.round(nextTick * 10) / 10)); nextTick += tick; } else labels.push('');
  }
  if (viewer) viewer.setProfile(onModel ? L : null);
  $('profileBox').hidden = false;
  status(onModel ? '단면도를 그렸습니다. 3D 위에도 A–B 선이 있습니다.' : '단면도를 그렸습니다' + (viewer ? '(3D 범위 밖이라 3D 위에는 선을 그리지 않았습니다).' : '.'));
  if (typeof CsatChart === 'undefined') { status('그래프 라이브러리를 불러오지 못했습니다.'); return; }
  fontsReady = fontsReady || CsatChart.ensureFonts().catch(() => false);
  await fontsReady;
  // 그래프 본체는 csat-chart.js(시험지 양식)가 화면 밖 캔버스에 그리고, 해수면·각주·출처는 composeProfile 이 덧그린다
  const seaLv = viewer ? viewer.seaLevel : 0;
  const km = vals.map((v) => Math.round(v) / 1000);
  const crossesSea = Math.min(...vals) < seaLv;
  const axis = CsatChart.autoRange(crossesSea ? km.concat([seaLv / 1000]) : km, 6);
  const data = CsatChart.createDefaultLineData();
  data.series = [{ label: '', values: km, areaFill: '#dcd9d2', stroke: '#111' }];
  data.xLabels = labels; data.xUnit = '(km)'; data.yUnit = '(km)';
  data.yRange = { min: axis.min, max: axis.max, step: axis.step, auto: false };
  data.showMarkers = false; data.zeroBaseline = false;
  data.labelPlacement = 'lineEnd';
  data.xGrid = true; data.gridColor = '#555'; data.gridWidth = 1;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  if (profile && profile.chart) profile.chart.destroy();
  profile = {
    data, chart: null, titleOn: null, axis, seaKm: crossesSea ? seaLv / 1000 : null, geo: null,
    notes: [
      `가로축은 A 로부터의 거리, A–B 는 약 ${Math.round(total).toLocaleString()} km 임.`,
      `가장 높은 곳은 ${hi.toLocaleString()} m, 가장 낮은 곳은 ${lo.toLocaleString()} m 임${crossesSea ? `(해수면 ${seaLv} m 기준)` : ''}.`,
    ],
  };
  $('pfSea').disabled = !crossesSea;
  await composeProfile($('profileChart'), 1);
  $('profileBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 그래프 틀(검은 사각) 찾기: 왼쪽 틀선은 x≈130, 위 틀선은 제목이 있으면 y≈100 (LineGraph 의 padding).
// 아래·오른쪽 끝은 그 선을 따라가며 어두운 픽셀이 끊기는 곳으로 잰다
const PROFILE_W = 900, PROFILE_H = 520;
const SANS = "'HY중고딕', 'HYGothic-Medium', '돋움', 'Dotum', 'Noto Sans KR', sans-serif";
function plotBox(cv, top) {
  const { width: W, height: H } = cv, px = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const dark = (x, y) => { const i = (y * W + x) * 4; return px[i] + px[i + 1] + px[i + 2] < 330; };
  let bestX = 130, bestLen = 0;
  for (let x = 124; x <= 136; x++) { let y = top + 2; while (y < H && dark(x, y)) y++; if (y - top > bestLen) { bestLen = y - top; bestX = x; } }
  let bestY = top, right = 0;
  for (let y = top - 3; y <= top + 3; y++) { let x = bestX + 2; while (x < W && dark(x, y)) x++; if (x > right) { right = x; bestY = y; } }
  return { left: bestX, top: bestY, right: right - 1, bottom: top + bestLen };
}
// 보이는 캔버스(또는 PNG 용 큰 캔버스)에 그래프 + 해수면 점선·세로 이름 + 각주(같은 크기, 켜고 끄기) + 출처
async function composeProfile(out, scale) {
  const P = profile;
  const on = (id) => $(id).checked;
  // 제목을 켜고 끄면 그래프 틀 위치가 바뀌므로(위 여백 100 ↔ 50) 그래프를 다시 그린다
  if (P.titleOn !== on('pfTitle')) {
    if (P.chart) P.chart.destroy();
    P.titleOn = on('pfTitle');
    const cv = Object.assign(document.createElement('canvas'), { width: PROFILE_W, height: PROFILE_H });
    P.chart = new CsatChart(cv, { type: 'line', data: P.data, options: { title: P.titleOn ? '지형 단면도 (A–B)' : '' } });
    P.geo = plotBox(cv, P.titleOn ? 100 : 50);
  }
  const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = P.chart.toDataURL({ scale }); });
  const W = PROFILE_W, notesOn = on('profileNotes');
  const m = document.createElement('canvas').getContext('2d');
  // 각주는 줄마다 폭에 맞춘 크기 중 가장 작은 것 하나로 통일
  const room = W - 60;
  let fs = 30;
  for (const [i, t] of P.notes.entries()) { // 각주를 꺼도 출처는 같은 크기로
    const text = '* '.repeat(i + 1) + t;
    m.font = `${fs}px ${SANS}`;
    while (fs > 14 && m.measureText(text).width > room) { fs--; m.font = `${fs}px ${SANS}`; }
  }
  const lineH = fs + 10, srcText = 'AWS Terrain Tiles';
  const extra = notesOn ? 8 + P.notes.length * lineH : 0;
  const srcH = lineH;
  const H = PROFILE_H + extra + srcH;
  out.width = W * scale; out.height = H * scale;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, 0, 0);
  ctx.save(); ctx.scale(scale, scale);
  const g = P.geo;
  if (P.seaKm !== null && on('pfSea')) {
    const y = g.bottom - ((P.seaKm - P.axis.min) / (P.axis.max - P.axis.min)) * (g.bottom - g.top);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1.6; ctx.setLineDash([9, 6]);
    ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.setLineDash([]);
    // 「해수면」 — 점선 오른쪽 끝(선 끝 이름 자리)에 작은 글자로
    ctx.fillStyle = '#000'; ctx.font = `20px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('해수면', g.right + 8, y);
  }
  if (on('pfAxis')) {
    // 세로축 이름 「해발고도」 — 제목(csat-chart exam: 고딕 40px)과 같은 크기로, 눈금 숫자 바깥 왼쪽에 세로쓰기
    const f = 40, chars = [...'해발고도'], step = f * 1.08, mid = (g.top + g.bottom) / 2;
    ctx.fillStyle = '#000'; ctx.font = `${f}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    chars.forEach((c, i) => ctx.fillText(c, 28, mid - (step * chars.length) / 2 + step * (i + 0.5)));
  }
  // 단면선 양 끝 A·B — 지도·3D 의 A·B 와 같은 끝을 그래프 틀 안쪽 위 모서리에(왼쪽 위 단위와 겹치지 않게)
  ctx.fillStyle = '#000'; ctx.font = `30px ${SANS}`; ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; ctx.fillText('A', g.left + 8, g.top + 6);
  ctx.textAlign = 'right'; ctx.fillText('B', g.right - 8, g.top + 6);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic';
  let y = PROFILE_H + 4;
  if (notesOn) {
    ctx.font = `${fs}px ${SANS}`; ctx.textAlign = 'left';
    P.notes.forEach((t, i) => { y += lineH; ctx.fillText('* '.repeat(i + 1) + t, 30, y - 8); });
  }
  ctx.font = `${fs}px ${SANS}`; ctx.textAlign = 'right';
  ctx.fillText(srcText, W - 30, y + lineH - 8);
  ctx.restore();
  return out;
}
['pfTitle', 'pfAxis', 'pfSea', 'profileNotes'].forEach((id) => $(id).addEventListener('change', () => { if (profile) composeProfile($('profileChart'), 1); }));
$('profilePng').addEventListener('click', async () => {
  if (!profile) return;
  const big = await composeProfile(document.createElement('canvas'), 2);
  const a = document.createElement('a');
  a.href = big.toDataURL('image/png'); a.download = fileName('_단면도.png').replace('3D지형_', '단면도_');
  document.body.appendChild(a); a.click(); a.remove();
});
$('profileClose').addEventListener('click', () => { $('profileBox').hidden = true; sel.showProfile(null); if (viewer) viewer.setProfile(null); });

// 시나리오 3D: 모든 프레임을 덮는 구역 하나로 지형을 만들고, 프레임마다 덮을 자료만 바꾼다
$('scenSel').addEventListener('change', (e) => { $('scenBuild').disabled = e.target.value === ''; });
// 초록 영역은 지형 고도색에 묻히므로 3D 에서는 보라로
const on3D = (c) => (/^#(2e7d4f|7cb342)$/i.test(c) ? '#6a3d9a' : c);
const frameFC = (sc, k) => {
  const f = sc.frames[k], feats = [];
  for (const st of sc.static || []) feats.push({ type: 'Feature', properties: { _t: 'area', name: st.label, color: st.color }, geometry: st.geometry });
  for (const L0 of sc.layers) if (f.areas[L0.key]) feats.push({ type: 'Feature', properties: { _t: 'area', name: L0.label, color: on3D(L0.color) }, geometry: f.areas[L0.key] });
  for (const r of f.routes || []) feats.push({ type: 'Feature', properties: { _t: 'line', name: r.name }, geometry: r.geometry });
  return { type: 'FeatureCollection', features: feats };
};
function showFrame(k) {
  scen.k = k;
  last.overlay = prepareOverlay(frameFC(scen.sc, k), last.grid.bbox, PALETTE);
  viewer.setOverlay(last.overlay);
  $('scenCap').textContent = `${k + 1} / ${scen.sc.frames.length} · ${scen.sc.frames[k].label}`;
}
function stopScenario(leave) {
  if (!scen) return;
  clearTimeout(scen.timer); scen.timer = null; $('scenPlay').textContent = '재생'; $('scenPlay').classList.add('ghost');
  if (leave) { scen = null; $('scenCtl').hidden = true; $('scenCap').textContent = ''; }
}
$('scenBuild').addEventListener('click', async () => {
  const sc = scenarios[+$('scenSel').value];
  if (!sc) return;
  stopScenario(true);
  const geoms = [];
  for (const f of sc.frames) { Object.values(f.areas).forEach((g) => geoms.push(g.coordinates)); (f.routes || []).forEach((r) => geoms.push(r.geometry.coordinates)); }
  (sc.static || []).forEach((st) => geoms.push(st.geometry.coordinates));
  const box = boxAround(geoms, 0.06);
  sel.setRegion(box, sc.title);
  const ok = await make(box, sc.title, (bbox) => prepareOverlay(frameFC(sc, 0), bbox, PALETTE));
  if (!ok) return;
  scen = { sc, k: 0, timer: null };
  $('scenCtl').hidden = false;
  showFrame(0);
});
const step = (d) => { if (scen) showFrame((scen.k + d + scen.sc.frames.length) % scen.sc.frames.length); };
$('scenPrev').addEventListener('click', () => { stopScenario(); step(-1); });
$('scenNext').addEventListener('click', () => { stopScenario(); step(1); });
$('scenPlay').addEventListener('click', () => {
  if (!scen) return;
  if (scen.timer) { stopScenario(); return; }
  $('scenPlay').textContent = '멈춤'; $('scenPlay').classList.remove('ghost');
  const tick = () => { step(1); scen.timer = setTimeout(tick, 2600); };
  if (scen.k === scen.sc.frames.length - 1) showFrame(0);
  scen.timer = setTimeout(tick, 1200);
});

// 크게 보기: 지도·3D 를 창 가득. 3D 를 키우면 보기 칸(4)을 화면 안으로 옮겨 온다. Esc 로 돌아오기
const panelHome = document.createComment('viewPanel');
$('viewPanel').before(panelHome);
function toggleMax(id, on) {
  const box = $(id);
  on = on ?? !box.classList.contains('t-maxed');
  document.querySelectorAll('.t-maxed').forEach((b) => { if (b !== box) toggleMax(b.id, false); });
  box.classList.toggle('t-maxed', on);
  document.body.classList.toggle('t-noscroll', on);
  box.querySelector('.t-max-btn').textContent = on ? '작게 보기' : '크게 보기';
  if (id === 'viewWrap') {
    $('viewDock').hidden = !on;
    if (on) $('viewDock').appendChild($('viewPanel')); else panelHome.after($('viewPanel'));
  }
  setTimeout(() => sel.invalidate(), 60);
}
document.querySelectorAll('.t-max-btn').forEach((b) => b.addEventListener('click', () => toggleMax(b.dataset.max)));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = document.querySelector('.t-maxed'); if (m) toggleMax(m.id, false); } });

// 지도·3D 모형 창 접고 펴기(상태 기억). 접힌 창은 머리글만 남고 다른 창이 자리를 채운다
function setFold(id, folded) {
  const box = $(id), b = box.querySelector('.t-fold');
  box.classList.toggle('t-folded', folded);
  b.textContent = folded ? '펴기' : '접기';
  b.setAttribute('aria-expanded', String(!folded));
  document.querySelector('.t-stage').classList.toggle(id === 'selWrap' ? 'sel-folded' : 'view-folded', folded);
  try { localStorage.setItem('sa-terrain-fold-' + id, folded ? '1' : '0'); } catch { /* 저장 불가 */ }
  if (!folded) setTimeout(() => sel.invalidate(), 60);
}
document.querySelectorAll('.t-fold').forEach((b) => {
  const id = b.dataset.fold;
  let saved = null;
  try { saved = localStorage.getItem('sa-terrain-fold-' + id); } catch { /* 저장 불가 */ }
  if (saved === '1') setFold(id, true);
  b.addEventListener('click', () => setFold(id, !$(id).classList.contains('t-folded')));
});

// HTML 내보내기: 지금 덮은 자료·높이 과장·해수면·(기억한) 시점 그대로
$('export').addEventListener('click', async () => {
  if (!last || !viewer) return;
  $('export').disabled = true;
  status('HTML 파일을 만드는 중…');
  try {
    const html = await buildHTML({ ...last, exag: viewer.exag, seaLevel: viewer.seaLevel, view: savedView || viewer.getView() });
    download(fileName('.html'), html);
    status(`내보냈습니다 (${(html.length / 1e6).toFixed(1)} MB).`);
  } catch (e) {
    console.error('[3D]', e);
    status('내보내지 못했습니다: ' + e.message);
  } finally {
    $('export').disabled = false;
  }
});

// 사이드바 칸 접고 펴기 상태를 기억(브라우저 저장이 막혀 있어도 동작)
document.querySelectorAll('.t-sec').forEach((d) => {
  const key = 'sa-terrain-sec' + d.dataset.sec;
  try { const v = localStorage.getItem(key); if (v !== null) d.open = v === '1'; } catch { /* 저장 불가 */ }
  d.addEventListener('toggle', () => { try { localStorage.setItem(key, d.open ? '1' : '0'); } catch { /* 저장 불가 */ } });
});
syncViewUI();
// 확인용 훅(헤드리스 캡처)
window.__terrain = { sel, setOverlayMap, build: () => $('build').click(), get last() { return last; }, get viewer() { return viewer; }, buildHTML, drawProfile, toggleMax };
