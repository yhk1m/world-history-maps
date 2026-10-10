// © 2026 김용현
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changePairFor, changedSets, regionTouched, unitChange, pairHasChanges, splitRename,
  downloadName, displayName, sphericalAreaKm2, formatKm2, searchUnits, stepYear,
} from '../../assets/admin/logic.js';

const idx = JSON.parse(readFileSync(new URL('../../data/admin/index.json', import.meta.url), 'utf8'));

test('그 해로 넘어오는 변경 쌍을 찾는다', () => {
  assert.equal(changePairFor(idx.changes, 2014).from, 2013);
  assert.equal(changePairFor(idx.changes, 2013), null);
});

test('2014: 청주 통합 — 서원구·청원구가 새로 생기고 청원군이 없어진다', () => {
  const s = changedSets(changePairFor(idx.changes, 2014), 'sigungu');
  assert.ok(s.added.has('충청북도 청주시 서원구'));
  assert.ok(s.added.has('충청북도 청주시 청원구'));
  assert.ok(s.removed.has('충청북도 청원군'));
  assert.equal(unitChange({ full: '충청북도 청주시 청원구' }, 'sigungu', s), 'added');
  assert.equal(unitChange({ full: '서울특별시 종로구' }, 'sigungu', s), null);
});

test('2023: 군위군 대구 편입과 강원특별자치도 이름 바뀜', () => {
  const pair = changePairFor(idx.changes, 2023);
  const sg = changedSets(pair, 'sigungu');
  assert.equal(unitChange({ full: '대구광역시 군위군' }, 'sigungu', sg), 'renamed');
  assert.equal(sg.renamedFrom.get('대구광역시 군위군'), '경상북도 군위군');
  const sd = changedSets(pair, 'sido');
  assert.equal(unitChange({ full: '강원특별자치도' }, 'sido', sd), 'renamed');
  // 권역: 강원특별자치도를 품은 권역이 걸린다
  assert.equal(unitChange({ members: ['강원특별자치도'] }, 'region7', sd), 'renamed');
  assert.equal(regionTouched(['서울특별시'], sd), null);
});

test('2026: 전남광주통합특별시가 생긴 권역은 added', () => {
  const sd = changedSets(changePairFor(idx.changes, 2026), 'region7');
  assert.equal(regionTouched(['전북특별자치도', '전남광주통합특별시'], sd), 'added');
});

test('바뀐 것이 있는 쌍만 참', () => {
  assert.equal(pairHasChanges(changePairFor(idx.changes, 2014)), true);
  assert.equal(pairHasChanges(changePairFor(idx.changes, 2015)), false);
  assert.equal(pairHasChanges(null), false);
});

test('이름 바뀜 문자열 나누기', () => {
  assert.deepEqual(splitRename('강원도 → 강원특별자치도'), ['강원도', '강원특별자치도']);
});

test('내려받기 파일 이름', () => {
  assert.equal(downloadName(2025, 'sigungu', { kr: true, kp: false }), '행정구역_2025_시군구_대한민국.geojson');
  assert.equal(downloadName(2013, 'sido', { kr: true, kp: true }), '행정구역_2013_시도_대한민국_북한.geojson');
  assert.equal(downloadName(2020, 'regiontrad', { kr: true, kp: false }), '행정구역_2020_전통지역구분_대한민국.geojson');
});

test('보일 이름: full 우선, 북한 시군구는 도 이름을 앞에', () => {
  assert.equal(displayName({ full: '서울특별시 종로구', name: '종로구' }), '서울특별시 종로구');
  assert.equal(displayName({ name: 'Anak', level: 'sigungu', sido: '황해남도' }), '황해남도 Anak');
  assert.equal(displayName({ name: '자강도', level: 'sido' }), '자강도');
});

test('적도 1°×1° 칸의 넓이 ≈ 12,391 km²', () => {
  const sq = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  assert.ok(Math.abs(sphericalAreaKm2(sq) - 12391) < 15, String(sphericalAreaKm2(sq)));
});

test('구멍은 빼고 MultiPolygon 은 더한다', () => {
  const outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]];
  const a = sphericalAreaKm2({ type: 'Polygon', coordinates: [outer] });
  const b = sphericalAreaKm2({ type: 'Polygon', coordinates: [outer, hole] });
  assert.ok(Math.abs(a - b - sphericalAreaKm2({ type: 'Polygon', coordinates: [hole] })) < 1e-6);
  const m = sphericalAreaKm2({ type: 'MultiPolygon', coordinates: [[outer], [hole]] });
  assert.ok(Math.abs(m - a - (a - b)) < 1e-6);
});

test('서울특별시 넓이는 약 605 km²', () => {
  const g = JSON.parse(readFileSync(new URL('../../data/admin/kr/2025_sido.json', import.meta.url), 'utf8'));
  const seoul = g.features.find((f) => f.properties.name === '서울특별시');
  const a = sphericalAreaKm2(seoul.geometry);
  assert.ok(a > 570 && a < 640, String(a));
  assert.equal(formatKm2(a).endsWith('km²'), true);
});

test('검색: 공백 무시, 앞쪽 일치 먼저, 영문도', () => {
  const items = [
    { full: '경상북도 군위군', name: '군위군' }, { full: '대구광역시 군위군', name: '군위군' },
    { full: '서울특별시 종로구', name: '종로구' }, { name: 'Anak', en: 'Anak', label: '황해남도 Anak' },
  ];
  assert.equal(searchUnits(items, '군위').length, 2);
  assert.equal(searchUnits(items, '대구 군위')[0].full, '대구광역시 군위군');
  assert.equal(searchUnits(items, 'anak')[0].name, 'Anak');
  assert.deepEqual(searchUnits(items, '  '), []);
});

test('연도 한 칸 옮기기', () => {
  const ys = [2013, 2014, 2015];
  assert.equal(stepYear(ys, 2014, 1), 2015);
  assert.equal(stepYear(ys, 2015, 1), 2015);
  assert.equal(stepYear(ys, 2015, 1, true), 2013);
  assert.equal(stepYear(ys, 2013, -1, true), 2015);
});
