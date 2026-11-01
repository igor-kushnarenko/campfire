// Модель дров: поленница, поленья в костре, горение по породам, угли, топор. Без DOM — тестируется в node.
export const SPRITES = {
  birch_thin: { species: 'birch', thick: 0.3 }, birch_medium: { species: 'birch', thick: 0.6 },
  birch_thick: { species: 'birch', thick: 1.0 }, birch_split: { species: 'birch', thick: 0.7 },
  oak_thin: { species: 'oak', thick: 0.3 }, oak_medium: { species: 'oak', thick: 0.65 },
  oak_thick: { species: 'oak', thick: 1.0 }, oak_split: { species: 'oak', thick: 0.75 },
  pine_medium: { species: 'pine', thick: 0.6 }, pine_thick: { species: 'pine', thick: 0.95 },
  kindling: { species: 'kindling', thick: 0.25 }, twigs: { species: 'twigs', thick: 0.1 },
};
export const SPECIES = {
  //          базовое время горения (с) при толщине 1, яркость пика, «треск», сколько углей оставляет
  kindling: { name: 'растопка', base: 520, peak: 1.0, crackle: 0.5, coal: 0.15 },
  twigs: { name: 'хворост', base: 380, peak: 0.9, crackle: 0.7, coal: 0.05 },
  birch: { name: 'берёза', base: 1500, peak: 0.85, crackle: 0.5, coal: 0.6 },
  oak: { name: 'дуб', base: 3000, peak: 0.75, crackle: 0.2, coal: 1.0 },
  pine: { name: 'сосна', base: 1100, peak: 0.92, crackle: 1.0, coal: 0.4 },
};
export const PILE_MAX = 14, PILE_START = 12, FIRE_MAX = 10;
export const PHASES = ['ignite', 'burn', 'smolder', 'coals'];

/** Полное время горения полена (с): растёт с толщиной, у дуба самое долгое. */
export function burnDuration(species, thick) {
  const s = SPECIES[species]; return s.base * (0.35 + 0.65 * thick) ** 1.4;
}
/** Где пик жара (доля прогресса): у толстых позже. */
export const peakAt = (thick) => 0.12 + 0.28 * thick;
/** Кривая жара 0..peak по прогрессу 0..1: разгорание → пик → тление → угли. */
export function heatCurve(species, thick, p) {
  if (p <= 0 || p >= 1) return 0;
  const s = SPECIES[species], pk = peakAt(thick);
  // дуб — широкое ровное плато, растопка — короткий яркий всплеск
  const plateau = species === 'oak' ? 0.35 : species === 'birch' ? 0.2 : species === 'pine' ? 0.15 : 0.05;
  let h;
  if (p < pk) h = Math.sin((p / pk) * Math.PI / 2) ** 1.5;
  else if (p < pk + plateau) h = 1;
  else { const x = (p - pk - plateau) / Math.max(1e-6, 1 - pk - plateau); h = (1 - x) ** 1.6 * 0.9 + 0.1 * (1 - x); }
  return s.peak * h;
}
export function phaseOf(species, thick, p) {
  const pk = peakAt(thick);
  if (p < pk * 0.6) return 'ignite';
  if (p < 0.65) return 'burn';
  if (p < 0.9) return 'smolder';
  return 'coals';
}

export const randomSprite = (rnd = Math.random) => { const k = Object.keys(SPRITES); return k[Math.floor(rnd() * k.length) % k.length]; };
let uid = 1;
export function makeLog(sprite, rnd = Math.random) {
  const m = SPRITES[sprite]; if (!m) throw new Error('unknown sprite ' + sprite);
  return { id: uid++, sprite, species: m.species, thick: m.thick, moisture: 0.1 + rnd() * 0.15, p: 0, wet: false, seed: rnd() };
}

export class Woodpile {
  constructor({ pile = null, fire = [], coal = 0, chops = 0, chopNeed = 2, rnd = Math.random } = {}) {
    this.rnd = rnd;
    this.pile = pile ?? Array.from({ length: PILE_START }, () => makeLog(randomSprite(rnd), rnd));
    this.fire = fire; this.coal = coal; this.chops = chops; this.chopNeed = chopNeed;
  }
  get pileFull() { return this.pile.length >= PILE_MAX; }
  /** Взять полено из поленницы: по id, по породе или любое (если породы нет — случайное). */
  take({ id = null, species = null } = {}) {
    let i = id != null ? this.pile.findIndex((l) => l.id === id) : -1;
    if (i < 0 && species) { const c = this.pile.map((l, k) => [l, k]).filter(([l]) => l.species === species); if (c.length) i = c[Math.floor(this.rnd() * c.length)][1]; }
    if (i < 0 && id == null && this.pile.length) i = Math.floor(this.rnd() * this.pile.length);
    if (i < 0) return null;
    return this.pile.splice(i, 1)[0];
  }
  putBack(log) { if (this.pile.length < PILE_MAX) this.pile.push(log); }
  /** Положить в костёр. Затушенные поленья тоже снова начинают гореть (медленно — мокрые). */
  addToFire(log, raining = false) {
    log.moisture = Math.min(1, log.moisture + (raining ? 0.2 : 0));
    this.fire.push(log);
    for (const l of this.fire) l.wet = false;
    while (this.fire.length > FIRE_MAX) { const old = this.fire.shift(); this.coal = Math.min(1.5, this.coal + SPECIES[old.species].coal * 0.5); }
    return log;
  }
  /** Сколько жара даёт каждое полено сейчас и общий жар. */
  heat() {
    let sum = 0;
    for (const l of this.fire) if (!l.wet) sum += heatCurve(l.species, l.thick, l.p) * (1 - l.moisture * 0.6) * (0.6 + 0.4 * l.thick);
    return sum;
  }
  /** Интенсивность огня 0..1 из суммы жара поленьев (насыщение). */
  /** 0..1.5: ~1 при 3 поленьях, до 1.5 (мощный высокий огонь) при 8–10. */
  intensity() { const h = this.heat(); return h <= 0 ? 0 : 1.5 * (1 - Math.exp(-h * 0.62)); }
  get burning() { return this.fire.some((l) => !l.wet && l.p < 1); }
  /** Продвинуть горение на dt секунд. raining: поленья мокнут, горят медленнее. */
  tick(dt, raining = false) {
    if (dt <= 0) return this;
    const warm = this.intensity();
    for (const l of this.fire) {
      if (l.wet) continue;
      // сушка у огня / намокание под дождём
      l.moisture = Math.min(1, Math.max(0, l.moisture + dt * (raining ? 0.0015 : 0) - dt * 0.004 * warm));
      const rate = 1 / burnDuration(l.species, l.thick) / (1 + l.moisture * 1.5);
      // разгорание нужно соседям: одиночное толстое полено без углей разгорается медленно
      const help = l.p < peakAt(l.thick) * 0.6 ? 0.35 + 0.65 * Math.min(1, warm + this.coal) : 1;
      l.p = Math.min(1, l.p + dt * rate * help);
    }
    // прогоревшие поленья рассыпаются в угли
    for (let i = this.fire.length - 1; i >= 0; i--) {
      const l = this.fire[i];
      if (l.p >= 1) { this.coal = Math.min(1.5, this.coal + SPECIES[l.species].coal * (0.4 + 0.6 * l.thick)); this.fire.splice(i, 1); }
    }
    return this;
  }
  /** Потушить: все поленья становятся мокрым углём (прогресс замирает). */
  douse() { for (const l of this.fire) { l.wet = true; l.moisture = 1; } return this; }
  /** Удар топором. Через 2–3 удара в поленницу скатывается новое полено. */
  chop() {
    if (this.pileFull) return { full: true, log: null, chops: this.chops };
    this.chops++;
    if (this.chops >= this.chopNeed) {
      this.chops = 0; this.chopNeed = 2 + (this.rnd() < 0.5 ? 0 : 1);
      const log = makeLog(randomSprite(this.rnd), this.rnd); this.pile.push(log);
      return { full: false, log, chops: 0 };
    }
    return { full: false, log: null, chops: this.chops };
  }
  toJSON() { return { pile: this.pile, fire: this.fire, coal: this.coal, chops: this.chops, chopNeed: this.chopNeed }; }
  static fromJSON(d, rnd = Math.random) {
    const ok = (l) => l && SPRITES[l.sprite] && Number.isFinite(l.p);
    const fix = (l) => { const m = SPRITES[l.sprite]; uid = Math.max(uid, (l.id | 0) + 1); return { ...l, species: m.species, thick: m.thick }; };
    return new Woodpile({ pile: (d?.pile || []).filter(ok).slice(0, PILE_MAX).map(fix), fire: (d?.fire || []).filter(ok).slice(-FIRE_MAX).map(fix),
      coal: Number(d?.coal) || 0, chops: d?.chops | 0, chopNeed: d?.chopNeed || 2, rnd });
  }
}
export const WOOD_KEY = 'campfire.wood.v1';
export function saveWood(w, now, storage = globalThis.localStorage) { try { storage?.setItem(WOOD_KEY, JSON.stringify({ ...w.toJSON(), at: now })); } catch {} }
/** Загрузить: время, пока вкладка была закрыта, догорает (не больше 6 часов). */
export function loadWood(storage = globalThis.localStorage, now = Date.now(), rnd = Math.random) {
  let d = null; try { d = JSON.parse(storage?.getItem(WOOD_KEY) || 'null'); } catch {}
  if (!d) return null;
  const w = Woodpile.fromJSON(d, rnd);
  let left = Math.min(6 * 3600, Math.max(0, (now - (Number(d.at) || now)) / 1000));
  while (left > 0) { const s = Math.min(30, left); w.tick(s); left -= s; }
  return w;
}
