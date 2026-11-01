// Процедурный звук: треск, гул огня, сверчки, сова. Без внешних файлов.
export class Ambience {
  constructor() { this.ctx = null; this.intensity = 0.5; this.muted = false; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1); }
  start() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    this.noise = this.makeNoise(4);
    this.brown = this.makeBrown(6);
    // гул огня
    const roar = ctx.createBufferSource(); roar.buffer = this.brown; roar.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    roar.connect(lp).connect(this.roarGain).connect(this.master); roar.start();
    this.crackleBus = ctx.createGain(); this.crackleBus.connect(this.master);
    this.nightBus = ctx.createGain(); this.nightBus.gain.value = 0.5; this.nightBus.connect(this.master);
    // плеск воды: розовый шум через полосовой фильтр с медленной модуляцией
    const water = ctx.createBufferSource(); water.buffer = this.brown; water.loop = true; water.playbackRate.value = 0.7;
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 500; wbp.Q.value = 0.7;
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0.05;
    water.connect(wbp).connect(this.waterGain).connect(this.nightBus); water.start();
    this.wbp = wbp;
    if (this.muted) this.master.gain.value = 0;
    this.crickets = [4300, 4650, 5050].map((f) => ({ f: f * (0.97 + Math.random() * 0.06), next: ctx.currentTime + Math.random() * 3, pan: Math.random() * 2 - 1, vol: 0.02 + Math.random() * 0.02, rest: 0 }));
    this.nextOwl = ctx.currentTime + 40 + Math.random() * 80;
    this.nextCrackle = ctx.currentTime;
    this.timer = setInterval(() => this.schedule(), 100);
    if (ctx.state !== 'running') ctx.resume();
    // iOS/Safari: короткий беззвучный буфер внутри жеста «разблокирует» вывод
    const u = ctx.createBufferSource(); u.buffer = ctx.createBuffer(1, 1, 22050); u.connect(ctx.destination); u.start(0);
  }
  makeNoise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  makeBrown(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } return b;
  }
  setIntensity(v) { this.intensity = v; }
  /** Шипение при тушении: высокочастотный шум с затуханием + низкий «пых». */
  hiss() {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(2500, t); hp.frequency.exponentialRampToValueAtTime(900, t + 3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    src.connect(hp).connect(g).connect(this.master); src.start(t); src.stop(t + 3.6);
    const b = ctx.createBufferSource(); b.buffer = this.brown; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.6, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    b.connect(lp).connect(g2).connect(this.master); b.start(t); b.stop(t + 0.9);
  }
  /** Глухой стук полена. */
  thud() {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
  }
  schedule() {
    const ctx = this.ctx, now = ctx.currentTime, ahead = now + 0.3, I = this.intensity;
    // гул: случайные медленные «вдохи»
    this.roarGain.gain.setTargetAtTime(I * I * (0.25 + Math.random() * 0.2), now, 0.8);
    while (this.nextCrackle < ahead) {
      if (I > 0.02) this.crackle(this.nextCrackle, I);
      const rate = 0.5 + I * 14; // щелчков в секунду
      this.nextCrackle += -Math.log(1 - Math.random()) / rate;
    }
    if (this.nextCrackle < now) this.nextCrackle = now;
    for (const c of this.crickets) {
      while (c.next < ahead) {
        if (c.rest > 0) { c.rest--; } else this.chirp(c, c.next);
        c.next += 0.45 + Math.random() * 0.5;
        if (Math.random() < 0.04) { c.rest = 5 + (Math.random() * 20) | 0; } // паузы
      }
    }
    if (this.waterGain) { // волны набегают раз в несколько секунд
      const w = 0.03 + 0.04 * (0.5 + 0.5 * Math.sin(now * 0.9 + Math.sin(now * 0.23) * 3));
      this.waterGain.gain.setTargetAtTime(w, now, 0.4); this.wbp.frequency.setTargetAtTime(380 + w * 4000, now, 0.5);
    }
    if (now > this.nextOwl) { this.owl(now + 0.1); this.nextOwl = now + 60 + Math.random() * 180; }
  }
  crackle(t, I) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800 + Math.random() * 4000; bp.Q.value = 0.8 + Math.random() * 3;
    const g = ctx.createGain(), pop = Math.random() < 0.06, dur = pop ? 0.04 : 0.004 + Math.random() * 0.02;
    const amp = (pop ? 0.6 : 0.15 + Math.random() * 0.25) * (0.4 + I * 0.6);
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let n = src.connect(bp).connect(g); if (pan) { pan.pan.value = Math.random() * 0.6 - 0.3; n = n.connect(pan); }
    n.connect(this.crackleBus);
    src.start(t, Math.random() * 3, dur + 0.01);
  }
  chirp(c, t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = c.f; g.gain.value = 0;
    const pulses = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < pulses; i++) {
      const s = t + i * 0.035; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(c.vol, s + 0.006); g.gain.linearRampToValueAtTime(0, s + 0.022);
    }
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let n = o.connect(g); if (pan) { pan.pan.value = c.pan; n = n.connect(pan); }
    n.connect(this.nightBus); o.start(t); o.stop(t + pulses * 0.035 + 0.05);
  }
  owl(t) {
    const ctx = this.ctx, base = 330 + Math.random() * 60, pan = Math.random() * 1.6 - 0.8;
    const pattern = Math.random() < 0.5 ? [[0, 0.5], [0.9, 0.25], [1.25, 0.6]] : [[0, 0.7], [1.1, 0.8]];
    const far = 0.05 + Math.random() * 0.06;
    for (const [dt, len] of pattern) {
      const s = t + dt, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.frequency.setValueAtTime(base * 1.05, s); o.frequency.exponentialRampToValueAtTime(base * 0.9, s + len);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(far, s + 0.08); g.gain.setTargetAtTime(0, s + len * 0.6, len * 0.25);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      let n = o.connect(lp).connect(g); if (p) { p.pan.value = pan; n = n.connect(p); }
      n.connect(this.nightBus); o.start(s); o.stop(s + len + 0.5);
    }
  }
}
