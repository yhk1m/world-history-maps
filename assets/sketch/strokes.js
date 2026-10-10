// © 2026 김용현
// 크로키 획 저장소: 그리기·지우기·모두 지우기를 모두 되돌릴 수 있다. DOM 에 의존하지 않는다.
// 획 = { id, tool: 'pen'|'hi'|'arrow'|'text', color, width, coords: [[lon, lat], …], text? }

export function createStore() {
  let items = [], undoStack = [], redoStack = [], seq = 1;
  const subs = [];
  const emit = () => subs.forEach((f) => f());

  // 작업 하나를 적용·되돌리는 규칙
  const apply = (op) => {
    if (op.type === 'add') items.splice(op.index, 0, op.stroke);
    else if (op.type === 'erase') items.splice(op.index, 1);
    else if (op.type === 'clear') items = [];
  };
  const revert = (op) => {
    if (op.type === 'add') items.splice(op.index, 1);
    else if (op.type === 'erase') items.splice(op.index, 0, op.stroke);
    else if (op.type === 'clear') items = op.before.slice();
  };
  const run = (op) => { apply(op); undoStack.push(op); redoStack = []; emit(); };

  return {
    list: () => items.slice(),
    add(s) {
      const stroke = { ...s, id: s.id || `s${Date.now().toString(36)}${seq++}` };
      run({ type: 'add', stroke, index: items.length });
      return stroke;
    },
    erase(id) {
      const index = items.findIndex((x) => x.id === id);
      if (index >= 0) run({ type: 'erase', stroke: items[index], index });
    },
    clear() { if (items.length) run({ type: 'clear', before: items.slice() }); },
    undo() { const op = undoStack.pop(); if (op) { revert(op); redoStack.push(op); emit(); } },
    redo() { const op = redoStack.pop(); if (op) { apply(op); undoStack.push(op); emit(); } },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    onChange(f) { subs.push(f); },
    dump: () => JSON.stringify(items),
    load(text) {
      try {
        const a = JSON.parse(text);
        items = Array.isArray(a) ? a.filter((x) => x && Array.isArray(x.coords)) : [];
      } catch { items = []; }
      undoStack = []; redoStack = [];
      emit();
    },
    toGeoJSON() {
      return {
        type: 'FeatureCollection',
        features: items.map((s) => (s.tool === 'text'
          ? { type: 'Feature', properties: { tool: 'text', text: s.text || '', color: s.color }, geometry: { type: 'Point', coordinates: s.coords[0] } }
          : { type: 'Feature', properties: { tool: s.tool, color: s.color, width: s.width }, geometry: { type: 'LineString', coordinates: s.coords } })),
      };
    },
  };
}
