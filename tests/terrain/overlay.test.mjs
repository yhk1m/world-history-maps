import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOverlay, tintGrid, sampler, drape } from '../../assets/terrain/overlay.js';
import { encodeGrid, decodeGrid } from '../../assets/terrain/codec.js';

const fc = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { _t: 'area', name: 'A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } },
  { type: 'Feature', properties: { _t: 'area', name: 'far' }, geometry: { type: 'Polygon', coordinates: [[[50, 50], [51, 50], [51, 51], [50, 50]]] } },
  { type: 'Feature', properties: { _t: 'line', name: 'L' }, geometry: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } },
  { type: 'Feature', properties: { _t: 'point', name: 'P', category: '수도' }, geometry: { type: 'Point', coordinates: [1, 1] } },
  { type: 'Feature', properties: { _t: 'point', name: 'Q' }, geometry: { type: 'Point', coordinates: [40, 1] } },
] };

test('bbox 밖 피처는 뺀다', () => {
  const o = prepareOverlay(fc, [-1, -1, 3, 3], ['#ff0000']);
  assert.deepEqual(o.areas.map((a) => a.name), ['A']);
  assert.deepEqual(o.areas[0].color, '#ff0000');
  assert.deepEqual(o.points.map((p) => p.name), ['P']);
  assert.equal(o.lines.length, 1);
});
test('날짜변경선 너머 피처를 bbox 쪽으로 옮긴다', () => {
  const f = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { _t: 'point', name: 'X' }, geometry: { type: 'Point', coordinates: [-175, 0] } }] };
  const o = prepareOverlay(f, [170, -5, 190, 5], ['#000']);
  assert.equal(o.points[0].lon, 185);
});
test('tintGrid: 영역 안 정점만 색이 칠해진다', () => {
  const o = prepareOverlay(fc, [-1, -1, 3, 3], ['#ff0000']);
  const g = { w: 5, h: 5, bbox: [-1, -1, 3, 3], data: new Float32Array(25) };
  const t = tintGrid(o, g, 0.45);
  const k = 2 * 5 + 2; // (1,1)
  assert.deepEqual([...t.slice(k * 4, k * 4 + 4)].map((v) => Math.round(v * 100) / 100), [1, 0, 0, 0.45]);
  assert.equal(t[4 * 4 + 3], 0); // (3,3) 행 0 열 4
});
test('양선형 표집', () => {
  const s = sampler({ w: 2, h: 2, bbox: [0, 0, 1, 1], data: Float32Array.from([0, 10, 20, 30]) });
  assert.equal(s(0.5, 0.5), 15);
  assert.equal(s(0, 1), 0); // 북서 = 행0 열0
});
test('drape 는 선을 촘촘히 나누고 고도를 붙인다', () => {
  const pts = drape([[0, 0], [1, 0]], () => 7, 5);
  assert.ok(pts.length > 20);
  assert.deepEqual(pts[0], [0, 0, 7]);
});
test('격자 코덱 왕복', () => {
  const a = Float32Array.from([-10994.4, 0, 8848.6, 123, 40000]);
  assert.deepEqual([...decodeGrid(encodeGrid(a), 5)], [-10994, 0, 8849, 123, 32767]);
});
test('_t 가 없는 GeoJSON(크로키 저장 파일)도 도형 종류로 나누고 색·도구를 가져온다', () => {
  const sk = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { tool: 'arrow', color: '#1f4e79', width: 3 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { type: 'Feature', properties: { tool: 'text', text: '여기', color: '#111111' }, geometry: { type: 'Point', coordinates: [1, 1] } },
    { type: 'Feature', properties: { name: '내 영역' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  ] };
  const o = prepareOverlay(sk, [-1, -1, 3, 3], ['#b3261e']);
  assert.equal(o.lines[0].color, '#1f4e79');
  assert.equal(o.lines[0].arrow, true);
  assert.equal(o.points[0].name, '여기');
  assert.equal(o.areas[0].name, '내 영역');
});
test('교과서 경로는 화살표, 크로키 펜 선은 화살표 없음', () => {
  const fc2 = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { _t: 'line', name: 'L' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { type: 'Feature', properties: { tool: 'pen', color: '#b3261e' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
  ] };
  const o = prepareOverlay(fc2, [-1, -1, 3, 3], ['#000']);
  assert.deepEqual(o.lines.map((l) => l.arrow), [true, false]);
  assert.equal(o.lines[0].color, '#111111');
});
test('overlay 합치기', async () => {
  const { mergeOverlays } = await import('../../assets/terrain/overlay.js');
  const a = { areas: [1], lines: [2], points: [3] }, b = { areas: [4], lines: [], points: [5] };
  assert.deepEqual(mergeOverlays(a, null, b), { areas: [1, 4], lines: [2], points: [3, 5] });
});
