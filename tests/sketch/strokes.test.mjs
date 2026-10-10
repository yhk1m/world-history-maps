import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../assets/sketch/strokes.js';

const pen = (x) => ({ tool: 'pen', color: '#b3261e', width: 2, coords: [[x, 0], [x + 1, 1]] });

test('add · undo · redo', () => {
  const s = createStore();
  s.add(pen(0)); s.add(pen(1));
  assert.equal(s.list().length, 2);
  s.undo();
  assert.equal(s.list().length, 1);
  s.redo();
  assert.equal(s.list().length, 2);
});
test('새 획을 그리면 다시하기 기록은 사라진다', () => {
  const s = createStore();
  s.add(pen(0)); s.undo(); s.add(pen(5));
  assert.equal(s.canRedo(), false);
  assert.deepEqual(s.list().map((x) => x.coords[0][0]), [5]);
});
test('지우기·모두 지우기도 되돌린다', () => {
  const s = createStore();
  const a = s.add(pen(0)); s.add(pen(1));
  s.erase(a.id);
  assert.equal(s.list().length, 1);
  s.clear();
  assert.equal(s.list().length, 0);
  s.undo();
  assert.equal(s.list().length, 1);
  s.undo();
  assert.equal(s.list().length, 2);
  assert.equal(s.list()[0].id, a.id); // 원래 순서 그대로
});
test('GeoJSON: 선은 LineString, 글자는 Point', () => {
  const s = createStore();
  s.add(pen(0));
  s.add({ tool: 'text', color: '#111111', width: 2, coords: [[10, 20]], text: '로마' });
  const fc = s.toGeoJSON();
  assert.equal(fc.type, 'FeatureCollection');
  assert.deepEqual(fc.features.map((f) => f.geometry.type), ['LineString', 'Point']);
  assert.equal(fc.features[1].properties.text, '로마');
  assert.equal(fc.features[0].properties.tool, 'pen');
});
test('저장·불러오기 왕복, 변경 알림', () => {
  const s = createStore();
  let n = 0;
  s.onChange(() => n++);
  s.add(pen(0));
  const t = createStore();
  t.load(s.dump());
  assert.deepEqual(t.list(), s.list());
  assert.ok(n >= 1);
  const u = createStore();
  u.load('망가진 문자열');
  assert.equal(u.list().length, 0);
});
