# World History Maps

고등학교 「세계사」(미래엔) 교과서 지도 76개를 웹지도 위에 다시 그린 **GeoJSON 공간 데이터**입니다.
영역 473 · 경로·경계선 421 · 지점 688 · 나라별 모음 327.

- 소개·활용 안내 페이지: https://yhk1m.github.io/world-history-maps/
- 좌표계 EPSG:4326(경위도), UTF-8

## 구성
```
data/
├─ maps/{권}권_p{쪽}_{지도 제목}/
│   영역_전체.geojson · 영역_{나라·왕조·시기}.geojson · 경로.geojson · 지점.geojson
├─ countries/{나라}/{나라}_모음.geojson   같은 나라의 지도별 판 모음
├─ lite/                                  웹 시연용 가벼운 판
├─ index.json                             지도·나라 색인
├─ 목록.csv · 국가별_목록.csv
```

## 속성
| 속성 | 뜻 |
|---|---|
| `name`, `name_en` | 이름 |
| `period` | 범례가 가리키는 시기 |
| `kind` | 영역 종류: 국가·세력권·문명·식민지·종교·기타 |
| `category` | 경로(정복·원정로, 이동로, 교역로, 항해로, 진격로, 경계선) / 지점(수도, 도시, 격전지, 항구, 유적) |
| `year` | 지점의 연도 |
| `legend` | 교과서 범례 문구 |
| `source`, `volume`, `page` | 교과서 권·쪽 |
| `coast_snap`, `border_snap`, `geometry_source` | 해안·국경 맞춤 여부 |

## 바로 불러오기
```
https://cdn.jsdelivr.net/gh/yhk1m/world-history-maps@main/data/maps/{지도}/{파일}
```
(한글 경로는 `encodeURIComponent` 로 인코딩)

## 3D 지형 (`terrain.html`)
구역(직접 그리기 · 네모·세모·원 틀 · 현대 국가 · 대륙 · 과거 영토)을 고르면 해저까지 담은 3D 지형 위에 역사 지도를 덮어 보여 주고, 인터넷 없이 열리는 HTML 파일 하나로 내보낸다.
- 고도·수심: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)(Terrarium, SRTM·GEBCO·ETOPO1 등)
- 현대 국가·대륙: Natural Earth 10m 간략판(`data/lite/ne_countries.json`)
- 한국사 시기별 영토: `data/lite/maps/한국사_*.json`, 목록 `data/lite/korea_index.json` (史뿐史뿐 한국사 아틀라스 영토 자료)
- 코드: `assets/terrain/*.js` — 계산 모듈(clip·dem·mesh·overlay·codec)은 `npm test`(Node 내장 테스트)로 확인

## 만든 방법
1. 지도마다 기준점 12~50개로 지리참조
2. PDF 벡터 도형에서 영역·경로 추출(일부 색 분할)
3. 웹지도 기준 보정: 최적 투영 + 박판 스플라인, 교과서 해안선 ↔ Natural Earth 해안선 자동 대응점
4. 해안 쪽 테두리는 Natural Earth 10m 해안선에, 현대 국경과 나란한 구간은 국경선에 맞춤.
   현대 나라를 그린 지도(4권 p201·203·204·206·210)는 실제 국가 경계로 교체

옛 경계는 교과서 그림의 단순화만큼(수십 km) 실제와 다를 수 있습니다.

## 출처·이용 조건
- 원본: 미래엔 고등학교 「세계사」 교과서 지도. 이 저장소는 그 지도를 바탕으로 다시 그린 **벡터 데이터만** 담고 있으며, 교과서 그림은 포함하지 않습니다.
- 데이터는 **교육·비영리 목적**으로 출처를 밝혀 자유롭게 쓸 수 있습니다.
- 해안선·국경: Natural Earth(퍼블릭 도메인).
- 웹페이지 코드(`index.html`, `assets/`): MIT.

인용: 김용현(2026). World History Maps: 세계사 교과서 지도 GeoJSON. https://github.com/yhk1m/world-history-maps
