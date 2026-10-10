import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArrays, hypso, projector } from '../../assets/terrain/mesh.js';

const flat = (w, h, v) => ({ w, h, bbox: [0, 0, 1, 1], data: new Float32Array(w * h).fill(v) });
const square = { type: 'Polygon', coordinates: [[[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]]] };

test('전부 포함되면 표면·바닥 삼각형 = 2·(w-1)(h-1), 옆면 = 둘레 변 × 2', () => {
  const a = buildArrays(flat(5, 4, 100), square);
  assert.equal(a.top.index.length / 3, 2 * 4 * 3);
  assert.equal(a.base.index.length / 3, 2 * 4 * 3);
  assert.equal(a.walls.index.length / 3, 2 * 2 * (4 + 3));
});
test('구역 밖 칸은 빠진다', () => {
  const half = { type: 'Polygon', coordinates: [[[-1, -1], [0.5, -1], [0.5, 2], [-1, 2], [-1, -1]]] };
  const a = buildArrays(flat(9, 9, 0), half);
  const n = a.top.index.length / 3;
  assert.ok(n > 0 && n <= 2 * 8 * 8 * 0.6, `${n}`);
});
test('바닥은 구역 안 최저 고도보다 낮다', () => {
  const g = flat(4, 4, 500); g.data[5] = -3000;
  const a = buildArrays(g, square);
  assert.ok(a.baseY < -3000);
  assert.equal(a.minIn, -3000);
});
test('표면 삼각형은 위(+y)를 본다', () => {
  const a = buildArrays(flat(3, 3, 0), square);
  const p = a.top.positions, [i0, i1, i2] = a.top.index;
  const v = (i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const [A, B, C] = [v(i0), v(i1), v(i2)];
  const u = B.map((x, k) => x - A[k]), w = C.map((x, k) => x - A[k]);
  const ny = u[2] * w[0] - u[0] * w[2];
  assert.ok(ny > 0);
});
test('tint 가 표면색에 섞인다', () => {
  const plain = buildArrays(flat(3, 3, 100), square);
  const tg = new Float32Array(9 * 4); for (let k = 0; k < 9; k++) tg.set([1, 0, 0, 0.5], k * 4);
  const red = buildArrays(flat(3, 3, 100), square, { tintGrid: tg });
  assert.ok(red.top.colors[0] > plain.top.colors[0]);
});
test('고도색: 바다는 파랑이 가장 크다', () => {
  const [r, g, b] = hypso(-3000);
  assert.ok(b > r && b > g);
});
test('projector: 중심은 원점, 동쪽은 +x, 남쪽은 +z', () => {
  const P = projector([0, 0, 2, 2]);
  assert.deepEqual(P(1, 1).map((x) => Math.round(x * 1e6) / 1e6), [0, 0]);
  assert.ok(P(2, 1)[0] > 0 && P(1, 0)[1] > 0);
});
