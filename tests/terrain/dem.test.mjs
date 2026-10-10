import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, pickZoom, loadGrid, lonLatToPx, despike } from '../../assets/terrain/dem.js';

const solid = (r, g, b) => ({ width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).map((_, i) => [r, g, b, 255][i % 4]) });

test('Terrarium 디코딩', () => {
  assert.equal(decode(128, 0, 0), 0);
  assert.equal(decode(127, 0, 0), -256);
  assert.equal(decode(128, 100, 128), 100.5);
});
test('넓을수록 z 가 작다', () => {
  assert.ok(pickZoom([-10, 35, 40, 60]) < pickZoom([6, 45, 8, 47]));
  assert.ok(pickZoom([-180, -80, 180, 80]) <= 2);
});
test('lonLatToPx', () => {
  assert.deepEqual(lonLatToPx(0, 0, 0), [128, 128]);
});
test('loadGrid 는 주입한 타일에서 표집하고 날짜변경선 너머 x 를 감싼다', async () => {
  const calls = [];
  const g = await loadGrid([179, 0, 181, 2], { maxCells: 64, fetchTile: async (z, x) => { calls.push(x); return solid(131, 232, 0); } });
  assert.equal(g.failed, 0);
  assert.ok(Math.abs(g.data[0] - 1000) < 1e-6);
  const n = 2 ** g.z;
  assert.ok(calls.every((x) => x >= 0 && x < n));
  assert.ok(new Set(calls).size >= 2);
  assert.ok(g.w <= 64 && g.h <= 64 && g.w >= 2 && g.h >= 2);
});
test('loadGrid: 실패한 타일은 0 m 로 채우고 센다', async () => {
  const g = await loadGrid([6, 45, 8, 47], { maxCells: 32, fetchTile: async () => { throw new Error('x'); } });
  assert.ok(g.failed > 0);
  assert.equal(g.data[0], 0);
});
test('loadGrid: 진행 콜백', async () => {
  const seen = [];
  await loadGrid([6, 45, 8, 47], { maxCells: 32, fetchTile: async () => solid(128, 0, 0), onProgress: (d, t) => seen.push([d, t]) });
  assert.ok(seen.length > 0 && seen.at(-1)[0] === seen.at(-1)[1]);
});

// 둘레가 평평한 바다·평지에 튄 값 하나·둘(2×2 묶음)·깊은 구덩이 → 둘레 값으로
test('despike: 평지의 튀는 봉우리·묶음·구덩이를 지운다', () => {
  const w = 20, h = 20, d = new Float32Array(w * h).map((_, i) => 10 + (i % 3)); // 10~12 m
  d[5 * w + 5] = 2199;
  d[12 * w + 12] = 1607; d[12 * w + 13] = 1500; d[13 * w + 12] = 491; d[13 * w + 13] = 384;
  d[3 * w + 16] = -3353;
  const n = despike(d, w, h);
  assert.equal(n, 6);
  assert.ok(Math.max(...d) <= 12 && Math.min(...d) >= 10);
});

// 원뿔 산(꼭대기 3000 m, 한 칸에 300 m 씩 낮아짐)은 가팔라도 그대로
test('despike: 넓고 가파른 진짜 산은 남긴다', () => {
  const w = 31, h = 31, d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = Math.max(0, 3000 - 300 * Math.hypot(x - 15, y - 15));
  const before = Float32Array.from(d);
  assert.equal(despike(d, w, h), 0);
  assert.deepEqual(d, before);
});

test('loadGrid: 타일의 튀는 값은 지우고(clean), 끌 수도 있다', async () => {
  const tile = () => {
    const t = solid(128, 10, 0); // 10 m
    const i = (100 * 256 + 100) * 4; t.data[i] = 136; t.data[i + 1] = 0; // 2048 m 한 칸
    return t;
  };
  const bb = [126.5, 37.2, 126.6, 37.3];
  const g = await loadGrid(bb, { maxCells: 64, fetchTile: async () => tile() });
  assert.ok(Math.max(...g.data) < 11);
  assert.ok(g.spikes >= 1);
  const raw = await loadGrid(bb, { maxCells: 64, clean: false, fetchTile: async () => tile() });
  assert.equal(raw.spikes, 0);
});
