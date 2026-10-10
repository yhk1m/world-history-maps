// © 2026 김용현
// 행정구역 탐색 — 연도·단위·범위를 골라 남북한 경계를 그리고, 앞 해와 바뀐 곳을 칠한다
import {
  LEVEL_LABEL, isRegionLevel, changePairFor, changedSets, unitChange, pairHasChanges, splitRename,
  downloadName, displayName, sphericalAreaKm2, formatKm2, searchUnits, stepYear,
} from './logic.js';

const L = window.L;
const $ = (id) => document.getElementById(id);
const BASE = 'data/admin/';
const PALETTE = ['#b3261e', '#1f4e79', '#6a3d9a', '#b8860b', '#c2185b', '#00838f', '#5d4037', '#455a64', '#2e7d4f'];
const ACCENT = '#b3261e';
const STORE = 'sa-admin-state';
const PLAY_MS = 1600;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let idx = null;
const state = { year: 2025, level: 'sigungu', kr: true, kp: true, base: true, diff: false };
const cache = new Map();
let map, baseLayer, layers = [], renderSeq = 0, playTimer = null;
let selKey = null, hoverLayer = null;
let shown = { kr: null, kp: null }; // 지금 그려진 FeatureCollection

// ── 저장(없어도 동작) ──
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && typeof s === 'object') {
      if (idx.years.includes(Number(s.year))) state.year = Number(s.year);
      if (idx.levels.includes(s.level)) state.level = s.level;
      for (const k of ['kr', 'kp', 'base', 'diff']) if (typeof s[k] === 'boolean') state[k] = s[k];
    }
  } catch { /* 저장소를 못 씀 */ }
}
function saveState() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* 저장소를 못 씀 */ }
}

function fetchJSON(path) {
  if (!cache.has(path)) {
    const p = fetch(BASE + path).then((r) => { if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

// 단위별로 실제로 그릴 범위: 7대 권역은 남한만, 전통 지역 구분은 한 파일에 남북이 함께
function scopes() {
  if (state.level === 'region7') return { kr: state.kr, kp: false };
  if (state.level === 'regiontrad') return { kr: true, kp: true };
  return { kr: state.kr, kp: state.kp };
}
function sourcesFor() {
  const f = idx.files[state.year];
  const sc = scopes();
  const out = [];
  if (state.level === 'regiontrad') out.push({ who: 'kr', path: f.kr_regiontrad });
  else {
    if (sc.kp && !isRegionLevel(state.level)) out.push({ who: 'kp', path: idx.kp[state.level] });
    if (sc.kr) out.push({ who: 'kr', path: f['kr_' + state.level] });
  }
  return out;
}

const regionColor = (level, name) => {
  const t = idx.regions[level]?.table || [];
  const i = t.findIndex((r) => r.name === name);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
};
const isNorth = (layer) => layer.feature.__who === 'kp';
const labelOf = (p) => (isRegionLevel(p.level) ? p.name : displayName(p));
const keyOf = (p) => `${p.level}|${labelOf(p)}`;

// ── 바뀐 곳 묶음 ──
function diffSets() {
  if (!state.diff) return null;
  const pair = changePairFor(idx.changes, state.year);
  return pair ? { pair, sets: changedSets(pair, state.level) } : null;
}
let curDiff = null;

function baseStyle(feature) {
  const p = feature.properties;
  const north = feature.__who === 'kp';
  let st;
  if (isRegionLevel(p.level)) st = { color: '#3a3a3a', weight: 1, fillColor: regionColor(p.level, p.name), fillOpacity: 0.25 };
  else if (p.level === 'sido') st = { color: north ? '#555' : '#2a2a2a', weight: 1.1, fillColor: '#fff', fillOpacity: 0.5 };
  else st = { color: north ? '#666' : '#3a3a3a', weight: 0.6, fillColor: '#fff', fillOpacity: 0.5 };
  st.dashArray = null; st.opacity = 1;
  if (curDiff && !north) {
    const kind = unitChange(p, p.level, curDiff.sets);
    if (kind === 'added') Object.assign(st, { fillColor: ACCENT, fillOpacity: 0.35, color: '#7a1a14', weight: 1.8 });
    else if (kind === 'renamed') Object.assign(st, { color: ACCENT, weight: 1.8, dashArray: '5 4' });
  }
  if (keyOf(p) === selKey) Object.assign(st, { color: '#111', weight: 3, dashArray: null });
  return st;
}
function restyle(layer) {
  layer.setStyle(baseStyle(layer.feature));
  if (layer === hoverLayer) layer.setStyle({ color: '#111', weight: Math.max(2.2, baseStyle(layer.feature).weight + 1.4) });
}
function restyleAll() { forEachFeatureLayer(restyle); bringSelectedFront(); }
function forEachFeatureLayer(fn) { for (const g of layers) g.eachLayer(fn); }
function bringSelectedFront() { forEachFeatureLayer((l) => { if (keyOf(l.feature.properties) === selKey) l.bringToFront(); }); }

function tipHTML(layer) {
  const p = layer.feature.properties;
  let sub = '';
  if (isRegionLevel(p.level)) sub = (p.members || []).join(' · ');
  else if (layer.feature.__who === 'kp') sub = `북한 ${LEVEL_LABEL[p.level]}${p.en && p.en !== p.name ? ' · ' + p.en : ''}`;
  else sub = LEVEL_LABEL[p.level];
  let ch = '';
  if (curDiff && layer.feature.__who !== 'kp') {
    const kind = unitChange(p, p.level, curDiff.sets);
    if (kind === 'added') ch = `<small>${curDiff.pair.to}년에 새로 생김</small>`;
    else if (kind === 'renamed') {
      const from = curDiff.sets.renamedFrom.get(p.full);
      ch = `<small>${from ? `이름·소속 바뀜: ${esc(from)} →` : '구성 시·도의 이름·경계가 바뀜'}</small>`;
    }
  }
  return `<b>${esc(labelOf(p))}</b><small>${esc(sub)}</small>${ch}`;
}

// ── 그리기 ──
async function render({ fit = false } = {}) {
  const seq = ++renderSeq;
  const srcs = sourcesFor();
  $('mapStatus').textContent = '경계를 불러오는 중…';
  let data;
  try {
    data = await Promise.all(srcs.map((s) => fetchJSON(s.path).then((g) => ({ ...s, g }))));
  } catch (e) {
    if (seq === renderSeq) $('mapStatus').textContent = '경계 파일을 불러오지 못했습니다.';
    return;
  }
  if (seq !== renderSeq) return;
  $('mapStatus').textContent = '';
  for (const g of layers) g.remove();
  layers = []; hoverLayer = null;
  shown = { kr: null, kp: null };
  curDiff = diffSets();
  // 북한을 먼저(아래 칸), 남한을 위 칸에 — 비무장지대에서 겹치는 부분은 남한 경계가 위로
  for (const d of data) {
    shown[d.who] = d.g;
    const g = L.geoJSON(d.g, {
      pane: d.who === 'kp' ? 'kpPane' : 'krPane',
      style: (f) => { f.__who = d.who; return baseStyle(f); },
      onEachFeature: (f, layer) => {
        f.__who = d.who;
        layer.bindTooltip(() => tipHTML(layer), { sticky: true, className: 'a-tip', direction: 'top', offset: [0, -8] });
        layer.on('mouseover', () => { const prev = hoverLayer; hoverLayer = layer; if (prev) restyle(prev); restyle(layer); if (keyOf(f.properties) !== selKey) layer.bringToFront(); bringSelectedFront(); });
        layer.on('mouseout', () => { if (hoverLayer === layer) hoverLayer = null; restyle(layer); });
        layer.on('click', () => select(layer, false));
      },
    }).addTo(map);
    layers.push(g);
  }
  // 고른 곳 이어 보기
  let selLayer = null;
  if (selKey) forEachFeatureLayer((l) => { if (keyOf(l.feature.properties) === selKey) selLayer = l; });
  if (selLayer) showInfo(selLayer); else if (selKey) clearInfo(true);
  bringSelectedFront();
  if (fit) fitPeninsula();
  updateDiffPanel();
  updateLegend();
  updateDownloads();
  runSearch();
}

function fitPeninsula() {
  map.fitBounds(L.latLngBounds([33.0, 124.4], [43.05, 130.95]), { padding: [10, 10] });
}

// ── 고르기 · 정보 ──
function select(layer, zoom) {
  selKey = keyOf(layer.feature.properties);
  restyleAll();
  showInfo(layer);
  if (zoom) map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 10 });
  document.querySelectorAll('#qList button').forEach((b) => b.classList.toggle('on', b.dataset.key === selKey));
}
function clearInfo(gone) {
  $('info').innerHTML = gone
    ? '<p class="a-help">고른 곳이 이 연도·단위·범위에는 없습니다. 지도에서 다시 고르세요.</p>'
    : '<p class="a-help">지도에서 한 곳을 누르거나 검색해 고르세요.</p>';
}
function showInfo(layer) {
  const f = layer.feature;
  const p = f.properties;
  const north = f.__who === 'kp';
  const rows = [];
  rows.push(['단위', `${north ? '북한 ' : ''}${LEVEL_LABEL[p.level]}`]);
  if (p.en && p.en !== p.name) rows.push(['영문', p.en]);
  if (p.level === 'sigungu' && p.sido) rows.push(['상위', p.sido]);
  if (!isRegionLevel(p.level)) rows.push(['코드', p.code || '—']);
  if (north) rows.push(['시점', idx.kp.asOf]);
  else rows.push(['연도', `${p.year ?? state.year} (경계 기준일 ${fmtVer(idx.source.kr.versions[state.year])})`]);
  rows.push(['넓이', `약 ${formatKm2(sphericalAreaKm2(f.geometry))}`]);
  if (isRegionLevel(p.level)) rows.push(['구성', (p.members || []).join(', ')]);
  if (curDiff && !north) {
    const kind = unitChange(p, p.level, curDiff.sets);
    if (kind === 'added') rows.push(['변경', `${curDiff.pair.from} → ${curDiff.pair.to} 새로 생김`]);
    if (kind === 'renamed') rows.push(['변경', curDiff.sets.renamedFrom.get(p.full) ? `${curDiff.sets.renamedFrom.get(p.full)}에서 바뀜` : '구성 시·도 변경']);
  }
  $('info').innerHTML = `<p class="a-name">${esc(labelOf(p))}</p><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="a-help">넓이는 단순화한 경계로 구면에서 잰 값이라 공식 면적과 조금 다릅니다.</p>`;
}
const fmtVer = (v) => (v ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '—');

// ── 바뀐 곳 목록 ──
function zoomTo(full) {
  let hit = null;
  forEachFeatureLayer((l) => { if (labelOf(l.feature.properties) === full) hit = l; });
  if (hit) select(hit, true);
}
function listHTML(title, sw, items, clickable) {
  if (!items.length) return '';
  const li = (s) => {
    const name = clickable ? splitRename(s)[1] : null;
    return `<li>${clickable ? `<button data-full="${esc(name)}">${esc(s)}</button>` : esc(s)}</li>`;
  };
  const head = items.slice(0, 8).map(li).join('');
  const rest = items.length > 8 ? `<details><summary>나머지 ${items.length - 8}개</summary><ul>${items.slice(8).map(li).join('')}</ul></details>` : '';
  return `<h4><i class="a-sw ${sw}"></i>${title} <small>${items.length}</small></h4><ul>${head}</ul>${rest}`;
}
function updateDiffPanel() {
  const box = $('diffBox');
  box.hidden = !state.diff;
  if (!state.diff) return;
  const pair = changePairFor(idx.changes, state.year);
  if (!pair) { box.innerHTML = `<h3>${state.year}</h3><p class="a-help">${state.year}년은 자료의 첫 해라 비교할 앞 해가 없습니다. 연도를 옮겨 보세요.</p>`; return; }
  let html = `<h3>${pair.from} → ${pair.to}</h3><p class="a-help a-mono">${fmtVer(pair.fromVersion)} → ${fmtVer(pair.toVersion)}</p>`;
  if (!pairHasChanges(pair)) html += '<p class="a-help">바뀐 행정구역이 없습니다.</p>';
  else {
    html += listHTML('새로 생김', '', pair.added, true);
    html += listHTML('이름·소속 바뀜', 'ren', pair.renamed, true);
    html += listHTML('없어짐', 'rem', pair.removed, false);
    if (isRegionLevel(state.level)) html += '<p class="a-help">권역 단위에서는 이름이 바뀌었거나 새로 생긴 시·도를 품은 권역을 칠합니다.</p>';
    else if (state.level === 'sido') html += '<p class="a-help">시·도 단위에서는 시·도의 변경만 칠합니다. 시·군·구 변경은 「시·군·구」에서 보세요.</p>';
  }
  html += '<p class="a-help">북한 경계는 한 시점뿐이라 비교하지 않습니다.</p>';
  box.innerHTML = html;
}
function buildHistory() {
  const host = $('histList');
  host.innerHTML = idx.changes.map((c) => {
    const n = { a: c.added.length, r: c.removed.length, m: c.renamed.length };
    const empty = !pairHasChanges(c);
    const sum = empty ? '바뀐 곳 없음' : `생김 ${n.a} · 없어짐 ${n.r} · 바뀜 ${n.m}`;
    const body = empty ? '' : listHTML('새로 생김', '', c.added, false) + listHTML('이름·소속 바뀜', 'ren', c.renamed, false) + listHTML('없어짐', 'rem', c.removed, false)
      + `<p><button class="btn ghost a-small" data-goto="${c.to}">${c.to}년 지도에서 보기</button></p>`;
    return `<details${empty ? ' data-empty' : ''}><summary>${c.from} → ${c.to}<small>${sum}</small></summary>${body}</details>`;
  }).join('');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (!b) return;
    state.diff = true; $('diffOn').checked = true;
    setYear(Number(b.dataset.goto));
  });
}
function updateLegend() {
  const lg = $('legend');
  if (!curDiff) { lg.hidden = true; return; }
  let a = 0, r = 0;
  forEachFeatureLayer((l) => {
    if (l.feature.__who === 'kp') return;
    const k = unitChange(l.feature.properties, state.level, curDiff.sets);
    if (k === 'added') a++; else if (k === 'renamed') r++;
  });
  lg.innerHTML = `<b>${curDiff.pair.from} → ${curDiff.pair.to}</b><span><i class="a-sw"></i>새로 생김 ${a}</span><span><i class="a-sw ren"></i>이름·소속 바뀜 ${r}</span>`;
  lg.hidden = false;
}

// ── 검색 ──
function searchItems() {
  const items = [];
  forEachFeatureLayer((l) => {
    const p = l.feature.properties;
    const north = l.feature.__who === 'kp';
    items.push({ name: p.name, full: p.full, en: p.en, label: labelOf(p), key: keyOf(p), layer: l,
      sub: isRegionLevel(p.level) ? (p.members || []).join(' · ') : `${north ? '북한 ' : ''}${LEVEL_LABEL[p.level]}` });
  });
  return items;
}
function runSearch() {
  const q = $('q').value;
  const ul = $('qList');
  if (!q.trim()) { ul.innerHTML = ''; return; }
  const hits = searchUnits(searchItems(), q, 60);
  ul.innerHTML = hits.length
    ? hits.map((h) => `<li><button data-key="${esc(h.key)}" class="${h.key === selKey ? 'on' : ''}">${esc(h.label)}<small>${esc(h.sub)}</small></button></li>`).join('')
    : `<li class="a-none">${state.year}년 ${LEVEL_LABEL[state.level]}에서 찾지 못했습니다.</li>`;
}

// ── 내려받기 ──
function currentFC() {
  const feats = [];
  for (const who of ['kr', 'kp']) {
    const g = shown[who];
    if (g) for (const f of g.features) feats.push({ type: 'Feature', properties: { ...f.properties, country: who === 'kp' ? '북한' : (state.level === 'regiontrad' ? undefined : '대한민국') }, geometry: f.geometry });
  }
  return feats;
}
function updateDownloads() {
  const sc = scopes();
  const name = downloadName(state.year, state.level, sc);
  $('dlName').textContent = name;
  $('dl').disabled = !(shown.kr || shown.kp);
  const f = idx.files[state.year];
  const rows = [
    [f.kr_sido, `${state.year} 대한민국 시·도`], [f.kr_sigungu, `${state.year} 대한민국 시·군·구`],
    [f.kr_region7, `${state.year} 국토 7대 권역`], [f.kr_regiontrad, `${state.year} 전통 지역 구분(남북)`],
    [idx.kp.sido, '북한 시·도'], [idx.kp.sigungu, '북한 시·군·구'],
  ];
  $('rawLinks').innerHTML = rows.map(([p, t]) => `<li><a href="${BASE}${esc(p)}" download>${esc(t)}</a> <small>${esc(p)}</small></li>`).join('')
    + '<li><a href="data/admin/index.json">목록·변경 기록(index.json)</a></li>';
}
function download() {
  const fc = {
    type: 'FeatureCollection',
    name: `행정구역 ${state.year} ${LEVEL_LABEL[state.level]}`,
    attribution: [shown.kr ? idx.source.kr.attribution : null, (shown.kp || state.level === 'regiontrad') ? idx.source.kp.attribution : null].filter(Boolean),
    features: currentFC(),
  };
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = downloadName(state.year, state.level, scopes());
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── 조절 ──
function syncControls() {
  const i = idx.years.indexOf(state.year);
  $('yearRange').value = String(i);
  $('yearLabel').textContent = state.year;
  $('yearVer').textContent = `경계 기준일 ${fmtVer(idx.source.kr.versions[state.year])}`;
  $('yearPrev').disabled = i <= 0;
  $('yearNext').disabled = i >= idx.years.length - 1;
  document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('on', b.dataset.level === state.level));
  const region7 = state.level === 'region7', trad = state.level === 'regiontrad';
  $('scopeKr').checked = trad ? true : state.kr;
  $('scopeKr').disabled = trad;
  $('scopeKp').checked = region7 ? false : (trad ? true : state.kp);
  $('scopeKp').disabled = region7 || trad;
  $('scopeKr').closest('label').classList.toggle('is-off', trad);
  $('scopeKp').closest('label').classList.toggle('is-off', region7 || trad);
  $('scopeNote').textContent = region7
    ? '국토 7대 권역은 대한민국만 나눕니다.'
    : trad
      ? `전통 지역 구분 파일은 남북을 함께 담습니다(해서·관서·관북은 북한, 관동은 남북 강원). 북한 부분의 시점: ${idx.kp.asOf}.`
      : (state.kp ? `북한 경계는 한 시점뿐이라 연도를 바꿔도 같습니다(${idx.kp.asOf}).` : '');
  const reg = idx.regions[state.level];
  $('levelNote').textContent = reg
    ? reg.table.map((r) => r.name).join(' · ') + (reg.note ? ` — ${reg.note}` : '')
    : `${state.year}년 대한민국 ${LEVEL_LABEL[state.level]} ${idx.counts[state.year]?.[state.level] ?? ''}개 · 북한 ${idx.kp.counts[state.level]}개`;
  $('baseOn').checked = state.base;
  $('diffOn').checked = state.diff;
}
function setYear(y) {
  if (!idx.years.includes(y)) return;
  state.year = y;
  saveState(); syncControls(); render();
}
function stopPlay() {
  clearInterval(playTimer); playTimer = null;
  const b = $('yearPlay');
  b.textContent = '재생'; b.classList.add('ghost'); b.setAttribute('aria-pressed', 'false');
}
function startPlay() {
  const b = $('yearPlay');
  b.textContent = '멈춤'; b.classList.remove('ghost'); b.setAttribute('aria-pressed', 'true');
  playTimer = setInterval(() => setYear(stepYear(idx.years, state.year, 1, true)), PLAY_MS);
}

function wire() {
  $('yearRange').max = String(idx.years.length - 1);
  $('yearMin').textContent = idx.years[0];
  $('yearMax').textContent = idx.years[idx.years.length - 1];
  $('yearRange').addEventListener('input', (e) => setYear(idx.years[Number(e.target.value)]));
  $('yearPrev').addEventListener('click', () => { stopPlay(); setYear(stepYear(idx.years, state.year, -1)); });
  $('yearNext').addEventListener('click', () => { stopPlay(); setYear(stepYear(idx.years, state.year, 1)); });
  $('yearPlay').addEventListener('click', () => (playTimer ? stopPlay() : startPlay()));
  $('levels').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (!b || b.dataset.level === state.level) return;
    state.level = b.dataset.level;
    saveState(); syncControls(); render();
  });
  for (const [id, k] of [['scopeKr', 'kr'], ['scopeKp', 'kp']]) {
    $(id).addEventListener('change', (e) => { state[k] = e.target.checked; saveState(); syncControls(); render(); });
  }
  $('baseOn').addEventListener('change', (e) => {
    state.base = e.target.checked; saveState();
    if (state.base) baseLayer.addTo(map); else baseLayer.remove();
  });
  $('diffOn').addEventListener('change', (e) => { state.diff = e.target.checked; saveState(); render(); });
  $('diffBox').addEventListener('click', (e) => { const b = e.target.closest('button[data-full]'); if (b) zoomTo(b.dataset.full); });
  $('q').addEventListener('input', runSearch);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('qList').querySelector('button')?.click(); });
  $('qList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    let hit = null;
    forEachFeatureLayer((l) => { if (keyOf(l.feature.properties) === b.dataset.key) hit = l; });
    if (hit) select(hit, true);
  });
  $('dl').addEventListener('click', download);
}

function fillSources() {
  $('srcKr').textContent = idx.source.kr.attribution;
  $('srcKp').textContent = idx.source.kp.attribution;
  $('srcRegion').textContent = `권역(국토 7대 권역·전통 지역 구분)은 해마다 시·도 경계를 e-GIS 병합(디졸브) 방식으로 합쳐 만들었습니다: ${idx.regions.method}.`;
  $('srcProc').textContent = `가공: ${idx.source.processing}`;
}

async function main() {
  map = L.map('map', { zoomSnap: 0.25, minZoom: 5, maxZoom: 13, worldCopyJump: false });
  map.createPane('kpPane').style.zIndex = 410;
  map.createPane('krPane').style.zIndex = 420;
  baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, opacity: 0.45, className: 'a-base', attribution: '© OpenStreetMap contributors',
  });
  fitPeninsula();
  try {
    idx = await fetch(BASE + 'index.json').then((r) => r.json());
  } catch {
    $('mapStatus').textContent = '목록(index.json)을 불러오지 못했습니다.';
    return;
  }
  state.year = idx.years.includes(2025) ? 2025 : idx.years[idx.years.length - 1];
  loadState();
  if (state.base) baseLayer.addTo(map);
  wire();
  fillSources();
  buildHistory();
  syncControls();
  render({ fit: true });
}
main();
