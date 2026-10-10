// © 2026 김용현
// 행정구역 탐색 — 화면과 상관없는 순수 계산(바뀐 곳 묶음 · 파일 이름 · 넓이 · 검색)

export const LEVEL_LABEL = {
  region7: '국토 7대 권역',
  regiontrad: '전통 지역 구분',
  sido: '시·도',
  sigungu: '시·군·구',
};
const LEVEL_FILE = { region7: '국토7대권역', regiontrad: '전통지역구분', sido: '시도', sigungu: '시군구' };
export const REGION_LEVELS = ['region7', 'regiontrad'];
export const isRegionLevel = (level) => REGION_LEVELS.includes(level);

/** 그 해(to)로 넘어오는 변경 묶음 하나. 없으면 null */
export function changePairFor(changes, year) {
  return (changes || []).find((c) => Number(c.to) === Number(year)) || null;
}

/** "갑 → 을" 문자열을 [갑, 을] 로 */
export function splitRename(s) {
  const i = s.indexOf(' → ');
  return i < 0 ? [s, s] : [s.slice(0, i), s.slice(i + 3)];
}

/**
 * 한 쌍(from→to)의 변경에서 지금 단위(level)의 지도에 칠할 이름 묶음.
 * added: 새로 생긴 단위(새해 이름), renamed: 이름이 바뀐 단위(새해 이름),
 * removed: 없어진 단위(옛 이름, 목록용).
 * 권역 단위는 시·도 변경을 쓰고, 권역 칠하기는 regionTouched 로 판단한다.
 */
export function changedSets(pair, level) {
  const out = { added: new Set(), renamed: new Set(), removed: new Set(), renamedFrom: new Map() };
  if (!pair) return out;
  const key = level === 'sigungu' ? 'sigungu' : 'sido';
  const part = pair[key] || {};
  for (const a of part.added || []) out.added.add(a.full);
  for (const r of part.removed || []) out.removed.add(r.full);
  for (const r of part.renamed || []) { out.renamed.add(r.to); out.renamedFrom.set(r.to, r.from); }
  for (const r of part.recoded || []) { if (r.full || r.to) out.renamed.add(r.full || r.to); }
  return out;
}

/** 권역(members = 시·도 이름들)이 이번 변경에 걸리는지: 'added' | 'renamed' | null */
export function regionTouched(members, sets) {
  let kind = null;
  for (const m of members || []) {
    if (sets.added.has(m)) return 'added';
    if (sets.renamed.has(m)) kind = 'renamed';
  }
  return kind;
}

/** 한 단위가 이번 변경에서 어떤 상태인지: 'added' | 'renamed' | null */
export function unitChange(props, level, sets) {
  if (!props) return null;
  if (isRegionLevel(level)) return regionTouched(props.members, sets);
  const full = props.full || props.name;
  if (sets.added.has(full)) return 'added';
  if (sets.renamed.has(full)) return 'renamed';
  return null;
}

/** 쌍 하나에 바뀐 것이 있는지 */
export function pairHasChanges(pair) {
  if (!pair) return false;
  return ['added', 'removed', 'renamed'].some((k) => (pair[k] || []).length > 0);
}

/** 내려받기 파일 이름: 행정구역_2025_시군구_대한민국.geojson */
export function downloadName(year, level, scopes) {
  const s = [];
  if (scopes.kr) s.push('대한민국');
  if (scopes.kp) s.push('북한');
  return `행정구역_${year}_${LEVEL_FILE[level] || level}_${s.join('_') || '없음'}.geojson`;
}

/** 지도·목록에 보일 이름 */
export function displayName(props) {
  if (!props) return '';
  if (props.full) return props.full;
  if (props.level === 'sigungu' && props.sido && props.name) return `${props.sido} ${props.name}`;
  return props.name || '';
}

// ── 구면 넓이(km²): 구면 다각형 공식(Chamberlain & Duquette), 반지름 6,378,137 m ──
const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
function ringArea(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const p3 = ring[(i + 2) % n];
    total += (rad(p3[0]) - rad(p1[0])) * Math.sin(rad(p2[1]));
  }
  return Math.abs((total * R * R) / 2);
}
function polygonArea(rings) {
  if (!rings || !rings.length) return 0;
  let a = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i]);
  return Math.max(0, a);
}
/** GeoJSON 도형(Polygon · MultiPolygon · GeometryCollection)의 넓이(km²) */
export function sphericalAreaKm2(geom) {
  if (!geom) return 0;
  let m2 = 0;
  if (geom.type === 'Polygon') m2 = polygonArea(geom.coordinates);
  else if (geom.type === 'MultiPolygon') m2 = geom.coordinates.reduce((s, p) => s + polygonArea(p), 0);
  else if (geom.type === 'GeometryCollection') return geom.geometries.reduce((s, g) => s + sphericalAreaKm2(g), 0);
  return m2 / 1e6;
}

/** km² 를 읽기 좋게 */
export function formatKm2(km2) {
  if (km2 >= 100) return `${Math.round(km2).toLocaleString('ko-KR')} km²`;
  return `${km2.toFixed(1)} km²`;
}

/** 이름 검색: 띄어 쓴 낱말은 모두 들어 있어야 함(순서 무관), 짧은 이름에서 앞쪽 일치 먼저 */
export function searchUnits(items, query, limit = 60) {
  const toks = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const hits = [];
  for (const it of items) {
    const parts = [it.name, it.full, it.en, it.label].filter(Boolean).map((s) => String(s).replace(/\s+/g, '').toLowerCase());
    const all = parts.join('|');
    if (!toks.every((t) => all.includes(t))) continue;
    const short = String(it.name || '').replace(/\s+/g, '').toLowerCase();
    const i = short.indexOf(toks[toks.length - 1]);
    const best = i < 0 ? 99 : i;
    hits.push({ it, best, len: String(it.label || it.full || it.name || '').length });
  }
  hits.sort((a, b) => a.best - b.best || a.len - b.len);
  return hits.slice(0, limit).map((h) => h.it);
}

/** 연도 한 칸 옮기기(끝에서 돌아가기는 wrap) */
export function stepYear(years, year, dir, wrap = false) {
  const i = years.indexOf(Number(year));
  let j = (i < 0 ? 0 : i) + dir;
  if (j < 0) j = wrap ? years.length - 1 : 0;
  if (j >= years.length) j = wrap ? 0 : years.length - 1;
  return years[j];
}
