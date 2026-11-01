// Настройки пользователя: громкости слоёв звука и дождь. Хранятся в localStorage.
export const SETTINGS_KEY = 'campfire.settings.v1';
export const SOUND_LAYERS = [
  { id: 'fire', name: 'огонь' }, { id: 'crickets', name: 'сверчки' }, { id: 'water', name: 'вода' },
  { id: 'wind', name: 'ветер' }, { id: 'owl', name: 'сова/птицы' }, { id: 'rain', name: 'дождь' },
];
export const DEFAULT_SETTINGS = { rain: false, volumes: { fire: 1, crickets: 1, water: 1, wind: 0.8, owl: 1, rain: 1 } };
const clamp01 = (x, d) => (Number.isFinite(+x) ? Math.min(1, Math.max(0, +x)) : d);
export function loadSettings(storage = globalThis.localStorage) {
  let raw = null; try { raw = JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null'); } catch {}
  const v = {}; for (const { id } of SOUND_LAYERS) v[id] = clamp01(raw?.volumes?.[id], DEFAULT_SETTINGS.volumes[id]);
  return { rain: !!raw?.rain, volumes: v };
}
export function saveSettings(s, storage = globalThis.localStorage) { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }
export function toggleRain(s) { return { ...s, rain: !s.rain }; }
