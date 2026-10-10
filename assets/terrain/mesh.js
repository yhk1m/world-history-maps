// © 2026 김용현
// 고도 격자 + 구역 다각형 → 퍼즐 조각 모형 배열(표면·옆면·바닥). three 에 의존하지 않는다.
// 좌표: x = 동쪽 km, z = 남쪽 km(구역 bbox 중심 원점), y = 고도 m(뷰어가 높이 과장으로 비율을 맞춘다).

import { scanMask, KM_LON, KM_LAT } from './clip.js';

export function projector([w, s, e, n]) {
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const kx = KM_LON * Math.cos((lat0 * Math.PI) / 180);
  return (lon, lat) => [(lon - lon0) * kx, (lat0 - lat) * KM_LAT];
}

const SEA = [[0, [0.74, 0.85, 0.92]], [-200, [0.6, 0.76, 0.88]], [-2000, [0.37, 0.56, 0.76]], [-5000, [0.19, 0.34, 0.56]], [-9000, [0.08, 0.16, 0.33]]];
const LAND = [[0, [0.56, 0.68, 0.48]], [300, [0.7, 0.76, 0.54]], [1000, [0.84, 0.79, 0.59]], [2000, [0.74, 0.6, 0.45]], [3500, [0.59, 0.48, 0.39]], [5000, [0.88, 0.87, 0.85]], [8000, [1, 1, 1]]];

function ramp(stops, m) {
  for (let k = 1; k < stops.length; k++) {
    const [a, ca] = stops[k - 1], [b, cb] = stops[k];
    if ((m - a) * (m - b) <= 0) {
      const t = (m - a) / (b - a || 1);
      return ca.map((c, i) => c + (cb[i] - c) * t);
    }
  }
  return stops[stops.length - 1][1].slice();
}
export const hypso = (m) => (m < 0 ? ramp(SEA, m) : ramp(LAND, m));

// opts.tintGrid: Float32Array(w*h*4) — 정점마다 [r,g,b,a], 교과서 지도 영역색을 표면에 a 만큼 섞는다(overlay.tintGrid).
export function buildArrays(grid, geom, { tintGrid } = {}) {
  const { w, h, bbox, data } = grid;
  const [bw, bs, be, bn] = bbox;
  const P = projector(bbox);
  const lonAt = (i) => bw + ((be - bw) * i) / (w - 1);
  const latAt = (j) => bn - ((bn - bs) * j) / (h - 1);

  // 칸(셀) 포함 여부: 칸 중심이 구역 안
  const cw = w - 1, ch = h - 1;
  const cLon = Array.from({ length: cw }, (_, i) => (lonAt(i) + lonAt(i + 1)) / 2);
  const cLat = Array.from({ length: ch }, (_, j) => (latAt(j) + latAt(j + 1)) / 2);
  const inside = scanMask(geom, cLon, cLat);
  let minIn = Infinity, maxIn = -Infinity;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    if (!inside[j * cw + i]) continue;
    for (const k of [j * w + i, j * w + i + 1, (j + 1) * w + i, (j + 1) * w + i + 1]) {
      if (data[k] < minIn) minIn = data[k];
      if (data[k] > maxIn) maxIn = data[k];
    }
  }
  if (minIn === Infinity) minIn = maxIn = 0;
  const baseY = minIn - Math.max(200, (maxIn - minIn) * 0.08);

  // 표면·바닥 정점(격자 전체; 쓰지 않는 정점은 인덱스에서 빠진다)
  const n = w * h;
  const tp = new Float32Array(n * 3), tc = new Float32Array(n * 3), bp = new Float32Array(n * 3);
  for (let j = 0; j < h; j++) {
    const lat = latAt(j);
    for (let i = 0; i < w; i++) {
      const k = j * w + i, lon = lonAt(i), m = data[k];
      const [x, z] = P(lon, lat);
      tp[k * 3] = bp[k * 3] = x; tp[k * 3 + 1] = m; bp[k * 3 + 1] = baseY; tp[k * 3 + 2] = bp[k * 3 + 2] = z;
      let c = hypso(m);
      if (tintGrid && tintGrid[k * 4 + 3] > 0) {
        const a = tintGrid[k * 4 + 3];
        c = c.map((v, q) => v * (1 - a) + tintGrid[k * 4 + q] * a);
      }
      tc[k * 3] = c[0]; tc[k * 3 + 1] = c[1]; tc[k * 3 + 2] = c[2];
    }
  }
  const ti = [], bi = [];
  // 옆면: 포함 칸의 변 중 이웃 칸이 포함되지 않은 변(정점 복제, 어두운 단면색)
  const wp = [], wc = [], wi = [];
  const wall = (ka, kb) => {
    const base = wp.length / 3;
    for (const k of [ka, kb]) {
      wp.push(tp[k * 3], tp[k * 3 + 1], tp[k * 3 + 2]);
      const c = hypso(data[k]); wc.push(c[0] * 0.55, c[1] * 0.55, c[2] * 0.55);
    }
    for (const k of [ka, kb]) { wp.push(tp[k * 3], baseY, tp[k * 3 + 2]); wc.push(0.32, 0.3, 0.28); }
    wi.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  const isIn = (i, j) => i >= 0 && j >= 0 && i < cw && j < ch && inside[j * cw + i] === 1;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    if (!isIn(i, j)) continue;
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1; // a 북서, b 북동, c 남서, d 남동
    ti.push(a, c, b, b, c, d);
    bi.push(a, b, c, b, d, c);
    if (!isIn(i, j - 1)) wall(a, b);
    if (!isIn(i, j + 1)) wall(c, d);
    if (!isIn(i - 1, j)) wall(a, c);
    if (!isIn(i + 1, j)) wall(b, d);
  }
  const idx = (arr) => (n * 4 > 65535 ? Uint32Array.from(arr) : Uint16Array.from(arr));
  return {
    top: { positions: tp, colors: tc, index: idx(ti) },
    base: { positions: bp, index: idx(bi) },
    walls: { positions: Float32Array.from(wp), colors: Float32Array.from(wc), index: Uint32Array.from(wi) },
    inside, baseY, minIn, maxIn, project: P,
  };
}

// 평평한 화살표: 점 목록 [[x,y,z],…](y = 높이)를 xz 평면에서 폭 width 의 띠로, head 면 끝에 넓은 삼각형 머리.
// 머리 길이 = 폭 × 3.2, 머리 폭 = 폭 × 2.6. 선이 머리보다 짧으면 머리·띠를 함께 줄인다. → { positions, index }
export function flatArrow(points, width, head) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]) > 1e-9);
  if (pts.length < 2) return { positions: new Float32Array(0), index: new Uint32Array(0) };
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const total = cum[cum.length - 1];
  let w = width, hl = width * 3.2, hw = width * 2.6;
  if (head && total < hl * 1.25) { const k = total / (hl * 1.25); w *= k; hl *= k; hw *= k; }
  // 몸통 = 끝에서 머리 길이만큼 뺀 곳까지
  let shaft = pts;
  if (head) {
    const cut = total - hl;
    let i = 1; while (i < pts.length - 1 && cum[i] < cut) i++;
    const t = (cut - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    const B = pts[i - 1].map((v, q) => v + (pts[i][q] - v) * t);
    shaft = pts.slice(0, i).concat([B]);
  }
  const pos = [], idx = [];
  const normal = (a, b) => { const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  shaft.forEach((p, i) => {
    const a = shaft[Math.max(0, i - 1)], b = shaft[Math.min(shaft.length - 1, i + 1)];
    const [nx, nz] = normal(a, b);
    pos.push(p[0] + (nx * w) / 2, p[1], p[2] + (nz * w) / 2, p[0] - (nx * w) / 2, p[1], p[2] - (nz * w) / 2);
    if (i) { const l0 = 2 * (i - 1), r0 = l0 + 1, l1 = 2 * i, r1 = l1 + 1; idx.push(l0, r0, l1, r0, r1, l1); }
  });
  if (head) {
    const B = shaft[shaft.length - 1], T = pts[pts.length - 1], [nx, nz] = normal(B, T), o = pos.length / 3;
    pos.push(B[0] + (nx * hw) / 2, B[1], B[2] + (nz * hw) / 2, B[0] - (nx * hw) / 2, B[1], B[2] - (nz * hw) / 2, T[0], T[1], T[2]);
    idx.push(o, o + 1, o + 2);
  }
  return { positions: Float32Array.from(pos), index: Uint32Array.from(idx) };
}
