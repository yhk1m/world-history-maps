// © 2026 김용현
// 역사 지도 덮기: 구역 bbox 와 겹치는 영역·경로·지점만 골라 경도를 이어 붙이고,
// 영역은 정점별 색(tintGrid), 경로는 지형을 따라가는 3D 선(drape)으로 만든다. three 에 의존하지 않는다.

import { unwrapGeom, unwrapRing, bboxOf, scanMask, KM_LON, KM_LAT } from './clip.js';

const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const lineBBox = (c) => {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of c) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
};
const shift = (lon, lon0) => lon + 360 * Math.round((lon0 - lon) / 360);

// 교과서 지도는 properties._t(area·line·point)로, 크로키 저장 파일처럼 _t 가 없으면 도형 종류로 나눈다.
// 선: color(없으면 검정), arrow(교과서 경로·크로키 화살표는 끝에 화살촉). 점: 이름은 name 또는 text.
const kindOf = (p, g) => p._t || ({ Polygon: 'area', MultiPolygon: 'area', LineString: 'line', MultiLineString: 'line', Point: 'point' })[g.type];

export function prepareOverlay(fc, bbox, palette) {
  const lon0 = (bbox[0] + bbox[2]) / 2;
  const out = { areas: [], lines: [], points: [] };
  let ci = 0;
  for (const f of fc.features || []) {
    const p = f.properties || {}, g = f.geometry;
    if (!g) continue;
    const t = kindOf(p, g);
    if (t === 'area' && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const geom = unwrapGeom(g, lon0).geom;
      const color = p.color || palette[ci++ % palette.length];
      if (hit(bboxOf(geom), bbox)) out.areas.push({ name: p.name || '', color, geom });
    } else if (t === 'line') {
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      const arrow = p._t === 'line' || p.tool === 'arrow' || (!p.tool && !p._t);
      for (const c of parts) {
        const u = unwrapRing(c, lon0);
        if (hit(lineBBox(u), bbox)) out.lines.push({ name: p.name || '', coords: u, color: p.color || '#111111', arrow });
      }
    } else if (t === 'point' && g.type === 'Point') {
      const lon = shift(g.coordinates[0], lon0), lat = g.coordinates[1];
      if (hit([lon, lat, lon, lat], bbox)) out.points.push({ name: p.name || p.text || '', lon, lat, category: p.category || '', color: p.color || '' });
    }
  }
  return out;
}

export const mergeOverlays = (...os) => {
  const out = { areas: [], lines: [], points: [] };
  for (const o of os) if (o) for (const k of ['areas', 'lines', 'points']) out[k].push(...o[k]);
  return out;
};

const rgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};

// 정점마다 [r,g,b,a]. 뒤쪽 영역이 위(덮어씀).
export function tintGrid(overlay, grid, alpha = 0.45) {
  const { w, h, bbox: [bw, bs, be, bn] } = grid;
  const lons = Array.from({ length: w }, (_, i) => bw + ((be - bw) * i) / (w - 1));
  const lats = Array.from({ length: h }, (_, j) => bn - ((bn - bs) * j) / (h - 1));
  const t = new Float32Array(w * h * 4);
  for (const a of overlay.areas) {
    const m = scanMask(a.geom, lons, lats), c = rgb(a.color);
    for (let k = 0; k < m.length; k++) if (m[k]) t.set([c[0], c[1], c[2], alpha], k * 4);
  }
  return t;
}

// 격자 양선형 표집(행 0 = 북쪽)
export function sampler({ w, h, bbox: [bw, bs, be, bn], data }) {
  return (lon, lat) => {
    const fx = Math.min(w - 1, Math.max(0, ((lon - bw) / (be - bw)) * (w - 1)));
    const fy = Math.min(h - 1, Math.max(0, ((bn - lat) / (bn - bs)) * (h - 1)));
    const i = Math.min(w - 2, Math.floor(fx)), j = Math.min(h - 2, Math.floor(fy));
    const ax = fx - i, ay = fy - j, k = j * w + i;
    return (data[k] * (1 - ax) + data[k + 1] * ax) * (1 - ay) + (data[k + w] * (1 - ax) + data[k + w + 1] * ax) * ay;
  };
}

// 선을 stepKm 간격으로 나누어 [lon, lat, 고도 m] 목록
export function drape(coords, sample, stepKm = 5) {
  const out = [];
  for (let k = 0; k < coords.length - 1; k++) {
    const [x0, y0] = coords[k], [x1, y1] = coords[k + 1];
    const c = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const d = Math.hypot((x1 - x0) * KM_LON * c, (y1 - y0) * KM_LAT);
    const n = Math.max(1, Math.ceil(d / stepKm));
    for (let q = 0; q < n; q++) {
      const t = q / n, lon = x0 + (x1 - x0) * t, lat = y0 + (y1 - y0) * t;
      out.push([lon, lat, sample(lon, lat)]);
    }
  }
  const [lon, lat] = coords[coords.length - 1];
  out.push([lon, lat, sample(lon, lat)]);
  return out;
}
