import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, pickZoom, loadGrid, lonLatToPx } from '../../assets/terrain/dem.js';

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
