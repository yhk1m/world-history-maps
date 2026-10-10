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

/**
 * 시·군·구 이름 바뀜 가운데 소속 시·도가 실제로 바뀐 것(시·도 이름만 바뀐 경우는 제외).
 * 예: 경상북도 군위군 → 대구광역시 군위군(소속 바뀜), 강원도 춘천시 → 강원특별자치도 춘천시(이름만).
 */
export function sidoMoved(from, to, pair) {
  const oldSido = String(from).split(' ')[0], newSido = String(to).split(' ')[0];
  if (oldSido === newSido || !String(from).includes(' ')) return false;
  const ren = new Map(((pair && pair.sido && pair.sido.renamed) || []).map((r) => [r.from, r.to]));
  return (ren.get(oldSido) || oldSido) !== newSido;
}
/** 이번 변경에서 소속 시·도가 바뀐 시·군·구(새 이름) */
export function movedUnits(pair) {
  const out = new Set();
  for (const r of (pair && pair.sigungu && pair.sigungu.renamed) || []) if (sidoMoved(r.from, r.to, pair)) out.add(r.to);
  return out;
}
/** "갑 → 을" 목록을 소속 바뀜 / 이름만 바뀜으로 나눈다 */
export function splitRenamed(pair) {
  const moved = [], renamed = [];
  for (const s of (pair && pair.renamed) || []) {
    const [a, b] = splitRename(s);
    (sidoMoved(a, b, pair) ? moved : renamed).push(s);
  }
  return { moved, renamed };
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

// ── 모핑 짝짓기: 앞 해와 이번 해 사이에 모양이 바뀐 단위를 묶는다 ──
const polysOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);

/** 도형의 [서, 남, 동, 북] */
export function bboxOfGeom(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polysOf(geom)) for (const [x, y] of p[0]) {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  return b;
}
function inRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** 점이 도형 안(구멍 밖)에 있나 */
export function pointInGeom(geom, x, y) {
  for (const p of polysOf(geom)) {
    if (!inRing(p[0], x, y)) continue;
    let hole = false;
    for (let k = 1; k < p.length; k++) if (inRing(p[k], x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
/** 가장 큰 바깥 고리(평면 넓이 기준) */
export function largestRing(geom) {
  let best = null, bestA = -1;
  for (const p of polysOf(geom)) {
    const r = p[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
    a = Math.abs(a);
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}
const bboxCache = new WeakMap();
const bboxF = (f) => { let b = bboxCache.get(f); if (!b) { b = bboxOfGeom(f.geometry); bboxCache.set(f, b); } return b; };
/** a 안의 격자점 가운데 b 안에도 드는 몫(0~1) */
export function overlapShare(a, b, n = 18) {
  const ba = bboxF(a), bb = bboxF(b);
  if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) return 0;
  let inA = 0, both = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = ba[0] + ((i + 0.5) / n) * (ba[2] - ba[0]);
    const y = ba[1] + ((j + 0.5) / n) * (ba[3] - ba[1]);
    if (!pointInGeom(a.geometry, x, y)) continue;
    inA++;
    if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && pointInGeom(b.geometry, x, y)) both++;
  }
  return inA ? both / inA : 0;
}
const unitKey = (f) => f.properties.full || f.properties.name;
function sameShape(a, b) {
  const A = sphericalAreaKm2(a.geometry), B = sphericalAreaKm2(b.geometry);
  if (Math.abs(A - B) > Math.max(A, B) * 0.01) return false;
  const ba = bboxF(a), bb = bboxF(b);
  return ba.every((v, i) => Math.abs(v - bb[i]) < 0.01);
}

/**
 * 앞 해(olds)와 이번 해(news) 피처에서 모양이 바뀐 단위를 찾아 겹치는 것끼리 묶는다.
 * renamedFrom: Map(새 이름 → 옛 이름). 이름(또는 바뀐 이름)이 이어지고 모양이 같으면 그대로인 것으로 본다.
 * 반환: { groups: [{ olds:[i], news:[i], pairs:[[oi, ni]] }], changedNew:Set, changedOld:Set, count }
 * maxCount 를 넘으면 겹침 계산 없이 { groups: [], tooMany: true }.
 * pairs 는 여럿↔여럿 묶음에서 새 단위마다 가장 많이 겹치는 옛 단위.
 * 하나↔하나 같은 단위의 넓이 차이가 minAreaChange 보다 작으면 바뀐 곳에서 뺀다.
 */
export function morphGroups(olds, news, renamedFrom = new Map(), minShare = 0.15, maxCount = Infinity, minAreaChange = 0.03) {
  const oldByKey = new Map(olds.map((f, i) => [unitKey(f), i]));
  const changedNew = new Set(), keptOld = new Set();
  news.forEach((f, i) => {
    const k = unitKey(f);
    const oi = oldByKey.has(k) ? oldByKey.get(k) : oldByKey.get(renamedFrom.get(k));
    if (oi != null && sameShape(olds[oi], f)) keptOld.add(oi); else changedNew.add(i);
  });
  const changedOld = new Set(olds.map((_, i) => i).filter((i) => !keptOld.has(i)));
  const count = changedNew.size + changedOld.size;
  if (count > maxCount) return { groups: [], changedNew, changedOld, count, tooMany: true };
  const edges = [];
  for (const ni of changedNew) for (const oi of changedOld) {
    const sn = overlapShare(news[ni], olds[oi]);
    const s = Math.max(sn, overlapShare(olds[oi], news[ni]));
    if (s >= minShare) edges.push([oi, ni, sn]);
  }
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const oi of changedOld) parent.set('o' + oi, 'o' + oi);
  for (const ni of changedNew) parent.set('n' + ni, 'n' + ni);
  for (const [oi, ni] of edges) { const a = find('o' + oi), b = find('n' + ni); if (a !== b) parent.set(a, b); }
  const comps = new Map();
  for (const x of parent.keys()) {
    const r = find(x);
    if (!comps.has(r)) comps.set(r, { olds: [], news: [], pairs: [] });
    const c = comps.get(r);
    (x[0] === 'o' ? c.olds : c.news).push(Number(x.slice(1)));
  }
  // 하나↔하나이면서 같은 단위(이름이 같거나 바뀐 이름으로 이어짐)이고 넓이 차이가 작으면
  // 해안선·그림 차이일 뿐이므로 바뀐 곳에서 뺀다(옛 시점 자료는 해마다 해안선이 조금씩 다르다)
  const sameUnit = (o, n) => { const k = unitKey(n); return unitKey(o) === k || unitKey(o) === renamedFrom.get(k); };
  const groups = [...comps.values()].filter((g) => {
    if (g.olds.length !== 1 || g.news.length !== 1) return true;
    const o = olds[g.olds[0]], n = news[g.news[0]];
    if (!sameUnit(o, n)) return true;
    const A = sphericalAreaKm2(o.geometry), B = sphericalAreaKm2(n.geometry);
    if (Math.abs(A - B) > Math.max(A, B) * minAreaChange) return true;
    changedOld.delete(g.olds[0]); changedNew.delete(g.news[0]);
    return false;
  });
  for (const g of groups) {
    g.olds.sort((a, b) => a - b);
    g.news.sort((a, b) => a - b);
    if (g.olds.length > 1 && g.news.length > 1) {
      for (const ni of g.news) {
        let best = null, bs = -1;
        for (const [oi, n2, s] of edges) if (n2 === ni && s > bs && g.olds.includes(oi)) { bs = s; best = oi; }
        if (best != null) g.pairs.push([best, ni]);
      }
    }
  }
  return { groups, changedNew, changedOld, count: changedNew.size + changedOld.size };
}
