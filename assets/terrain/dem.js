// © 2026 김용현
// 고도 격자: AWS Terrain Tiles(Terrarium PNG, 해저 수심 포함)를 받아 구역 bbox 의 경위도 등간격 격자로 다시 표집.
// 타일 받기(fetchTile)는 주입할 수 있다 — Node 테스트는 가짜 타일, 브라우저는 browserFetchTile.

import { sizeKm } from './clip.js';

export const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const T = 256;
const MAX_TILES = 64;

export const decode = (r, g, b) => r * 256 + g + b / 256 - 32768;

// 웹 메르카토르 전 세계 픽셀 좌표(경도는 ±180 밖이어도 이어서 계산)
export function lonLatToPx(lon, lat, z) {
  const s = T * 2 ** z;
  const la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * s];
}

function pxSpan([w, s, e, n], z) {
  const [x0, y0] = lonLatToPx(w, n, z), [x1, y1] = lonLatToPx(e, s, z);
  return { x0, y0, x1, y1 };
}
const tileCount = (b, z) => {
  const { x0, y0, x1, y1 } = pxSpan(b, z);
  return (Math.floor(x1 / T) - Math.floor(x0 / T) + 1) * (Math.floor(y1 / T) - Math.floor(y0 / T) + 1);
};

// 격자는 다시 표집하므로 타일 해상도가 격자의 ~2배까지는 받는다.
export function pickZoom(bbox, maxCells = 768, maxZ = 12) {
  for (let z = maxZ; z > 0; z--) {
    const { x0, y0, x1, y1 } = pxSpan(bbox, z);
    if (Math.max(x1 - x0, y1 - y0) <= maxCells * 2 && tileCount(bbox, z) <= MAX_TILES) return z;
  }
  return 0;
}

// km 비율을 지키고 긴 변 = maxCells(타일 해상도가 모자라면 그만큼만)
export function gridSize(bbox, z, maxCells = 768) {
  const { w: kw, h: kh } = sizeKm(bbox);
  const { x0, y0, x1, y1 } = pxSpan(bbox, z);
  const long = Math.max(2, Math.min(maxCells, Math.round(Math.max(x1 - x0, y1 - y0))));
  const r = kh / Math.max(kw, 1e-9);
  return r <= 1 ? { w: long, h: Math.max(2, Math.round(long * r)) } : { w: Math.max(2, Math.round(long / r)), h: long };
}

export async function loadGrid(bbox, { maxCells = 768, fetchTile = browserFetchTile, onProgress } = {}) {
  const z = pickZoom(bbox, maxCells);
  const n = 2 ** z;
  const { x0, y0, x1, y1 } = pxSpan(bbox, z);
  const tx0 = Math.floor(x0 / T), tx1 = Math.floor(x1 / T);
  const ty0 = Math.max(0, Math.floor(y0 / T)), ty1 = Math.min(n - 1, Math.floor(y1 / T));
  const mw = (tx1 - tx0 + 1) * T, mh = (ty1 - ty0 + 1) * T;
  const mosaic = new Float32Array(mw * mh);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0, failed = 0;
  const run = async ([tx, ty]) => {
    try {
      const img = await fetchTile(z, ((tx % n) + n) % n, ty);
      const ox = (tx - tx0) * T, oy = (ty - ty0) * T, d = img.data;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const i = (y * img.width + x) * 4;
        mosaic[(oy + y) * mw + ox + x] = decode(d[i], d[i + 1], d[i + 2]);
      }
    } catch { failed++; }
    done++;
    if (onProgress) onProgress(done, jobs.length);
  };
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));

  const { w, h } = gridSize(bbox, z, maxCells);
  const [bw, bs, be, bn] = bbox;
  const data = new Float32Array(w * h);
  const ox = tx0 * T, oy = ty0 * T;
  for (let j = 0; j < h; j++) {
    const lat = bn - ((bn - bs) * j) / (h - 1);
    for (let i = 0; i < w; i++) {
      const lon = bw + ((be - bw) * i) / (w - 1);
      const [px, py] = lonLatToPx(lon, lat, z);
      const fx = Math.min(mw - 1.001, Math.max(0, px - ox - 0.5)), fy = Math.min(mh - 1.001, Math.max(0, py - oy - 0.5));
      const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
      const k = iy * mw + ix;
      data[j * w + i] = (mosaic[k] * (1 - ax) + mosaic[k + 1] * ax) * (1 - ay) + (mosaic[k + mw] * (1 - ax) + mosaic[k + mw + 1] * ax) * ay;
    }
  }
  return { w, h, bbox: bbox.slice(), z, data, failed, tiles: jobs.length };
}

export async function browserFetchTile(z, x, y) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let err;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { mode: 'cors' });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    } catch (e) { err = e; }
  }
  throw err;
}
