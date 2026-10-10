import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapGeom, bboxOf, contains, shapePolygon, sizeKm } from '../../assets/terrain/clip.js';

test('날짜변경선 넘는 고리를 이어 붙인다', () => {
  const g = { type: 'Polygon', coordinates: [[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]]] };
  const { geom } = unwrapGeom(g);
  assert.deepEqual(bboxOf(geom), [170, 0, 190, 10]);
});
test('구멍은 바깥으로 친다', () => {
  const g = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(contains(g, 2, 2), true);
  assert.equal(contains(g, 5, 5), false);
  assert.equal(contains(g, 11, 5), false);
});
test('MultiPolygon 은 어느 조각이든 안이면 안', () => {
  const g = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
  ] };
  assert.equal(contains(g, 5.5, 5.5), true);
  assert.equal(contains(g, 3, 3), false);
});
test('원 틀은 중심을 품고 반지름 밖은 품지 않는다', () => {
  const c = shapePolygon('circle', { lon: 10, lat: 45, rKm: 100, rot: 0 });
  assert.equal(contains(c, 10, 45), true);
  assert.equal(contains(c, 10, 45 + 1.0), false); // 1° ≈ 111 km
  assert.equal(c.coordinates[0].length, 65);
});
test('네모 틀 크기', () => {
  const r = shapePolygon('rect', { lon: 0, lat: 0, rKm: 111.32, rot: 0 });
  const [w, s, e, n] = bboxOf(r);
  assert.ok(Math.abs(e - w - 2) < 0.01, `${e - w}`);
  assert.ok(Math.abs(n - s - 2 * 111.32 / 110.57) < 0.01, `${n - s}`);
});
test('세모 틀은 꼭짓점 3개(+닫는 점)', () => {
  const t = shapePolygon('tri', { lon: 0, lat: 0, rKm: 50, rot: 0 });
  assert.equal(t.coordinates[0].length, 4);
  assert.equal(contains(t, 0, 0), true);
});
test('sizeKm', () => {
  const { w, h } = sizeKm([0, 59, 2, 61]);
  assert.ok(Math.abs(w - 111.3) < 1, `${w}`);
  assert.ok(Math.abs(h - 221.1) < 1, `${h}`);
});
import { scanMask } from '../../assets/terrain/clip.js';
test('scanMask 는 contains 와 같은 답을 낸다', () => {
  const g = { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
    [[[12, 2], [15, 2], [13.5, 8], [12, 2]]],
  ] };
  const lons = Array.from({ length: 40 }, (_, i) => -1 + i * 0.43);
  const lats = Array.from({ length: 30 }, (_, j) => 11 - j * 0.41);
  const m = scanMask(g, lons, lats);
  let diff = 0;
  lats.forEach((la, j) => lons.forEach((lo, i) => { if (!!m[j * lons.length + i] !== contains(g, lo, la)) diff++; }));
  assert.equal(diff, 0);
});
import { lonExtent } from '../../assets/terrain/clip.js';
test('lonExtent: 날짜변경선을 넘는 경도들은 짧은 쪽 구간', () => {
  assert.deepEqual(lonExtent([120, 150, 179, -178, -160]), [120, 200]);
  assert.deepEqual(lonExtent([-10, 0, 30]), [-10, 30]);
  assert.deepEqual(lonExtent([100, 270.13 - 360, -105.38]).map((x) => Math.round(x * 100) / 100), [100, 270.13]);
});
