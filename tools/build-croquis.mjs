// © 2026 김용현
// croquis.html 만들기 — 크로키(지도 위에 그리기)를 파일 하나로.
// 소개 페이지의 크로키와 같은 코드(assets/sketch/strokes.js · sketch.js, SEED 어댑터)를 그대로 담아,
// 다른 사람이 이 파일 하나만 받아 열고 고쳐 쓸 수 있게 한다(바이브 코딩용). 실행: npm run build:croquis
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const stripHeader = (s) => s.replace(/^\/\/ © .*\r?\n/, '').replace(/^\/\* © .*\*\/\r?\n/, '');

// 모듈 → 한 스크립트: import 줄을 지우고 export 를 뗀다
const strokes = stripHeader(read('assets/sketch/strokes.js')).replace(/^export /gm, '');
const clip = read('assets/terrain/clip.js');
const lonExtent = clip.slice(clip.indexOf('// 경도 목록을 덮는 가장 짧은 구간')).replace(/^export /gm, '');
const arrow = stripHeader(read('assets/arrow.js')).replace(/^export /gm, '');
const sketch = stripHeader(read('assets/sketch/sketch.js')).replace(/^import .*\r?\n/gm, ''); // 줄바꿈이 CRLF 여도
const seedJs = stripHeader(read('assets/seed.js'));
const seedCss = stripHeader(read('assets/seed.css'));

// style.css 에서 크로키에 쓰는 규칙만 골라 온다(:root 토큰, 칩, 크로키 부품)
const styleCss = read('assets/style.css').replace(/\/\*[\s\S]*?\*\//g, ''); // 주석을 지워야 선택자를 바로 읽는다
const rules = [];
const want = (sel) => /(^|\s|,):root|\.chips|\.sk-|#skSvg|\.sketch|\.btn|select|input\[type="file"\]/.test(sel);
for (const m of styleCss.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim();
  if (sel && want(sel)) rules.push(`${sel} {${m[2]}}`);
}

const html = `<!doctype html>
<!-- © 2026 김용현 · SpaceArchive 크로키 (https://yhk1m.github.io/space-archive/) -->
<html lang="ko" data-seed-color-mode="light-only">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>크로키 — SpaceArchive</title>
<!--
  ■ 바이브 코딩 안내 — 이 파일 하나에 크로키가 다 들어 있습니다.
    · 바탕 지도 자료: 같은 사이트에서 열면 data/, 아니면 공개 CDN(아래 CDN 상수)에서 받아 옵니다.
      다른 자료를 쓰려면 window.SA_DATA 에 주소를 넣으세요(예: <script>window.SA_DATA='https://…/data/'</script>).
    · 고칠 곳 찾기: 「획 저장소」(되돌리기·GeoJSON), 「크로키」(그리기 도구·바탕 지도·저장), 「SEED 어댑터」(단추·칩 모양).
    · 쓰는 라이브러리: d3 7.9.0, topojson-client 3.1.0, SEED Design CSS 3.0.2 (모두 CDN).
    · 이 파일은 tools/build-croquis.mjs 가 assets/sketch/*.js 로 만듭니다. 사이트의 원본을 고치려면 그쪽을 고치세요.
-->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@seed-design/css@3.0.2/base.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@seed-design/css@3.0.2/recipes/action-button.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@seed-design/css@3.0.2/recipes/chip.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@seed-design/css@3.0.2/recipes/checkmark.css">
<style>
${rules.join('\n')}
/* 한 장짜리 화면 */
body { margin: 0; background: var(--paper, #fff); color: var(--ink, #111); font-family: Pretendard, system-ui, sans-serif; font-size: 15px; line-height: 1.6; }
.cq-wrap { display: grid; grid-template-columns: 340px 1fr; gap: 28px; padding: 22px 26px; max-width: 1500px; margin: 0 auto; box-sizing: border-box; }
.cq-wrap > * { min-width: 0; }
.cq-panel h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.02em; }
.cq-panel p { color: var(--ink-2, #4a4a4a); font-size: 13.5px; margin: 0 0 14px; }
.cq-panel .ctrl { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.cq-stage { margin: 0; background: var(--soft, #f6f5f2); border-radius: 12px; overflow: hidden; }
.cq-stage svg { width: 100%; height: auto; display: block; }
.cq-stage figcaption { padding: 8px 14px; font-size: 13px; color: var(--ink-2, #4a4a4a); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.cq-foot { font-size: 11.5px; color: var(--ink-3, #9a9a9a); margin-top: 18px; }
@media (max-width: 900px) { .cq-wrap { grid-template-columns: 1fr; padding: 16px; } }
${seedCss}
</style>
</head>
<body>
<div class="cq-wrap sketch">
  <section class="cq-panel">
    <h1>크로키</h1>
    <p>바탕 지도를 깔고 펜·형광펜·화살표·글자로 그려 봅니다. 그린 선은 경위도로 저장되어 확대해도 땅에 붙어 있고, 그림은 PNG 로, 선과 글자는 GeoJSON 으로 내보낼 수 있습니다.</p>
    <select id="skMap" class="sk-map" aria-label="바탕 지도"></select>
    <select id="skYear" class="sk-map" aria-label="행정구역 연도" hidden></select>
    <div class="chips" id="skTools" aria-label="도구">
      <button class="on" data-tool="pen">펜</button>
      <button data-tool="hi">형광펜</button>
      <button data-tool="arrow">화살표</button>
      <button data-tool="text">글자</button>
      <button data-tool="erase">지우개</button>
    </div>
    <div class="sk-row">
      <div class="chips" id="skWidths" aria-label="굵기">
        <button data-w="thin">가늘게</button>
        <button class="on" data-w="mid">보통</button>
        <button data-w="thick">굵게</button>
      </div>
      <div class="sk-colors" id="skColors" aria-label="색">
        <button class="on" data-c="#b3261e" style="--c:#b3261e" aria-label="빨강"></button>
        <button data-c="#1f4e79" style="--c:#1f4e79" aria-label="파랑"></button>
        <button data-c="#111111" style="--c:#111111" aria-label="검정"></button>
        <button data-c="#2e7d4f" style="--c:#2e7d4f" aria-label="초록"></button>
        <button data-c="#e07b00" style="--c:#e07b00" aria-label="주황"></button>
        <button data-c="#6a3d9a" style="--c:#6a3d9a" aria-label="보라"></button>
      </div>
    </div>
    <details class="sk-layers"><summary>바탕 레이어</summary><div id="skLayers"></div></details>
    <div class="ctrl">
      <button class="btn ghost" id="skUndo" disabled>되돌리기</button>
      <button class="btn ghost" id="skRedo" disabled>다시하기</button>
      <button class="btn ghost" id="skClear">모두 지우기</button>
    </div>
    <div class="ctrl">
      <button class="btn" id="skPng">PNG 저장</button>
      <button class="btn ghost" id="skGeo">GeoJSON 저장</button>
    </div>
    <p class="cq-foot">SpaceArchive 크로키 · 지도 자료와 출처는 <a href="https://yhk1m.github.io/space-archive/">yhk1m.github.io/space-archive</a></p>
  </section>
  <figure class="cq-stage sk-fig"><svg id="skSvg" data-tool="pen" aria-label="크로키 지도"></svg>
    <figcaption>휠 = 확대 · Space 를 누른 채 끌기 = 이동 · Ctrl+Z 되돌리기 <button class="sk-fit" id="skFit">화면 맞춤</button></figcaption></figure>
</div>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"></script>
<script>
/* ── SEED 어댑터 (assets/seed.js) ── */
${seedJs}
</script>
<script type="module">
/* ── 획 저장소 (assets/sketch/strokes.js) ── */
${strokes}
/* ── 화살표 모양 (assets/arrow.js, 3D 모형과 같은 모양) ── */
${arrow}
/* ── 경도 구간 (assets/terrain/clip.js 의 lonExtent) ── */
${lonExtent}
/* ── 크로키 (assets/sketch/sketch.js) ── */
${sketch}
</script>
</body>
</html>
`;
fs.writeFileSync(new URL('croquis.html', root), html);
console.log('croquis.html', (html.length / 1024).toFixed(1), 'KB');
