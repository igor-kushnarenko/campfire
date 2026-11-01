// Настройки пользователя: громкости слоёв звука и дождь. Хранятся в localStorage.
export const SETTINGS_KEY = 'campfire.settings.v1';
export const SOUND_LAYERS = [
  { id: 'fire', name: 'огонь' }, { id: 'crickets', name: 'сверчки' }, { id: 'water', name: 'вода' },
  { id: 'wind', name: 'ветер' }, { id: 'owl', name: 'сова/птицы' }, { id: 'rain', name: 'дождь' },
];
export const DEFAULT_SETTINGS = { rain: false, rainLevel: 0.35, volumes: { fire: 1, crickets: 1, water: 1, wind: 0.8, owl: 1, rain: 1 } };
const clamp01 = (x, d) => (Number.isFinite(+x) ? Math.min(1, Math.max(0, +x)) : d);
export function loadSettings(storage = globalThis.localStorage) {
  let raw = null; try { raw = JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null'); } catch {}
  const v = {}; for (const { id } of SOUND_LAYERS) v[id] = clamp01(raw?.volumes?.[id], DEFAULT_SETTINGS.volumes[id]);
  return { rain: !!raw?.rain, rainLevel: clamp01(raw?.rainLevel, 0.35), volumes: v };
}
export function saveSettings(s, storage = globalThis.localStorage) { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }
export function toggleRain(s) { return { ...s, rain: !s.rain }; }

export const DEFAULT_RAIN_LEVEL = 0.35;
export function setRainLevel(s, level) { return { ...s, rainLevel: clamp01(level, DEFAULT_RAIN_LEVEL) }; }
const lerp = (a, b, t) => a + (b - a) * t;
/**
 * Сила дождя 0..1 → параметры эффектов. 0 — редкие отдельные капли, 1 — ливень.
 * Все величины монотонны по силе, огонь при ливне приглушается, но не гаснет.
 */
export function rainParams(level) {
  const l = clamp01(level, DEFAULT_RAIN_LEVEL);
  return {
    density: lerp(0.012, 0.62, l ** 1.3),   // доля «живых» капель
    speed: lerp(0.75, 1.3, l),              // множитель скорости падения
    length: lerp(0.55, 1.7, l),             // множитель длины штриха
    slant: lerp(0.1, 0.34, l),              // наклон (ветер)
    alpha: lerp(0.65, 1.15, l),
    rings: lerp(0.06, 0.7, l),              // доля ячеек с кругами на воде
    soundGain: lerp(0.012, 0.17, l ** 1.2), // шум дождя
    soundCutoff: lerp(3500, 9500, l),       // тембр: от глухого к шипящему
    dripInterval: lerp(0.7, 0.03, l),       // средний интервал отдельных капель, с
    dripGain: lerp(1.3, 0.6, l),            // при слабом дожде капли слышнее на фоне
    desat: lerp(0.08, 0.42, l),
    darken: lerp(0.05, 0.22, l),
    fog: lerp(1, 2.3, l),                   // множитель тумана
    fireDamp: lerp(0.05, 0.42, l),          // доля, на которую приглушается огонь
  };
}
