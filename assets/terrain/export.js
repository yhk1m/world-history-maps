// © 2026 김용현
// 파일 하나로 완결된 3D 지형 HTML 만들기: three.js·우리 모듈을 import map 의 data: URL 로, 격자·벡터는 JSON 으로 싣는다.

import { encodeGrid } from 'whm/codec';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
const MODULES = ['clip', 'mesh', 'overlay', 'codec', 'viewer'];

const cache = new Map();
const text = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.text(); }));
  return cache.get(url);
};

// 순수 모듈끼리의 상대 import('./clip.js')를 import map 이름('whm/clip')으로
export const rewriteImports = (src) => src.replace(/from\s+'\.\/(\w+)\.js'/g, "from 'whm/$1'");

function dataURL(src) {
  const bytes = new TextEncoder().encode(src);
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  return 'data:text/javascript;base64,' + btoa(s);
}

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function buildHTML(payload) {
  const base = new URL('./', import.meta.url);
  const [three, orbit, ...mods] = await Promise.all([text(THREE_URL), text(ORBIT_URL), ...MODULES.map((m) => text(new URL(`${m}.js`, base).href))]);
  const imports = { three: dataURL(three), 'three/addons/controls/OrbitControls.js': dataURL(orbit) };
  MODULES.forEach((m, i) => { imports[`whm/${m}`] = dataURL(rewriteImports(mods[i])); });
  const { grid, ...rest } = payload;
  const data = { ...rest, grid: { w: grid.w, h: grid.h, bbox: grid.bbox, b64: encodeGrid(grid.data) } };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3D 지형 — ${escAttr(payload.title || '')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>html,body{margin:0;height:100%;background:#f6f5f2}#v{position:fixed;inset:0}</style>
<script type="importmap">${JSON.stringify({ imports })}</script>
</head>
<body>
<div id="v"></div>
<script type="application/json" id="payload">${json}</script>
<script type="module">
import { createViewer } from 'whm/viewer';
import { decodeGrid } from 'whm/codec';
const p = JSON.parse(document.getElementById('payload').textContent);
p.grid.data = decodeGrid(p.grid.b64, p.grid.w * p.grid.h);
createViewer(document.getElementById('v'), p);
</script>
</body>
</html>
`;
}

export function download(name, html) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
