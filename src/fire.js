// Модель костра: топливо в секундах реального времени.
export const DEFAULT_LOGS = [
  { id: 'chips', name: 'щепа', seconds: 5 * 60 },
  { id: 'birch', name: 'берёза', seconds: 20 * 60 },
  { id: 'oak', name: 'дуб', seconds: 45 * 60 },
];
/** Сколько тлеют угли после того, как огонь погас: случайно 5–10 минут (в секундах). */
export const EMBER_FADE_MIN = 5 * 60, EMBER_FADE_MAX = 10 * 60;
export function pickEmberFade(rnd = Math.random) { return EMBER_FADE_MIN + rnd() * (EMBER_FADE_MAX - EMBER_FADE_MIN); }
/** Яркость углей через t секунд после угасания (start — яркость в момент угасания). Плавно до нуля к концу. */
export function emberLevel(t, duration, start = 1) {
  if (t <= 0) return start; if (t >= duration) return 0;
  const x = t / duration; return start * (1 - x) * (1 - x * 0.5) * (1 - x) ** 0.5;
}
/** Пояснение для меню: сколько горит полено. */
export function describeLog(log) {
  const m = Math.round(log.seconds / 60);
  return `${log.name} — горит ~${m} мин`;
}
export const MAX_FUEL = 3 * 3600;      // больше не влезет в кольцо
export const FULL_FUEL = 30 * 60;      // при таком запасе огонь на максимуме
export const START_FUEL = 10 * 60;
const STORAGE_KEY = 'campfire.state.v1';

export class Fire {
  constructor({ fuel = START_FUEL, logs = DEFAULT_LOGS, now = Date.now() } = {}) {
    this.fuel = fuel;
    this.logs = logs;
    this.updatedAt = now;
    this.boost = 0; // кратковременная вспышка после броска полена (0..1)
  }
  /** Продвинуть время до now (мс). */
  tick(now = Date.now()) {
    const dt = Math.max(0, (now - this.updatedAt) / 1000);
    this.updatedAt = now;
    this.fuel = Math.max(0, this.fuel - dt);
    this.boost = Math.max(0, this.boost - dt / 8);
    return this;
  }
  addLog(id, now = Date.now()) {
    this.tick(now);
    const log = this.logs.find((l) => l.id === id);
    if (!log) throw new Error(`unknown log type: ${id}`);
    this.fuel = Math.min(MAX_FUEL, this.fuel + log.seconds);
    this.boost = Math.min(1, this.boost + 0.6);
    return this;
  }
  /** Потушить: топливо в ноль, вспышка сброшена. */
  extinguish(now = Date.now()) {
    this.tick(now);
    this.fuel = 0; this.boost = 0;
    return this;
  }
  /** Интенсивность 0..1: плавная кривая от запаса топлива. 0 = погас. */
  get intensity() {
    if (this.fuel <= 0) return 0;
    const x = Math.min(1, this.fuel / FULL_FUEL);
    const base = 0.12 + 0.88 * Math.sqrt(x); // угли тлеют даже на малом запасе
    return Math.min(1, base + this.boost * 0.25);
  }
  get isOut() { return this.fuel <= 0; }
  toJSON() { return { fuel: this.fuel, updatedAt: this.updatedAt }; }
  static fromJSON(data, opts = {}) {
    const f = new Fire({ ...opts, fuel: Number(data?.fuel) || 0, now: Number(data?.updatedAt) || Date.now() });
    return f;
  }
  save(storage = globalThis.localStorage) {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(this)); } catch {}
  }
  /** Загрузить состояние; время, пока вкладка была закрыта, учитывается. */
  static load(storage = globalThis.localStorage, now = Date.now(), opts = {}) {
    let raw = null;
    try { raw = storage?.getItem(STORAGE_KEY); } catch {}
    if (!raw) return new Fire({ ...opts, now });
    try { return Fire.fromJSON(JSON.parse(raw), opts).tick(now); }
    catch { return new Fire({ ...opts, now }); }
  }
}
export { STORAGE_KEY };
