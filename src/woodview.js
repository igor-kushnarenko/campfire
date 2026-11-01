// Отрисовка и интерактив дров: поленница из отдельных спрайтов, перетаскивание в костёр,
// горение каждого полена (шейдер: древесина → уголь → светящиеся трещины → пепел), топор.
import * as THREE from 'three';
import { SPRITES, SPECIES, heatCurve, PILE_MAX } from './wood.js';

// места в поленнице (центр полена, y вниз; заполняются снизу вверх)
export const PILE_SLOTS = [
  [1112, 784, 0.02], [1248, 786, -0.02], [1380, 782, 0.03],
  [1180, 748, -0.03], [1314, 750, 0.02],
  [1106, 742, 0.05], [1246, 714, 0.02],
  [1380, 742, -0.04], [1178, 710, -0.02],
  [1212, 676, 0.03], [1316, 712, -0.03],
  [1268, 642, -0.02],
]
// места в костре: «шалаш» из перекрещенных поленьев внутри кольца
const FIRE_SLOTS = [
  [770, 762, 0.5], [812, 762, -0.5], [792, 750, 0.06], [748, 772, -0.22], [836, 772, 0.26], [792, 778, -0.62], [792, 740, 0.62],
];
const FIRE_SCALE = 0.72;

const logFrag = (PIX) => `
  uniform sampler2D map; uniform vec2 uTexSize;
  uniform float uProg,uHeat,uHi,uWet,uSeed,uTime,uFire,uEmber,uFlick,uLanternLit,uLit,uLift;
  uniform vec2 uFirePos,uLanternPos;
  varying vec2 vUv; varying vec2 vW;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  void main(){
    vec2 tx = (floor(vUv*uTexSize)+.5)/uTexSize;
    vec4 t = texture2D(map, tx);
    if (t.a < .08) discard;
    vec2 cc = floor(vUv*uTexSize/${(PIX * 0.85).toFixed(3)});          // сетка эффектов ~ пиксели сцены
    float n = noise(cc*.33 + uSeed*17.), n2 = hash(cc + uSeed*31.);
    float pr = uProg;
    // рассыпается в угли в самом конце
    if (pr > .86 && n2 < (pr - .86)*7.5) discard;
    float nb = noise(cc*.12 + uSeed*9.);                        // крупные пятна
    float charA = smoothstep(nb*.6, nb*.6 + .25, pr*1.6 - .02);
    float ash = smoothstep(.7, 1., pr + (nb - .5)*.25) * (.55 + .45*n);
    vec3 c = t.rgb*.8;                                            // лунная ночь: дерево темнее
    c = mix(c, vec3(.08,.06,.05) + t.rgb*.18, charA);
    c = mix(c, vec3(.42,.4,.38) + .12*n, ash*.8);
    if (uWet > .5) c = c*.55 + vec3(.02,.025,.03);
    // освещение как у слоёв: ночь + тёплый свет костра и фонаря
    vec2 fd = (vW - uFirePos)*vec2(1.,1.45); float fr = length(fd);
    float L = uFire*uFlick*exp(-fr/(170.+260.*uFire)) + uEmber*.45*exp(-fr/80.);
    float LL = uLanternLit*exp(-length(vW-uLanternPos)/120.);
    vec3 col = c*vec3(.72,.78,.98) + c*vec3(1.,.55,.22)*(L*1.5/(1.+L*.6) + LL*1.1)*uLit;
    // светящиеся трещины: редкие тонкие линии по обугленной части + тёплое тление снизу
    float lines = abs(fract(noise(vec2(cc.x*.18, cc.y*.5) + uSeed*5.)*3.) - .5);
    float crack = step(lines, .07) * smoothstep(.3, .7, charA) * (1. - ash);
    float under = smoothstep(.45, 1., vUv.y < .5 ? 1. - vUv.y*2. : 0.) * charA;   // низ полена — к углям
    float pulse = .7 + .3*sin(uTime*(1.3 + nb*1.4) + nb*6.28);
    float glow = (crack + under*.35 + ash*.25*n) * uHeat * pulse;
    col += vec3(1.,.32,.06)*glow + vec3(1.,.7,.3)*glow*glow*.3;
    // подсветка при наведении: тёплый контур
    if (uHi > 0.) {
      vec2 d = 1./uTexSize;
      float edge = 0.;
      edge += step(texture2D(map, tx + vec2(d.x*2.,0.)).a, .08) + step(texture2D(map, tx - vec2(d.x*2.,0.)).a, .08);
      edge += step(texture2D(map, tx + vec2(0.,d.y*2.)).a, .08) + step(texture2D(map, tx - vec2(0.,d.y*2.)).a, .08);
      col += vec3(1.,.82,.5)*uHi*(.12 + .5*min(edge,1.));
    }
    gl_FragColor = vec4(col, t.a);
  }`;
const logVert = `varying vec2 vUv; varying vec2 vW; uniform float uH;
  void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = vec2(w.x, uH - w.y); gl_Position = projectionMatrix*viewMatrix*w; }`;

const ease = { out: (t) => 1 - (1 - t) ** 3, inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; } };

export class WoodView {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, shared, PIX, W, H, wy, crop:{x,y}, canvas, audio, wood, onLand, sparkBurst, chipBurst, hint, isRaining, orders
    this.tex = {}; this.alpha = {}; this.meshes = new Map(); // id → { mesh, mat, x,y,rot, s, anim }
    this.pileGroup = new THREE.Group(); this.scene.add(this.pileGroup);
    this.fireGroup = new THREE.Group(); this.scene.add(this.fireGroup);
    this.dragGroup = new THREE.Group(); this.scene.add(this.dragGroup);
    this.axeGroup = new THREE.Group(); this.scene.add(this.axeGroup);
    const loader = new THREE.TextureLoader();
    for (const name of Object.keys(SPRITES)) {
      const t = loader.load(`./logs/${name}.png`, (tt) => this.readAlpha(name, tt.image));
      t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.NearestFilter;
      this.tex[name] = t;
    }
    this.makeDropZone(); this.makeShadow(); this.makeAxe();
    this.drag = null; this.hover = null; this.time = 0; this.shake = 0;
    this.bindPointer();
    this.sync(true);
  }
  readAlpha(name, img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    this.alpha[name] = { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
    const m = [...this.meshes.values()].filter((e) => e.log.sprite === name);
    for (const e of m) { e.mesh.geometry.dispose(); e.mesh.geometry = new THREE.PlaneGeometry(img.width, img.height); e.mat.uniforms.uTexSize.value.set(img.width, img.height); }
  }
  material(log) {
    const s = this.shared;
    return new THREE.ShaderMaterial({ vertexShader: logVert, fragmentShader: logFrag(this.PIX), transparent: true, depthTest: false, depthWrite: false,
      uniforms: { map: { value: this.tex[log.sprite] }, uTexSize: { value: new THREE.Vector2(140, 50) }, uH: { value: this.H },
        uProg: { value: 0 }, uHeat: { value: 0 }, uHi: { value: 0 }, uWet: { value: 0 }, uSeed: { value: log.seed ?? Math.random() }, uLift: { value: 0 },
        uLit: { value: 1.2 }, uTime: s.uTime, uFire: s.uFire, uEmber: s.uEmber, uFlick: s.uFlick, uLanternLit: s.uLanternLit, uFirePos: s.uFirePos, uLanternPos: s.uLanternPos } });
  }
  entry(log) {
    let e = this.meshes.get(log.id);
    if (!e) {
      const mat = this.material(log), a = this.alpha[log.sprite];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(a?.w ?? 140, a?.h ?? 50), mat);
      if (a) mat.uniforms.uTexSize.value.set(a.w, a.h);
      e = { log, mesh, mat, x: 0, y: 0, rot: 0, s: 1, sx: 1, sy: 1, anim: null, place: null };
      this.meshes.set(log.id, e);
    }
    e.log = log; return e;
  }
  /** Привести меши в соответствие с моделью: поленница и костёр. */
  sync(snap = false) {
    const alive = new Set();
    this.wood.pile.forEach((log, i) => {
      const e = this.entry(log); alive.add(log.id);
      const [x, y, r] = PILE_SLOTS[Math.min(i, PILE_SLOTS.length - 1)];
      e.place = 'pile'; e.slot = i;
      if (e.mesh.parent !== this.pileGroup && !e.anim && this.drag?.e !== e) this.pileGroup.add(e.mesh);
      e.home = { x, y, rot: r, s: 1 };
      if (snap || (!e.anim && this.drag?.e !== e && (e.x !== x || e.y !== y))) {
        if (snap) Object.assign(e, { x, y, rot: r, s: 1 });
        else if (!e.anim) this.tween(e, { x, y, rot: r, s: 1 }, 0.35, ease.inOut); // поленница «оседает»
      }
    });
    this.wood.fire.forEach((log, i) => {
      const e = this.entry(log); alive.add(log.id);
      const [x, y, r] = FIRE_SLOTS[i % FIRE_SLOTS.length];
      e.place = 'fire'; e.slotF = i;
      if (!e.anim) { if (e.mesh.parent !== this.fireGroup) this.fireGroup.add(e.mesh); if (snap) Object.assign(e, { x, y, rot: r, s: FIRE_SCALE }); }
      e.home = { x, y, rot: r, s: FIRE_SCALE };
      if (!snap && !e.anim && (Math.abs(e.x - x) > 1 || Math.abs(e.y - y) > 1)) this.tween(e, e.home, 0.5, ease.inOut);
    });
    for (const [id, e] of this.meshes) if (!alive.has(id) && !e.anim && this.drag?.e !== e && !e.flying) { e.mesh.parent?.remove(e.mesh); e.mesh.geometry.dispose(); e.mat.dispose(); this.meshes.delete(id); }
  }
  tween(e, to, dur, fn = ease.out, opts = {}) {
    e.anim = { from: { x: e.x, y: e.y, rot: e.rot, s: e.s }, to, t: 0, dur, fn, arc: opts.arc || 0, done: opts.done };
  }
  // ---------- координаты ----------
  toWorld(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const u = (cx - r.left) / r.width, v = (cy - r.top) / r.height;
    return [this.crop.x + u * (this.W - 2 * this.crop.x), this.crop.y + v * (this.H - 2 * this.crop.y)];
  }
  hitLog(e, wx, wy) {
    const a = this.alpha[e.log.sprite]; if (!a) return false;
    const dx = wx - e.x, dy = wy - e.y, c = Math.cos(e.rot), s = Math.sin(e.rot);
    // поворот в three — против часовой при y вверх; в мире y вниз → знак синуса меняется
    const lx = (dx * c - dy * s) / (e.s * e.sx) + a.w / 2, ly = (dx * s + dy * c) / (e.s * e.sy) + a.h / 2;
    if (lx < 0 || ly < 0 || lx >= a.w || ly >= a.h) return false;
    return a.d[((ly | 0) * a.w + (lx | 0)) * 4 + 3] > 40;
  }
  pickPile(wx, wy) {
    const list = [...this.meshes.values()].filter((e) => e.place === 'pile' && !e.anim).sort((a, b) => b.slot - a.slot);
    return list.find((e) => this.hitLog(e, wx, wy)) || null;
  }
  overFire(x, y) { const [fx, fy] = this.shared.uFirePos.value.toArray(); return Math.hypot(x - fx, (y - fy) * 1.6) < 200; }
  hitAxe(wx, wy) { const b = this.axeBox; return wx > b[0] - 10 && wx < b[2] + 10 && wy > b[1] - 10 && wy < this.stumpBottom; }
  bindPointer() {
    const cv = this.canvas; cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (ev) => {
      const [x, y] = this.toWorld(ev.clientX, ev.clientY);
      const e = this.pickPile(x, y);
      if (e) {
        ev.preventDefault(); cv.setPointerCapture?.(ev.pointerId);
        this.wood.take({ id: e.log.id }); // из модели — сразу, поленница оседает
        e.place = 'drag'; this.dragGroup.add(e.mesh);
        this.drag = { e, ox: e.x - x, oy: e.y - y, tx: e.x, ty: e.y, vx: 0, vy: 0, id: ev.pointerId };
        this.audio.grab?.(); this.sync(); this.changed?.();
        return;
      }
      if (this.hitAxe(x, y)) this.chop();
    });
    cv.addEventListener('pointermove', (ev) => {
      const [x, y] = this.toWorld(ev.clientX, ev.clientY);
      if (this.drag) { this.drag.tx = x + this.drag.ox; this.drag.ty = y + this.drag.oy; return; }
      const e = this.pickPile(x, y);
      this.hover = e; this.hoverAxe = !e && this.hitAxe(x, y);
      cv.style.cursor = e ? 'grab' : this.hoverAxe ? (this.wood.pileFull ? 'not-allowed' : 'pointer') : '';
    });
    const up = (ev) => {
      if (!this.drag) return;
      const { e, tx, ty } = this.drag; this.drag = null; this.canvas.style.cursor = '';
      if (this.overFire(e.x, e.y) || this.overFire(tx, ty)) this.toFire(e, 0.32, 40);
      else { this.wood.putBack(e.log); e.place = 'pile'; this.pileGroup.add(e.mesh); this.sync(); this.changed?.(); }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  /** Полено летит в костёр (после броска или по кнопке), садится с отскоком. */
  toFire(e, dur, arc) {
    const slot = FIRE_SLOTS[this.wood.fire.length % FIRE_SLOTS.length];
    e.flying = true; this.dragGroup.add(e.mesh);
    this.tween(e, { x: slot[0], y: slot[1] - 14, rot: slot[2], s: FIRE_SCALE }, dur, ease.inOut, { arc, done: () => {
      this.tween(e, { x: slot[0], y: slot[1], rot: slot[2], s: FIRE_SCALE }, 0.28, ease.back, { done: () => { e.flying = false; this.sync(); } });
      this.wood.addToFire(e.log, this.isRaining()); e.place = 'fire'; this.fireGroup.add(e.mesh);
      this.onLand(e.log, slot[0], slot[1]); this.changed?.();
    } });
  }
  /** Кнопка «Подбросить дрова»: берём полено нужной породы (или случайное) и бросаем дугой. */
  throwOne(species) {
    const log = this.wood.take({ species }); if (!log) return false;
    const e = this.entry(log); e.flying = true; this.dragGroup.add(e.mesh); this.sync();
    this.toFire(e, 0.7, 150); this.changed?.(); return true;
  }
  // ---------- зона сброса и тень ----------
  makeDropZone() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 160), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uI: { value: 0 }, uTime: this.shared.uTime },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uI,uTime; varying vec2 vUv; void main(){
        vec2 q = floor((vUv*2.-1.)*vec2(60.,23.))/vec2(60.,23.);
        float r = length(q); float ring = smoothstep(.12,.0,abs(r-.82-.03*sin(uTime*3.)));
        float fill = smoothstep(.85,.2,r)*.18;
        gl_FragColor = vec4(vec3(1.,.55,.2)*(ring+fill)*uI, 1.); }` }));
    const [fx, fy] = this.shared.uFirePos.value.toArray(); m.position.set(fx, this.wy(fy + 12), 0); m.renderOrder = this.orders.zone; m.visible = false;
    this.scene.add(m); this.zone = m;
  }
  makeShadow() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(160, 34), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uA: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ vec2 c=vUv*2.-1.; float a=(1.-smoothstep(.3,1.,length(c)))*uA; gl_FragColor=vec4(0.,0.,.02,a); }` }));
    m.renderOrder = this.orders.drag; m.visible = false; this.dragGroup.add(m); this.shadow = m;
  }
  // ---------- топор ----------
  makeAxe() {
    this.axeBox = [1391, 654, 1537, 754]; this.stumpBottom = 845;
    const t = new THREE.TextureLoader().load('./props/axe.png'); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    const [x0, y0, x1, y1] = this.axeBox, w = x1 - x0, h = y1 - y0;
    // точка вращения — у конца рукояти (там «рука»), лезвие поднимается вверх и падает на пень
    this.axePivot = [x1 - 8, y0 + 14];
    const g = new THREE.Group(); g.position.set(this.axePivot[0], this.wy(this.axePivot[1]), 0);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
      uniforms: { map: { value: t }, uHi: { value: 0 }, uFire: this.shared.uFire, uFlick: this.shared.uFlick },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D map; uniform float uHi,uFire,uFlick; varying vec2 vUv; void main(){ vec4 t=texture2D(map,vUv); if(t.a<.05) discard;
        vec3 c=t.rgb*vec3(.72,.78,.98) + t.rgb*vec3(1.,.55,.22)*uFire*uFlick*.25 + vec3(1.,.82,.5)*uHi*.18; gl_FragColor=vec4(c,t.a); }` });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set((x0 + x1) / 2 - this.axePivot[0], -((y0 + y1) / 2 - this.axePivot[1]), 0);
    m.renderOrder = this.orders.axe; g.add(m); this.axeGroup.add(g); this.axe = g; this.axeMat = mat; this.axeAnim = null;
  }
  chop() {
    if (this.axeAnim) return;
    if (this.wood.pileFull) { this.hint('Поленница полна — сначала подбросьте дров в костёр'); return; }
    this.axeAnim = { t: 0 };
  }
  updateAxe(dt) {
    const a = this.axeAnim; let ang = 0, dy = 0;
    if (a) {
      a.t += dt; const T1 = 0.32, T2 = 0.42, T3 = 0.75;
      if (a.t < T1) { const k = ease.out(a.t / T1); ang = -0.9 * k; dy = -26 * k; }           // замах
      else if (a.t < T2) { const k = (a.t - T1) / (T2 - T1); ang = -0.9 * (1 - k * k); dy = -26 * (1 - k * k); } // удар
      else {
        if (!a.hit) { a.hit = true; this.onChop(); }
        const k = (a.t - T2) / (T3 - T2); ang = Math.sin(k * Math.PI) * 0.05 * (1 - k); dy = 0;
        if (a.t > T3) this.axeAnim = null;
      }
    }
        this.axe.rotation.z = ang; // отрицательный ang поднимает лезвие (оно слева от точки хвата) this.axe.position.y = this.wy(this.axePivot[1] + dy);
    this.axeMat.uniforms.uHi.value += ((this.hoverAxe ? 1 : 0) - this.axeMat.uniforms.uHi.value) * Math.min(1, dt * 10);
  }
  onChop() {
    this.audio.chop?.(); this.shake = 0.18;
    this.chipBurst(1405, 742);
    const r = this.wood.chop();
    if (r.log) { // новое полено скатывается с пня в поленницу
      const e = this.entry(r.log); Object.assign(e, { x: 1420, y: 730, rot: -1.2, s: 0.9 }); this.pileGroup.add(e.mesh);
      const i = this.wood.pile.length - 1, [x, y, rot] = PILE_SLOTS[Math.min(i, PILE_SLOTS.length - 1)];
      e.place = 'pile'; e.slot = i;
      this.tween(e, { x, y, rot, s: 1 }, 0.7, ease.out, { arc: 30, done: () => { this.audio.thud?.(0.5); this.sync(); } });
      this.changed?.();
    } else if (r.full) this.hint('Поленница полна');
  }
  // ---------- кадр ----------
  update(dt) {
    this.time += dt;
    const d = this.drag;
    if (d) { // пружина с инерцией и лёгким покачиванием
      const e = d.e;
      // полунеявная интеграция мелкими шагами — пружина устойчива и на медленных устройствах
      const n = Math.ceil(dt / (1 / 120)), h = dt / n;
      for (let i = 0; i < n; i++) {
        d.vx += ((d.tx - e.x) * 140 - d.vx * 17) * h; d.vy += ((d.ty - e.y) * 140 - d.vy * 17) * h;
        e.x += d.vx * h; e.y += d.vy * h;
      }
      e.rot = e.rot * (1 - Math.min(1, dt * 6)) + (Math.max(-0.35, Math.min(0.35, d.vx * 0.0009)) + Math.sin(this.time * 3) * 0.03) * Math.min(1, dt * 6);
      e.s += (1.1 - e.s) * Math.min(1, dt * 10);
    }
    const dragging = !!d;
    this.zone.visible = dragging;
    if (dragging) this.zone.material.uniforms.uI.value = this.overFire(d.e.x, d.e.y) ? 0.9 : 0.35;
    this.shadow.visible = dragging;
    if (dragging) { this.shadow.position.set(d.e.x, this.wy(d.e.y + 46), 0); this.shadow.material.uniforms.uA.value = 0.45; this.shadow.renderOrder = this.orders.drag; }
    for (const e of this.meshes.values()) {
      const O = this.orders, inDrag = e.mesh.parent === this.dragGroup;
      e.mesh.renderOrder = inDrag ? O.drag + 0.5 : e.place === 'fire' ? O.fire + (e.slotF ?? 0) * 0.01 : O.pile + (e.slot ?? 0) * 0.01;
      if (e.anim) {
        const a = e.anim; a.t += dt; const k = Math.min(1, a.t / a.dur), f = a.fn(k);
        e.x = a.from.x + (a.to.x - a.from.x) * f; e.y = a.from.y + (a.to.y - a.from.y) * f - a.arc * Math.sin(Math.PI * Math.min(1, k)) * (a.arc ? 1 : 0);
        e.rot = a.from.rot + (a.to.rot - a.from.rot) * f; e.s = a.from.s + (a.to.s - a.from.s) * f;
        if (k >= 1) { e.anim = null; a.done?.(); }
      }
      const L = e.log, burning = e.place === 'fire';
      const p = burning ? L.p : 0;
      e.sx = 1 - 0.14 * p; e.sy = 1 - 0.38 * p;
      e.mesh.position.set(e.x, this.wy(e.y + (burning ? 8 * p * e.s : 0)), 0);
      e.mesh.rotation.z = -e.rot; e.mesh.scale.set(e.s * e.sx, e.s * e.sy, 1);
      const u = e.mat.uniforms;
      u.uProg.value = p; u.uWet.value = L.wet ? 1 : 0;
      u.uHeat.value = burning && !L.wet ? Math.min(1.2, 0.35 + heatCurve(L.species, L.thick, p) * 1.1) * (p > 0.02 ? 1 : p * 50) : 0;
      u.uHi.value += (((this.hover === e && !d) ? 1 : 0) - u.uHi.value) * Math.min(1, dt * 12);
      u.uLit.value = burning ? 0.9 : 1.2;
    }
    this.updateAxe(dt);
    this.shake = Math.max(0, this.shake - dt);
    return this.shake > 0 ? [Math.sin(this.time * 90) * 3 * this.shake / 0.18, Math.cos(this.time * 70) * 2 * this.shake / 0.18] : [0, 0];
  }
}
