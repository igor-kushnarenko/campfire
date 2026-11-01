// Тюнер: интернет-станции через <audio>, переходы через эфирные помехи.
// Станция «выплывает» из шума и «тонет» в нём; нерабочие пропускаются; без сети — только шум.
export const TUNE = { fadeOut: 0.7, fadeIn: 2.2, timeout: 9, idleNoise: 1, stationNoise: 0.12 };

/** Чистая логика выбора следующей станции с пропуском нерабочих. */
export function nextIndex(n, from, dir, bad) {
  if (!n) return -1;
  for (let k = 1; k <= n; k++) { const i = (((from + dir * k) % n) + n) % n; if (!bad.has(i)) return i; }
  return -1;
}

export class Tuner {
  constructor({ audio, onName }) {
    this.audio = audio; this.onName = onName || (() => {});
    this.list = []; this.idx = -1; this.bad = new Set();
    this.el = new Audio(); this.el.preload = 'none'; this.el.volume = 0;
    this.mix = 0;            // 0 — только шум, 1 — станция
    this.target = 0; this.state = 'off'; // off | out | loading | in | on | dead
    this.t = 0; this.pending = 0; this.pendT = 0; this.vol = 0.6; this.on = false;
    this.el.addEventListener('playing', () => { if (this.state === 'loading') { this.state = 'in'; this.onName(this.cur()?.name); } });
    const fail = () => { if (this.state === 'loading' || this.state === 'in' || this.state === 'on') this.skip(); };
    this.el.addEventListener('error', fail); this.el.addEventListener('ended', fail);
    window.addEventListener('online', () => { if (this.on && this.state === 'dead') { this.bad.clear(); this.go(this.idx < 0 ? 0 : this.idx); } });
  }
  async load(url = './stations.json') {
    try { this.list = await (await fetch(url, { cache: 'no-cache' })).json(); } catch { this.list = []; }
  }
  cur() { return this.list[this.idx]; }
  setVolume(v) { this.vol = v; }
  setOn(on, startId) {
    this.on = on;
    if (!on) { this.stop(); this.state = 'off'; this.mix = 0; this.el.volume = 0; return; }
    let i = this.list.findIndex((s) => s.id === startId); if (i < 0) i = 0;
    this.go(i);
  }
  /** Поворот ручки на steps (колесо мыши/кнопки). Быстрая прокрутка копится. */
  turn(steps) {
    if (!this.on || !this.list.length) return;
    this.pending += steps; this.pendT = 0.35;
    if (this.state !== 'out') { this.state = 'out'; this.audio.radioSweep?.(Math.sign(steps)); }
  }
  go(i) {
    if (!navigator.onLine || i < 0) { this.state = 'dead'; this.stop(); this.onName(null); return; }
    this.idx = i; const s = this.cur();
    this.state = 'loading'; this.t = 0;
    this.el.src = s.url; this.el.play().catch(() => {}); // ошибки ловит 'error' или таймаут
  }
  skip() {
    this.bad.add(this.idx); this.stop();
    const dir = this.lastDir || 1; const i = nextIndex(this.list.length, this.idx, dir, this.bad);
    if (i < 0) { this.state = 'dead'; this.onName(null); return; }
    this.go(i);
  }
  stop() { try { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); } catch {} }
  update(dt) {
    const s = this.state;
    if (s === 'out') { // станция тонет в помехах, ждём конца прокрутки
      this.mix = Math.max(0, this.mix - dt / TUNE.fadeOut); this.pendT -= dt;
      if (this.mix <= 0 && this.pendT <= 0) {
        const steps = this.pending; this.pending = 0; this.lastDir = Math.sign(steps) || 1;
        this.stop();
        let i = this.idx; const n = this.list.length;
        for (let k = 0; k < Math.abs(steps); k++) i = nextIndex(n, i, this.lastDir, this.bad);
        this.go(i);
      }
    } else if (s === 'loading') {
      this.t += dt; this.mix = 0;
      if (this.t > TUNE.timeout) this.skip();
    } else if (s === 'in') {
      this.mix = Math.min(1, this.mix + dt / TUNE.fadeIn); if (this.mix >= 1) this.state = 'on';
    }
    // кривая: станция нарастает плавно, шум уходит быстрее, но не до нуля — как у настоящего приёмника
    const m = this.mix * this.mix * (3 - 2 * this.mix);
    this.el.volume = this.on ? Math.min(1, this.vol * m) : 0;
    this.audio.setRadioNoise?.(this.on ? TUNE.stationNoise + (TUNE.idleNoise - TUNE.stationNoise) * (1 - Math.sqrt(m)) : 0);
  }
}
