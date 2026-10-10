// © 2026 김용현
// SEED Design(당근 디자인 시스템, @seed-design/css 3.0.2, Apache-2.0) 어댑터 — 중립색(neutral) 톤.
// 페이지의 기존 마크업(.btn · .chips button · 체크박스)에 SEED 레시피 클래스를 입힌다.
// 상태(.ghost · .on · .t-small)가 스크립트로 바뀌어도 따라가도록 DOM 변화를 지켜본다.
(() => {
  // @seed-design/css recipes/shared.mjs 의 createClassName 과 같은 규칙
  const cls = (base, variants, compounds = []) => [
    base,
    ...Object.entries(variants).map(([k, v]) => `${base}--${k}_${v}`),
    ...compounds.filter((c) => Object.keys(c).every((k) => c[k] === variants[k]))
      .map((c) => `${base}--${Object.entries(c).map(([k, v]) => `${k}_${v}`).join('-')}`),
  ];
  const SIZES = ['xsmall', 'small', 'medium', 'large'];
  const btnCompounds = SIZES.flatMap((size) => [{ size, layout: 'withText' }, { size, layout: 'iconOnly' }]);
  const chipCompounds = ['large', 'medium', 'small'].flatMap((size) => [{ size, layout: 'withText' }, { size, layout: 'iconOnly' }]);
  const markCompounds = [
    { variant: 'square', tone: 'neutral' }, { variant: 'square', tone: 'brand' },
    { variant: 'ghost', tone: 'neutral' }, { variant: 'ghost', tone: 'brand' },
    { size: 'medium', variant: 'ghost' }, { size: 'large', variant: 'ghost' },
    { size: 'medium', variant: 'square' }, { size: 'large', variant: 'square' },
  ];

  // 원하는 SEED 클래스 묶음을 이전 묶음과 바꿔 끼운다(같으면 손대지 않아 감시 고리가 돌지 않는다)
  const apply = (el, want) => {
    const prev = el.dataset.seedCls || '';
    const next = want.join(' ');
    if (prev === next) return;
    if (prev) el.classList.remove(...prev.split(' '));
    el.classList.add(...want);
    el.dataset.seedCls = next;
  };

  function upgrade(el) {
    if (el.matches('.btn')) {
      const size = el.matches('.t-small') ? 'small' : 'medium';
      apply(el, cls('seed-action-button', { variant: el.matches('.ghost') ? 'neutralOutline' : 'neutralSolid', size, layout: 'withText' }, btnCompounds));
    } else if (el.matches('.chips button, .sk-colors-none')) {
      const size = el.closest('.t-panel') ? 'small' : 'medium';
      apply(el, cls('seed-chip__root', { variant: 'outlineStrong', size, layout: 'withText' }, chipCompounds));
      el.toggleAttribute('data-checked', el.classList.contains('on'));
    } else if (el.matches('input[type="checkbox"]')) {
      apply(el, cls('seed-checkmark__root', { variant: 'square', tone: 'neutral', size: 'medium' }, markCompounds));
    }
  }
  const SEL = '.btn, .chips button, input[type="checkbox"]';
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.matches(SEL)) upgrade(root);
    root.querySelectorAll(SEL).forEach(upgrade);
  };

  function start() {
    // 3D 화면 위 조절판(.whm3d — 내보낸 파일과 같은 모양을 유지)은 SEED 를 입히지 않는다
    const skip = (el) => el.closest && el.closest('.whm3d');
    scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !skip(n)) scan(n); });
        else if (m.type === 'attributes' && !skip(m.target) && m.target.matches(SEL)) upgrade(m.target);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    document.querySelectorAll('.whm3d .seed-checkmark__root').forEach((i) => apply(i, []));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
