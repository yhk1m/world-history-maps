// © 2026 김용현
// 2D 화살표 모양 — 3D 모형의 화살표(assets/terrain/mesh.js flatArrow)와 같은 모양을 SVG 채움 경로로.
// 폭 width 의 띠 + 끝의 넓은 삼각형 머리(머리 길이 = 폭 × 3.2, 머리 폭 = 폭 × 2.6).
// 선이 머리보다 짧으면 머리·띠를 함께 줄인다. 점은 화면 좌표 [[x, y], …].

export const ARROW_HEAD_L = 3.2;
export const ARROW_HEAD_W = 2.6;

const fmt = (v) => (Math.round(v * 100) / 100).toString();

/** 화살표 테두리 고리 [[x, y], …] (head = false 면 머리 없는 띠) */
export function arrowRing(points, width, head = true) {
  const pts = (points || []).filter((p, i, a) => p && (i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6));
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  let w = width, hl = width * ARROW_HEAD_L, hw = width * ARROW_HEAD_W;
  if (head && total < hl * 1.25) { const k = total / (hl * 1.25); w *= k; hl *= k; hw *= k; }
  let shaft = pts;
  if (head) {
    const cut = total - hl;
    let i = 1; while (i < pts.length - 1 && cum[i] < cut) i++;
    const t = (cut - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    shaft = pts.slice(0, i).concat([[pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]]);
  }
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  const left = [], right = [];
  shaft.forEach((p, i) => {
    const [nx, ny] = normal(shaft[Math.max(0, i - 1)], shaft[Math.min(shaft.length - 1, i + 1)]);
    left.push([p[0] + (nx * w) / 2, p[1] + (ny * w) / 2]);
    right.push([p[0] - (nx * w) / 2, p[1] - (ny * w) / 2]);
  });
  const ring = left.slice();
  if (head) {
    const B = shaft[shaft.length - 1], T = pts[pts.length - 1], [nx, ny] = normal(B, T);
    ring.push([B[0] + (nx * hw) / 2, B[1] + (ny * hw) / 2], [T[0], T[1]], [B[0] - (nx * hw) / 2, B[1] - (ny * hw) / 2]);
  }
  return ring.concat(right.reverse());
}

/** 화살표 채움 경로(SVG d). 점이 모자라면 '' */
export function arrowPath(points, width, head = true) {
  const r = arrowRing(points, width, head);
  return r.length ? 'M' + r.map((p) => fmt(p[0]) + ',' + fmt(p[1])).join('L') + 'Z' : '';
}

/** 선의 앞쪽 t(0~1) 만큼만 — 화살표가 그려져 나가는 애니메이션용 */
export function partialLine(points, t) {
  const pts = (points || []).filter(Boolean);
  if (pts.length < 2 || t >= 1) return pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const want = cum[cum.length - 1] * Math.max(0, t);
  let i = 1; while (i < pts.length - 1 && cum[i] < want) i++;
  const s = (want - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return pts.slice(0, i).concat([[pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * s, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * s]]);
}

/** SVG 경로 문자열(d3.geoPath 가 만든 M…L…) → 선 조각들 [[[x, y], …], …] */
export function pathToLines(d) {
  const out = [];
  for (const seg of String(d || '').split(/(?=M)/)) {
    const nums = seg.replace(/[MLZ]/g, ' ').trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push([nums[i], nums[i + 1]]);
    if (pts.length > 1) out.push(pts);
  }
  return out;
}
