// © 2026 김용현
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowRing, arrowPath, partialLine, pathToLines, ARROW_HEAD_L, ARROW_HEAD_W } from '../../assets/arrow.js';

test('화살표: 3D 와 같은 비율 — 머리 길이 3.2·폭 2.6 배, 끝점이 꼭짓점', () => {
  const r = arrowRing([[0, 0], [100, 0]], 4);
  assert.equal(ARROW_HEAD_L, 3.2); assert.equal(ARROW_HEAD_W, 2.6);
  assert.ok(r.some(([x, y]) => x === 100 && y === 0));
  const ys = r.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...ys) - 5.2) < 1e-9); // 머리 반폭 = 4 × 2.6 / 2
  assert.ok(r.some(([x, y]) => Math.abs(x - (100 - 12.8)) < 1e-9 && Math.abs(Math.abs(y) - 5.2) < 1e-9));
});

test('화살표: 짧은 선은 머리·띠를 함께 줄이고, 머리 없이도 그린다', () => {
  const r = arrowRing([[0, 0], [8, 0]], 4);
  assert.ok(Math.max(...r.map((p) => p[1])) < 5.2);
  assert.equal(arrowRing([[0, 0], [10, 0]], 2, false).length, 4);
  assert.equal(arrowPath([[0, 0]], 2), '');
});

test('선 앞쪽만 자르기와 경로 문자열 읽기', () => {
  assert.deepEqual(partialLine([[0, 0], [10, 0], [10, 10]], 0.5), [[0, 0], [10, 0]]);
  assert.deepEqual(partialLine([[0, 0], [10, 0]], 0.25), [[0, 0], [2.5, 0]]);
  assert.deepEqual(pathToLines('M0,0L5,5M1,1L2,2L3,3'), [[[0, 0], [5, 5]], [[1, 1], [2, 2], [3, 3]]]);
});
