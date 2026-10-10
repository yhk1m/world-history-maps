// © 2026 김용현
// 구역 다각형 도구: 날짜변경선 이어 붙이기, 범위, 점-다각형 판정, 틀(네모·세모·원) 만들기.
// three·DOM 에 의존하지 않는다(Node 테스트 대상).

export const KM_LON = 111.32; // 적도에서 경도 1° 의 km
export const KM_LAT = 110.57; // 위도 1° 의 km

const polysOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);

// 고리 안에서 이웃 점 경도 차가 180° 를 넘지 않게 이은 뒤, 고리 평균 경도를 lon0 ±180 안으로 옮긴다.
function unwrapRing(ring, lon0) {
  const out = [];
  let prev = null;
  for (const [x, y] of ring) {
    let lon = x;
    if (prev !== null) {
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    out.push([lon, y]);
    prev = lon;
  }
  if (lon0 !== undefined) {
    const mean = out.reduce((s, p) => s + p[0], 0) / out.length;
    const k = Math.round((lon0 - mean) / 360);
    if (k) for (const p of out) p[0] += 360 * k;
  }
  return out;
}

export function unwrapGeom(geom, lon0) {
  const polys = polysOf(geom);
  if (lon0 === undefined) {
    const first = unwrapRing(polys[0][0]);
    lon0 = first.reduce((s, p) => s + p[0], 0) / first.length;
  }
  const mapped = polys.map((p) => p.map((r) => unwrapRing(r, lon0)));
  return {
    geom: geom.type === 'Polygon' ? { type: 'Polygon', coordinates: mapped[0] } : { type: 'MultiPolygon', coordinates: mapped },
    lon0,
  };
}

export function bboxOf(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polysOf(geom)) for (const r of p) for (const [x, y] of r) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

function inRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// 짝홀 규칙: 바깥 고리 안 + 구멍 밖. MultiPolygon 은 어느 조각이든.
export function contains(geom, lon, lat) {
  for (const p of polysOf(geom)) {
    let c = false;
    for (const r of p) if (inRing(r, lon, lat)) c = !c;
    if (c) return true;
  }
  return false;
}

// 틀 → Polygon. rKm: 네모는 반 변, 세모·원은 외접원 반지름. rot: 도(반시계).
export function shapePolygon(kind, { lon, lat, rKm, rot = 0 }) {
  const kx = KM_LON * Math.cos((lat * Math.PI) / 180);
  const a0 = (rot * Math.PI) / 180;
  const pt = (dx, dy) => {
    const x = dx * Math.cos(a0) - dy * Math.sin(a0);
    const y = dx * Math.sin(a0) + dy * Math.cos(a0);
    return [lon + x / kx, lat + y / KM_LAT];
  };
  let ring;
  if (kind === 'rect') ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => pt(u * rKm, v * rKm));
  else {
    const n = kind === 'tri' ? 3 : 64;
    const start = kind === 'tri' ? Math.PI / 2 : 0;
    ring = Array.from({ length: n }, (_, i) => {
      const t = start + (2 * Math.PI * i) / n;
      return pt(rKm * Math.cos(t), rKm * Math.sin(t));
    });
  }
  ring.push(ring[0].slice());
  return { type: 'Polygon', coordinates: [ring] };
}

export function sizeKm([w, s, e, n]) {
  const c = Math.cos((((s + n) / 2) * Math.PI) / 180);
  return { w: (e - w) * KM_LON * c, h: (n - s) * KM_LAT };
}
