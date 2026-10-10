// © 2026 김용현
// 고도 격자 ↔ base64(Int16, 1 m 단위) — 내보낸 HTML 에 격자를 싣는 형식.

export function encodeGrid(f32) {
  const i16 = new Int16Array(f32.length);
  for (let k = 0; k < f32.length; k++) i16[k] = Math.max(-32768, Math.min(32767, Math.round(f32[k])));
  const bytes = new Uint8Array(i16.buffer);
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

export function decodeGrid(b64, n) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) bytes[k] = s.charCodeAt(k);
  return Float32Array.from(new Int16Array(bytes.buffer, 0, n));
}
