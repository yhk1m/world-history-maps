# 크로키(지도 위에 그리기) 설계

날짜: 2026-10-10 · 소개 페이지(index.html) 레시피 「B 크로키」

## 목표
역사 지도(세계사 76판·한국사 9판·바탕만)를 깔고 그 위에 펜·형광펜·화살표·글자로 그린 뒤 PNG·GeoJSON 으로 저장한다.

## 범위 밖
여러 사람 함께 그리기, 서버 저장, 백지도 채점.

## 화면
- 레시피 왼쪽: 설명, 바탕 지도 고르기, 도구(펜·형광펜·화살표·글자·지우개), 굵기 3단계, 색 6가지, 되돌리기·다시하기·모두 지우기, PNG·GeoJSON 저장.
- 오른쪽: d3 SVG 지도. 휠 = 확대, Space + 끌기 = 이동. 펜 입력은 pointer events(마우스·터치·펜).
- 바탕: 육지(land-50m) + 고른 지도의 영역(옅은 색) + 지점 이름.

## 데이터
- 획 = `{id, tool:'pen'|'hi'|'arrow'|'text', color, width, coords:[[lon,lat],…], text?}` — 경위도로 저장해 확대·이동해도 땅에 붙는다.
- 저장소(strokes.js, 순수): add · erase(id) · clear · undo · redo · toGeoJSON · load. clear·erase 도 되돌릴 수 있다.
- 브라우저 localStorage 에 바탕 지도별로 임시 저장(try/catch, 없어도 동작).

## 내보내기
- PNG: SVG 를 인라인 속성만으로 그려 두고 직렬화 → canvas(2배) → 내려받기.
- GeoJSON: 획 = LineString(속성 tool·color·width), 글자 = Point(속성 text·color).

## 확인
- strokes.js Node 테스트(되돌리기·다시하기·지우기·GeoJSON).
- 헤드리스 캡처: 그린 뒤 확대해도 획이 같은 땅 위에 있는지.
