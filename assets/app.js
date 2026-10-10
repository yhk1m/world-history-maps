// © 2026 김용현
// SpaceArchive — 히어로 모핑, 지도 탐색기(Leaflet), 모핑 레시피, 면적 표.
(() => {
  const DATA = 'data/';
  const CDN = 'https://cdn.jsdelivr.net/gh/yhk1m/space-archive@main/data/';
  const R = 6371;
  const PALETTE = ['#b3261e', '#1f4e79', '#2e7d4f', '#b8860b', '#6a3d9a', '#00838f', '#c2185b', '#5d4037', '#455a64', '#7cb342'];
  const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  const enc = (s) => s.split('/').map(encodeURIComponent).join('/');

  // d3 는 외곽 고리를 시계 방향으로 기대한다 → GeoJSON(반시계) 고리를 뒤집는다
  function rewind(geom) {
    const fix = (ring) => (d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI ? ring.slice().reverse() : ring);
    if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(fix) };
    if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(fix)) };
    return geom;
  }
  // 모핑용: 가장 큰 조각의 외곽선
  function mainRing(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    let best = null, ba = -1;
    for (const p of polys) {
      const g = rewind({ type: 'Polygon', coordinates: [p[0]] });
      const a = d3.geoArea(g);
      if (a > ba) { ba = a; best = g; }
    }
    return best;
  }
  const areaKm2 = (geom) => d3.geoArea(rewind(geom)) * R * R;
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + '백만' : Math.round(n / 1e3) + '천') + ' km²';

  let land = null;
  const landP = getJSON('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json')
    .then((t) => (land = topojson.feature(t, t.objects.land))).catch(() => null);

  /* ---------- 히어로 모핑 ---------- */
  function hero(heroList) {
    const svg = d3.select('#morph');
    const W = 1200, H = 560;
    const proj = d3.geoNaturalEarth1().rotate([-62, 0]).fitExtent([[10, 10], [W - 10, H - 10]],
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-12, 8], [-12, 58], [140, 58], [140, 8], [-12, 8]]] } });
    const path = d3.geoPath(proj);
    svg.append('path').attr('class', 'grat').attr('d', path(d3.geoGraticule10()));
    const landG = svg.append('path').attr('class', 'land');
    landP.then((l) => l && landG.attr('d', path(l)));
    const ghost = svg.append('path').attr('class', 'ghost');
    const emp = svg.append('path').attr('class', 'emp');
    const items = heroList.map((h) => ({ ...h, d: path(mainRing(h.geometry)) })).filter((h) => h.d);
    if (!items.length) return;
    let i = 0;
    const cap = (k) => {
      d3.select('#capIdx').text(String(k + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0'));
      d3.select('#capName').text(items[k].name);
      d3.select('#capPeriod').text(items[k].period || '');
    };
    emp.attr('d', items[0].d); cap(0);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function step() {
      const a = items[i], b = items[(i + 1) % items.length];
      ghost.attr('d', a.d);
      const t = flubber.interpolate(a.d, b.d, { maxSegmentLength: 4 });
      i = (i + 1) % items.length;
      cap(i);
      emp.transition().duration(reduce ? 0 : 1700).ease(d3.easeCubicInOut).attrTween('d', () => t)
        .on('end', () => setTimeout(step, 1900));
    }
    setTimeout(step, 2200);
  }

  /* ---------- 탐색기 ---------- */
  let pmap, pLayer;
  function explorer(index) {
    const tl = document.getElementById('timeline');
    let vol = 0;
    for (const m of index.maps) {
      if (m.vol !== vol) {
        vol = m.vol;
        const h = document.createElement('div');
        h.className = 'tl-vol'; h.textContent = `VOL. ${vol}`;
        tl.appendChild(h);
      }
      const b = document.createElement('button');
      b.className = 'tl-item'; b.dataset.id = m.id;
      b.innerHTML = `<span class="pg">p.${m.page}</span><span>${m.title}</span>`;
      b.addEventListener('click', () => show(m));
      tl.appendChild(b);
    }
    pmap = L.map('pmap', { zoomSnap: 0.25, worldCopyJump: true, scrollWheelZoom: false }).setView([35, 60], 2);
    // 페이지 스크롤과 충돌하지 않게: 지도를 누른 뒤에만 휠 확대
    pmap.on('click', () => pmap.scrollWheelZoom.enable());
    pmap.on('mouseout', () => pmap.scrollWheelZoom.disable());
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 9, attribution: '© OpenStreetMap contributors' }).addTo(pmap);
    const first = index.maps.find((m) => m.id.includes('p050')) || index.maps[0];
    show(first);
  }

  async function show(m) {
    document.querySelectorAll('.tl-item').forEach((b) => b.classList.toggle('on', b.dataset.id === m.id));
    document.getElementById('pTitle').textContent = m.title;
    document.getElementById('pMeta').textContent = `${m.vol}권 ${m.page}쪽 · 영역 ${m.counts.area} · 경로 ${m.counts.line} · 지점 ${m.counts.point}`;
    const fc = await getJSON(DATA + 'lite/maps/' + enc(m.id) + '.json');
    if (pLayer) pmap.removeLayer(pLayer);
    const colors = {};
    let ci = 0;
    const legend = [];
    pLayer = L.geoJSON(fc, {
      style: (f) => {
        const p = f.properties;
        if (p._t === 'point') return {};
        if (p._t === 'line') return { color: '#111', weight: 2, dashArray: p.category === '경계선' ? '4 4' : null };
        if (!(p.name in colors)) { colors[p.name] = PALETTE[ci++ % PALETTE.length]; legend.push(['area', p.name, colors[p.name]]); }
        return { color: colors[p.name], weight: 1.3, fillOpacity: 0.22 };
      },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4, color: '#111', weight: 1, fillColor: '#fff', fillOpacity: 1 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        const sub = [p.period, p.category, p.year].filter(Boolean).join(' · ');
        l.bindTooltip(`<b>${p.name || ''}</b>${sub ? '<br>' + sub : ''}`, { sticky: true });
      },
    }).addTo(pmap);
    const b = pLayer.getBounds();
    if (b.isValid()) pmap.fitBounds(b, { padding: [16, 16] });
    if (m.counts.line) legend.push(['line', '경로·경계선', '#111']);
    if (m.counts.point) legend.push(['pt', '지점', '#111']);
    document.getElementById('pLegend').innerHTML = legend.slice(0, 14)
      .map(([t, n, c]) => `<li><i class="${t === 'area' ? '' : t === 'line' ? 'ln' : 'pt'}" style="color:${c};border-color:${c};background:${t === 'area' ? c + '33' : ''}"></i>${n}</li>`).join('')
      + (legend.length > 14 ? `<li>외 ${legend.length - 14}</li>` : '');
    document.getElementById('pFiles').innerHTML = m.files
      .map((f) => `<a href="${CDN}maps/${enc(m.id)}/${enc(f)}" target="_blank" rel="noopener" download>${f}</a>`).join('');
  }

  /* ---------- 모핑 레시피 + 면적 ---------- */
  function recipes(groups) {
    const sel = document.getElementById('mSel');
    const prefer = ['로마 제국', '오스만 제국', '무굴 제국', '비잔티움 제국', '한', '이탈리아 왕국', '영국령 인도', '정통 칼리프 시대', '우마이야 왕조', '아리아인의 정착지'];
    const names = Object.keys(groups).filter((k) => groups[k].length >= 2);
    names.sort((a, b) => (prefer.indexOf(a) + 1 || 99) - (prefer.indexOf(b) + 1 || 99) || a.localeCompare(b, 'ko'));
    sel.innerHTML = names.map((n) => `<option>${n}</option>`).join('');
    const svg = d3.select('#mSvg');
    const W = 640, H = 420;
    const landG = svg.append('path').attr('class', 'land');
    const st = svg.append('path').attr('class', 'st');
    let timer = null;

    function draw(name, play) {
      clearTimeout(timer);
      st.interrupt();
      const vs = groups[name].filter((v) => v.geometry);
      const rings = vs.map((v) => mainRing(v.geometry)).filter(Boolean);
      const fc = { type: 'FeatureCollection', features: rings.map((g) => ({ type: 'Feature', geometry: g })) };
      const proj = d3.geoNaturalEarth1().rotate([-d3.geoCentroid(fc)[0], 0]).fitExtent([[20, 20], [W - 20, H - 20]], fc);
      const path = d3.geoPath(proj);
      landP.then((l) => l && landG.attr('d', path(l)));
      const ds = rings.map((g) => path(g));
      let k = 0;
      const cap = () => d3.select('#mCap').text(`${k + 1}/${vs.length} · ${vs[k].name}${vs[k].period ? ' · ' + vs[k].period : ''} · ${vs[k].page}쪽`);
      st.attr('d', ds[0]); cap();
      const next = () => {
        if (!play || ds.length < 2) return;
        const t = flubber.interpolate(ds[k], ds[(k + 1) % ds.length], { maxSegmentLength: 3 });
        k = (k + 1) % ds.length;
        cap();
        st.transition().duration(1500).ease(d3.easeCubicInOut).attrTween('d', () => t).on('end', () => { timer = setTimeout(next, 1300); });
      };
      timer = setTimeout(next, 700);
      areaTable(vs);
    }
    sel.addEventListener('change', () => draw(sel.value, false));
    document.getElementById('mPlay').addEventListener('click', () => draw(sel.value, true));
    draw(sel.value, false);
  }

  function areaTable(vs) {
    const rows = vs.map((v) => ({ name: v.name, period: v.period || '', a: v.geometry ? areaKm2(v.geometry) : 0 }));
    const max = Math.max(...rows.map((r) => r.a), 1);
    document.getElementById('areaTbl').innerHTML = '<thead><tr><th>판</th><th>시기</th><th style="text-align:right">면적</th><th style="width:28%"></th></tr></thead><tbody>'
      + rows.map((r) => `<tr><td>${r.name}</td><td>${r.period}</td><td class="n">${fmt(r.a)}</td><td><span class="bar" style="width:${(r.a / max * 100).toFixed(1)}%"></span></td></tr>`).join('')
      + '</tbody>';
  }


  /* ---------- 시나리오 모핑 ---------- */
  function scenarios(list) {
    const svg = d3.select('#scSvg');
    const W = 760, H = 500;
    svg.append('defs').append('marker').attr('id', 'arw').attr('viewBox', '0 0 10 10').attr('refX', 8).attr('refY', 5)
      .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse')
      .append('path').attr('d', 'M0,0 L10,5 L0,10 z').attr('fill', '#111');
    const gLand = svg.append('path').attr('class', 'land');
    const gStatic = svg.append('g');
    const gLay = svg.append('g');
    const gRoute = svg.append('g');
    const chips = document.getElementById('scChips');
    let cur = null, k = 0, playing = false, timer = null, path = null, layerPaths = {};

    list.forEach((sc, i) => {
      const b = document.createElement('button');
      b.textContent = sc.title.replace(/\s[\d–]+$/, '');
      b.addEventListener('click', () => { stop(); load(i); });
      chips.appendChild(b);
    });

    function load(i) {
      cur = list[i]; k = 0;
      [...chips.children].forEach((b, j) => b.classList.toggle('on', j === i));
      const all = [];
      cur.frames.forEach((f) => Object.values(f.areas).forEach((g) => all.push({ type: 'Feature', geometry: rewind(g) })));
      const fit = all.concat(cur.frames.flatMap((f) => (f.routes || []).map((r) => ({ type: 'Feature', geometry: r.geometry }))));
      const fcAll = { type: 'FeatureCollection', features: all };
      const fcFit = { type: 'FeatureCollection', features: fit };
      const c0 = d3.geoCentroid(fcAll);  // 날짜변경선 넘는 영역(태평양)도 잘리지 않게 중심 경도로 회전
      const proj = d3.geoNaturalEarth1().rotate([-c0[0], 0]).fitExtent([[18, 18], [W - 18, H - 18]], fcFit);
      path = d3.geoPath(proj);
      landP.then((l) => l && gLand.attr('d', path(l)));
      gStatic.selectAll('*').remove(); gLay.selectAll('*').remove(); gRoute.selectAll('*').remove();
      (cur.static || []).forEach((st) => gStatic.append('path').attr('class', 'static').attr('fill', st.color).attr('d', path(rewind(st.geometry))));
      layerPaths = {};
      cur.layers.forEach((L0) => {
        layerPaths[L0.key] = gLay.append('path').attr('class', 'lay').attr('fill', L0.color + '3d').attr('stroke', L0.color);
      });
      document.getElementById('scLegend').innerHTML = cur.layers.map((L0) => `<li><i style="border-color:${L0.color};background:${L0.color}3d"></i>${L0.label}</li>`).join('')
        + ((cur.static || []).map((st) => `<li><i style="border-color:${st.color};background:${st.color}"></i>${st.label}</li>`).join(''))
        + (cur.frames.some((f) => (f.routes || []).length) ? '<li><i class="rt" style="border-color:#111"></i>진격·원정로</li>' : '');
      show(0, false);
    }

    function caption() {
      document.getElementById('scStep').textContent = `${k + 1} / ${cur.frames.length}`;
      document.getElementById('scCap').textContent = cur.frames[k].label;
    }

    function drawRoutes(f, animate) {
      gRoute.selectAll('path.route').classed('old', true);
      (f.routes || []).forEach((r, i) => {
        const p = gRoute.append('path').attr('class', 'route').attr('d', path(r.geometry)).attr('marker-end', 'url(#arw)');
        const len = p.node().getTotalLength ? p.node().getTotalLength() : 0;
        if (animate && len) {
          p.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
            .transition().delay(i * 110).duration(900).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
            .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
        }
      });
    }

    function show(j, animate) {
      const prev = cur.frames[k], next = cur.frames[j];
      const dur = animate ? 1500 : 0;
      cur.layers.forEach((L0) => {
        const el = layerPaths[L0.key];
        const gb = next.areas[L0.key];
        const ga = prev.areas[L0.key];
        if (!gb) { el.attr('d', null); return; }
        const full = path(rewind(gb));
        if (!animate || !ga || j === k) { el.attr('d', full); return; }
        const t = flubber.interpolate(path(mainRing(ga)), path(mainRing(gb)), { maxSegmentLength: 3 });
        el.interrupt().attr('d', path(mainRing(ga))).transition().duration(dur).ease(d3.easeCubicInOut)
          .attrTween('d', () => t).on('end', () => el.attr('d', full));
      });
      if (j === 0) gRoute.selectAll('*').remove();
      k = j; caption();
      setTimeout(() => drawRoutes(next, animate), animate ? dur * 0.6 : 0);
    }

    function step(dir) {
      const j = (k + dir + cur.frames.length) % cur.frames.length;
      show(j, true);
    }
    function stop() { playing = false; clearTimeout(timer); document.getElementById('scPlay').textContent = '재생'; }
    function loop() {
      if (!playing) return;
      step(1);
      timer = setTimeout(loop, 3600);
    }
    document.getElementById('scPrev').addEventListener('click', () => { stop(); step(-1); });
    document.getElementById('scNext').addEventListener('click', () => { stop(); step(1); });
    document.getElementById('scPlay').addEventListener('click', () => {
      if (playing) return stop();
      playing = true; document.getElementById('scPlay').textContent = '멈춤';
      if (k === cur.frames.length - 1) show(0, false);
      timer = setTimeout(loop, 300);
    });
    load(0);
  }

  /* ---------- 시작 ---------- */
  Promise.all([getJSON(DATA + 'index.json'), getJSON(DATA + 'lite/countries.json'), getJSON(DATA + 'lite/hero.json')])
    .then(([index, groups, heroList]) => {
      const sum = (k) => index.maps.reduce((s, m) => s + m.counts[k], 0);
      document.getElementById('stMaps').textContent = index.maps.length;
      document.getElementById('stAreas').textContent = sum('area');
      document.getElementById('stLines').textContent = sum('line');
      document.getElementById('stPts').textContent = sum('point');
      document.getElementById('stCty').textContent = index.countries.length;
      hero(heroList);
      explorer(index);
      recipes(groups);
      getJSON(DATA + 'lite/scenarios.json').then(scenarios).catch((e) => console.error('[GSA] scenarios', e));
    })
    .catch((e) => console.error('[GSA]', e));
})();
