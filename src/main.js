// Медитативный пиксельный костёр у озера. Слои — PNG пользователя, вся анимация и свет — в коде.
import * as THREE from 'three';
import { Fire, DEFAULT_LOGS, describeLog } from './fire.js';
import { Ambience } from './audio.js';

const W = 1672, H = 941;
const CLIP_Y = 792; // ниже этой линии камни кольца — передние            // координаты мира = пиксели референса (y вниз)
const RW = 480, RH = 270;           // внутреннее разрешение (пиксель-арт)
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1); // ?speed=60 — ускорить время для отладки

// Ключевые точки сцены (по выровненным слоям)
const P = {
  fire: [790, 752], lanternPivot: [377, 214], lanternFlame: [377, 292],
  mug: [372, 626], radio: [318, 806], moon: [1376, 123], horizon: 446,
};

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const rt = new THREE.WebGLRenderTarget(RW, RH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(0, W, H, 0, -10, 10); // y вверх; переводим через wy()
const wy = (y) => H - y;

// ---------- шейдер слоёв ----------
const KIND = { plain: 0, sky: 1, cloud: 2, lake: 3 };
const layerVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const common = `
  uniform float uTime,uFire,uEmber,uLit,uAmb,uLanternLit,uKind,uFlick;
  uniform vec2 uFirePos,uLanternPos,uMoon,uCloudOff;
  uniform sampler2D map,uRefl1,uRefl2;
  varying vec2 vUv;
  const vec2 WH=vec2(${W}.,${H}.);
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  vec4 tex(sampler2D t, vec2 p){ return texture2D(t, vec2(p.x/WH.x, 1.-p.y/WH.y)); }
`;
const layerFrag = common + `
  uniform float uClipY;
  uniform vec2 uLocal; // смещение локальных uv (для качающегося фонаря)
  void main(){
    vec2 p = vec2(vUv.x*WH.x, (1.-vUv.y)*WH.y) + uLocal;
    vec2 sp = p; // экранная позиция (для света)
    if (uKind==2.) { sp = p; p.x = mod(p.x - uCloudOff.x, WH.x); }
    float ripple = 0.;
    if (uKind==3.) {
      float k = clamp((p.y-${P.horizon}.)/400.,0.,1.);
      ripple = sin(p.y*0.35 - uTime*1.3 + sin(p.x*0.013+uTime*0.3)*2.)*(0.6+2.5*k);
      p.x += ripple;
    }
    if (uClipY > 0. && p.y < uClipY) discard;
    vec4 t = tex(map,p);
    if (t.a < 0.01 && uKind!=1.) discard;
    vec3 col = t.rgb * uAmb * vec3(0.72,0.78,0.98);
    if (uKind==1.) { // небо: звёзды и сияние луны
      vec2 cell = floor(sp/3.4833);
      float h = hash(cell);
      float fade = smoothstep(470.,120.,sp.y);
      if (h>0.9955) {
        float tw = 0.55+0.45*sin(uTime*(0.6+hash(cell+7.)*2.5)+hash(cell+3.)*6.28);
        col += vec3(0.9,0.93,1.)*tw*fade*(0.5+0.5*hash(cell+1.));
      }
      float dm = length(sp-uMoon);
      col += vec3(0.55,0.65,0.85)*(0.30*exp(-dm/70.)+0.12*exp(-dm/260.));
    }
    if (uKind==2.) { // облака: подсветка кромки в сторону луны, каждый кадр
      vec2 d = normalize(uMoon-sp);
      float a2 = tex(map, p + d*7.).a;
      float a3 = tex(map, p + d*14.).a;
      float rim = t.a*(1.-a2*0.7-a3*0.3);
      float near = exp(-length(sp-uMoon)/520.);
      col = col*0.85 + vec3(0.78,0.85,1.0)*rim*(0.1+1.1*near);
    }
    if (uKind==3.) { // озеро: отражения, лунная дорожка, рябь
      float k = clamp((p.y-${P.horizon}.)/420.,0.,1.);
      vec2 rp = vec2(p.x + ripple*2., 2.*${P.horizon}. - p.y);
      vec4 r1 = tex(uRefl1,rp), r2 = tex(uRefl2,rp + vec2(0.,6.));
      vec3 refl = mix(r1.rgb*r1.a, r2.rgb, r2.a);
      float ra = max(r1.a,r2.a);
      col = mix(col, refl*0.55, ra*0.32*(1.-k));
      float w = 14. + (p.y-${P.horizon}.)*0.32;
      float dx = abs(sp.x + ripple*3. - uMoon.x);
      float band = smoothstep(w, w*0.25, dx);
      float glint = step(0.55, noise(vec2(sp.x*0.08, sp.y*0.45 - uTime*0.7))) * (0.6+0.4*sin(uTime*3.+sp.y));
      col += vec3(0.85,0.85,0.7)*band*(0.18 + 0.75*glint)*(1.-0.6*k);
      col *= 1. + 0.07*sin(sp.y*0.9 - uTime*1.8 + noise(sp*0.02)*6.);
    }
    // тёплый свет костра и фонаря (аддитивная маска с мерцанием)
    vec2 fd = (sp-uFirePos)*vec2(1.,1.45);
    float fr = length(fd);
    float L = uFire*uFlick*exp(-fr/(170.+260.*uFire)) + uEmber*0.45*exp(-fr/80.);
    float LL = uLanternLit*exp(-length(sp-uLanternPos)/120.);
    float Lw = L*1.5/(1.+L*0.6); col += t.rgb*vec3(1.,.55,.22)*(Lw+LL*1.1)*uLit;
    col += vec3(1.,.45,.15)*L*L*0.08*uLit*t.a;
    gl_FragColor = vec4(col, uKind==1. ? 1. : t.a);
  }`;

const loader = new THREE.TextureLoader();
function loadTex(name) {
  const t = loader.load(`./layers/half/${name}.png`);
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
const shared = {
  uTime: { value: 0 }, uFire: { value: 0 }, uEmber: { value: 0 }, uFlick: { value: 1 }, uLanternLit: { value: 0.8 },
  uFirePos: { value: new THREE.Vector2(...P.fire) }, uLanternPos: { value: new THREE.Vector2(...P.lanternFlame) },
  uMoon: { value: new THREE.Vector2(...P.moon) }, uCloudOff: { value: new THREE.Vector2() },
};
const plane = new THREE.PlaneGeometry(W, H);
let order = 0;
function layer(name, { kind = 'plain', lit = 1, amb = 1, extra = {} } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: layerVert, fragmentShader: layerFrag, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { ...shared, map: { value: loadTex(name) }, uRefl1: { value: null }, uRefl2: { value: null },
      uLit: { value: lit }, uAmb: { value: amb }, uKind: { value: KIND[kind] }, uLocal: { value: new THREE.Vector2() }, uClipY: { value: 0 }, ...extra },
  });
  const m = new THREE.Mesh(plane, mat); m.position.set(W / 2, H / 2, 0); m.renderOrder = order++;
  scene.add(m); return m;
}

// ---------- свечения ----------
const glowFrag = `uniform vec3 uColor; uniform float uI,uTime,uNoise; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){ vec2 c=vUv*2.-1.; float r=dot(c,c); float g=exp(-r*3.5)*(1.-smoothstep(.8,1.,r));
    if(uNoise>0.){ vec2 q=floor(vUv*vec2(40.,10.)); g*=0.55+0.9*hash(q+floor(uTime*3.+hash(q)*5.)*0.01*uNoise);}
    gl_FragColor=vec4(uColor*g*uI,1.); }`;
function glow(w, h, color, { noise = 0 } = {}) {
  const mat = new THREE.ShaderMaterial({ vertexShader: layerVert, fragmentShader: glowFrag, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(...color) }, uI: { value: 1 }, uTime: shared.uTime, uNoise: { value: noise } } });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.renderOrder = order++; return m;
}

// ---------- частицы ----------
const ptVert = `attribute float aSize,aAlpha,aShape; attribute vec3 aColor; varying vec3 vC; varying float vA,vS;
  void main(){ vC=aColor; vA=aAlpha; vS=aShape; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    gl_PointSize=max(1.,aSize*${(RW / W).toFixed(5)}); }`;
const ptFrag = `varying vec3 vC; varying float vA,vS;
  void main(){ vec2 c=gl_PointCoord*2.-1.; float a;
    if(vS<0.5){ a=1.-smoothstep(.2,1.,length(c)); }
    else { float f=fract(vS)*2.-1.; float y=-c.y; // летучая мышь: тельце + крылья, взмах f
      float wing=abs(y-(abs(c.x)*f*0.9))<0.22&&abs(c.x)<0.95?1.:0.; float body=length(c*vec2(2.5,1.6))<0.5?1.:0.;
      a=max(wing,body); }
    if(a<0.05) discard; gl_FragColor=vec4(vC,a*vA); }`;
class Particles {
  constructor(max, blending) {
    this.max = max; this.n = 0; this.list = [];
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.shape = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: ptVert, fragmentShader: ptFrag, transparent: true,
      blending, depthTest: false, depthWrite: false }));
    this.points.frustumCulled = false; this.points.renderOrder = order++;
  }
  spawn(p) { if (this.list.length < this.max) this.list.push({ age: 0, ...p }); }
  update(dt, fn) {
    let i = 0;
    for (let k = this.list.length - 1; k >= 0; k--) { const p = this.list[k]; p.age += dt; if (p.age >= p.life) this.list.splice(k, 1); }
    for (const p of this.list) {
      const o = fn(p, dt, p.age / p.life);
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = wy(p.y); this.pos[i * 3 + 2] = 0;
      this.col[i * 3] = o.r; this.col[i * 3 + 1] = o.g; this.col[i * 3 + 2] = o.b;
      this.size[i] = o.size; this.alpha[i] = o.a; this.shape[i] = o.shape || 0; i++;
    }
    this.geo.setDrawRange(0, i);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']) this.geo.attributes[k].needsUpdate = true;
  }
}

// ---------- сборка сцены (сзади вперёд) ----------
layer('01_sky', { kind: 'sky', lit: 0 });
layer('02_moon', { lit: 0, amb: 1.25 });
const clouds = layer('03_clouds', { kind: 'cloud', lit: 0, amb: 0.9 });
const mountains = layer('04_mountains', { lit: 0 });
const shore = layer('05_far_shore', { lit: 0, amb: 0.95 });
const lake = layer('06_lake', { kind: 'lake', lit: 0.15 });
lake.material.uniforms.uRefl1.value = mountains.material.uniforms.map.value;
lake.material.uniforms.uRefl2.value = shore.material.uniforms.map.value;
layer('07_forest_mid', { lit: 0.5, amb: 0.9 });
const bats = new Particles(12, THREE.NormalBlending); scene.add(bats.points);
layer('08_ground', { lit: 1.2 });
layer('09_tree', { lit: 1.5 });
// фонарь качается вокруг точки подвеса
const lanternPivot = new THREE.Group(); lanternPivot.position.set(P.lanternPivot[0], wy(P.lanternPivot[1]), 0); scene.add(lanternPivot);
const lanternMesh = layer('10_lantern', { lit: 0.6 }); scene.remove(lanternMesh);
lanternMesh.position.set(W / 2 - P.lanternPivot[0], H / 2 - wy(P.lanternPivot[1]), 0); lanternPivot.add(lanternMesh);
const lanternFlame = glow(14, 22, [1.0, 0.75, 0.35]);
const lanternGlow = glow(170, 170, [0.9, 0.5, 0.18]);
for (const g of [lanternFlame, lanternGlow]) { g.position.set(P.lanternFlame[0] - P.lanternPivot[0], -(P.lanternFlame[1] - P.lanternPivot[1]), 0); lanternPivot.add(g); }
layer('11_firering', { lit: 1.0 });
layer('12_fire_logs', { lit: 1.0 });
const coal = glow(300, 90, [1.0, 0.28, 0.05], { noise: 1 }); coal.position.set(P.fire[0], wy(P.fire[1] + 5), 0); scene.add(coal);
const FIRE_W = 270, FIRE_H = 310; // размер квада пламени при полной силе (px мира)
const flameMat = new THREE.ShaderMaterial({ vertexShader: layerVert, transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uTime: shared.uTime, uI: { value: 0 }, uSeed: { value: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) } },
  fragmentShader: `uniform float uTime,uI; uniform vec3 uSeed; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+1.7; a*=.5; } return v; }
  // один язык пламени: капля, сужающаяся кверху, с изгибом от шума
  float tongue(vec2 q, float cx, float h, float w, float n){
    float y = q.y / h; if (y > 1.05) return 0.;
    float bend = (n - .5) * .55 * y + sin(uTime*2.3 + cx*9.)*.04*y;
    float width = w * pow(max(0., 1. - y), .9) * (0.55 + .45*smoothstep(0., .22, y + .02));
    float d = abs(q.x - cx - bend) / max(width, 1e-3);
    return clamp(1. - d, 0., 1.) * (1. - y*.55);
  }
  void main(){
    vec2 q = vec2(vUv.x*2.-1., vUv.y);
    float t = uTime;
    float n = fbm(vec2(q.x*2.6, q.y*3.2 - t*2.6) + uSeed.xy);
    float n2 = fbm(vec2(q.x*5., q.y*6. - t*4.1) + uSeed.yz);
    float I = clamp(uI, 0., 1.);
    // три языка мерцают независимо; на слабом огне — низкие и узкие
    float f1 = .75 + .25*sin(t*3.1 + uSeed.x) + .18*(noise(vec2(t*1.7, 1.)) - .5);
    float f2 = .8 + .2*sin(t*2.3 + uSeed.y*2.) + .2*(noise(vec2(t*2.1, 5.)) - .5);
    float f3 = .75 + .25*sin(t*3.7 + uSeed.z) + .18*(noise(vec2(t*1.9, 9.)) - .5);
    float hs = mix(.28, 1., I);
    float heat = 0.;
    heat = max(heat, tongue(q, -.28, .6*hs*f1, .28, n));
    heat = max(heat, tongue(q,  .02, .95*hs*f2, .4, n));
    heat = max(heat, tongue(q,  .3, .55*hs*f3, .26, n));
    // низовой слой огня над углями
    heat = max(heat, clamp(1. - abs(q.x)*1.7, 0., 1.) * smoothstep(.12*hs, 0., q.y) * .62);
    heat = heat + (n2 - .5) * .45 * heat - q.y * .08;
    heat *= .75 + .35*I;
    // палитра: тёмный край, красный, оранжевый, жёлтый, бело-жёлтое ядро
    vec3 c; float a = 1.;
    if (heat > .78) c = vec3(1., .96, .78);
    else if (heat > .6) c = vec3(1., .82, .32);
    else if (heat > .42) c = vec3(.98, .52, .12);
    else if (heat > .26) c = vec3(.82, .24, .06);
    else if (heat > .14) { c = vec3(.42, .09, .04); a = .75; }
    else discard;
    gl_FragColor = vec4(c, a);
  }` });
const flameGeo = new THREE.PlaneGeometry(1, 1); flameGeo.translate(0, 0.5, 0);
const flame = new THREE.Mesh(flameGeo, flameMat); flame.renderOrder = order++;
const FLAME_BASE_Y = P.fire[1] + 18; flame.position.set(P.fire[0], wy(FLAME_BASE_Y), 0); scene.add(flame);
// передние камни кольца рисуем повторно поверх пламени
const ringFront = layer('11_firering', { lit: 1.0, extra: { uClipY: { value: CLIP_Y } } });
const sparks = new Particles(150, THREE.AdditiveBlending); scene.add(sparks.points);
layer('13_woodpile', { lit: 1.3 });
layer('14_stump_axe', { lit: 1.2 });
layer('15_camp_left', { lit: 1.2 });
const steam = new Particles(80, THREE.NormalBlending); scene.add(steam.points);
const radioLed = glow(16, 10, [0.5, 1.0, 0.4]); radioLed.position.set(P.radio[0], wy(P.radio[1]), 0); scene.add(radioLed);
const smoke = new Particles(160, THREE.NormalBlending); scene.add(smoke.points);
const fireGlow = glow(700, 420, [1.0, 0.42, 0.12]); fireGlow.position.set(P.fire[0], wy(P.fire[1] - 60), 0); scene.add(fireGlow);
layer('16_foreground', { lit: 0.9 });

// апскейл ближайшим соседом + лёгкая виньетка
const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { t: { value: rt.texture } }, depthTest: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb;
    vec2 q=vUv-.5; c*=1.-dot(q,q)*0.55; gl_FragColor=vec4(c,1.); }` }));
const postScene = new THREE.Scene(); postScene.add(post); const postCam = new THREE.Camera();

// ---------- состояние и логика костра ----------
const t0 = performance.now(), clock0 = Date.now();
const vnow = () => clock0 + (performance.now() - t0) * SPEED;
const fuelParam = params.get('fuel'); // ?fuel=60: стартовый запас в секундах (отладка)
const fire = fuelParam !== null ? new Fire({ fuel: Number(fuelParam), now: vnow() })
  : SPEED === 1 ? Fire.load(localStorage, vnow()) : new Fire({ now: vnow() });
let shown = 0, ember = 0, lastFuelPositive = fire.fuel > 0;
const audio = new Ambience();
let sel = 1;

const pickerRow = document.querySelector('#picker .row'), info = document.querySelector('#picker .info');
DEFAULT_LOGS.forEach((l, i) => {
  const d = document.createElement('div'); d.className = 'item'; d.textContent = l.name; d.title = describeLog(l);
  d.addEventListener('pointerdown', (e) => { e.stopPropagation(); sel = i; addLog(); }); pickerRow.appendChild(d);
});
function renderPicker() {
  [...pickerRow.children].forEach((c, i) => c.classList.toggle('sel', i === sel));
  const mins = Math.ceil(fire.fuel / 60);
  info.textContent = `${describeLog(DEFAULT_LOGS[sel])} · ${fire.isOut ? (ember > 0.02 ? 'тлеют угли' : 'костёр погас') : `огня хватит на ~${mins} мин`} · ←/→ выбор, OK — подбросить`;
}
function addLog() { fire.addLog(DEFAULT_LOGS[sel].id, vnow()); if (SPEED === 1 && fuelParam === null) fire.save(); renderPicker(); burst = 1; }
let burst = 0;

// ---------- интерфейс: ТВ-режим ----------
let idleTimer;
function wake() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 5000); }
const overlay = document.getElementById('overlay');
let started = false;
function firstInteraction() { if (started) return; started = true; audio.start(); overlay.classList.add('gone'); }
const muteBtn = document.getElementById('mute');
function toggleMute() { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? 'Звук: выкл' : 'Звук: вкл'; }
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); firstInteraction(); toggleMute(); });
const fsBtn = document.getElementById('fs');
function toggleFs() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}
fsBtn.addEventListener('click', (e) => { e.stopPropagation(); firstInteraction(); toggleFs(); });
for (const b of [muteBtn, fsBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
window.addEventListener('pointerdown', () => { const was = started; firstInteraction(); wake(); if (was || true) addLog(); });
window.addEventListener('pointermove', wake);
window.addEventListener('keydown', (e) => {
  wake();
  const onButton = document.activeElement?.tagName === 'BUTTON';
  if (e.key === 'ArrowLeft') { sel = (sel + DEFAULT_LOGS.length - 1) % DEFAULT_LOGS.length; renderPicker(); }
  else if (e.key === 'ArrowRight') { sel = (sel + 1) % DEFAULT_LOGS.length; renderPicker(); }
  else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') { firstInteraction(); toggleMute(); }
  else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { firstInteraction(); toggleFs(); }
  else if (!onButton && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'l')) { firstInteraction(); addLog(); e.preventDefault(); }
  else firstInteraction();
});
wake(); renderPicker();

function resize() {
  const vw = innerWidth, vh = innerHeight; let w = vw, h = Math.round(vw * 9 / 16);
  if (h > vh) { h = vh; w = Math.round(vh * 16 / 9); }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
  Object.assign(canvas.style, { width: w + 'px', height: h + 'px', left: (vw - w) / 2 + 'px', top: (vh - h) / 2 + 'px' });
}
addEventListener('resize', resize); resize();

// ---------- кадр ----------
const rand = (a, b) => a + Math.random() * (b - a);
let last = performance.now(), nextBats = 6, saveAt = 0, timeSec = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; timeSec += dt;
  fire.tick(vnow());
  const target = fire.intensity;
  // огонь разгорается за несколько секунд и угасает медленно
  shown += (target - shown) * (target > shown ? 1 - Math.exp(-dt * 0.6) : 1 - Math.exp(-dt * 0.08));
  if (fire.fuel > 0) ember = Math.max(ember, 0.25 + 0.5 * shown); else ember = Math.max(0, ember - dt * SPEED / 240);
  const I = fire.isOut ? Math.min(shown, ember * 0.3) : shown;
  const flick = 0.82 + 0.1 * Math.sin(timeSec * 9.1) + 0.08 * Math.sin(timeSec * 23.7 + Math.sin(timeSec * 3.3)) + rand(-0.04, 0.04);
  Object.assign(shared.uTime, { value: timeSec }); shared.uFire.value = I; shared.uEmber.value = ember; shared.uFlick.value = flick;
  shared.uCloudOff.value.x = timeSec * 2.2; // облака плывут очень медленно
  audio.setIntensity(I);

  // фонарь
  const ang = Math.sin(timeSec * 0.55) * 0.035 + Math.sin(timeSec * 1.3) * 0.008;
  lanternPivot.rotation.z = ang;
  const lf = 0.85 + 0.15 * Math.sin(timeSec * 7 + Math.sin(timeSec * 2.1) * 2);
  lanternFlame.material.uniforms.uI.value = 1.5 * lf; lanternGlow.material.uniforms.uI.value = 0.6 * lf;
  shared.uLanternLit.value = 0.75 * lf;
  shared.uLanternPos.value.set(P.lanternFlame[0] + Math.sin(ang) * 78, P.lanternFlame[1]);

  coal.material.uniforms.uI.value = Math.min(1.3, ember * 0.9 + I * 0.5) * (0.85 + 0.15 * Math.sin(timeSec * 1.7));
  fireGlow.material.uniforms.uI.value = I * 0.1 * flick;
  radioLed.material.uniforms.uI.value = 0.35 + 0.25 * Math.sin(timeSec * 1.2);

  // пламя
  const [fx, fy] = P.fire;
  burst = Math.max(0, burst - dt);
  const fI = Math.min(1, I + burst * 0.15);
  flame.visible = fI > 0.02;
  flame.scale.set(FIRE_W * (0.45 + 0.55 * fI), FIRE_H * (0.3 + 0.7 * fI), 1);
  flameMat.uniforms.uI.value = fI;
  for (let k = 0; k < (0.6 + 5 * I + burst * 8) * dt; k++) if (I > 0.03 || Math.random() < 0.02)
    sparks.spawn({ x: fx + rand(-40, 40), y: fy - 60 - 120 * I, vx: rand(-30, 30), vy: -rand(120, 300) * (0.5 + I), life: rand(1, 2.8), ph: rand(0, 6) });
  sparks.update(dt, (p, dt, k) => {
    p.x += (p.vx + Math.sin(timeSec * 3 + p.ph) * 40) * dt; p.y += p.vy * dt; p.vy *= 1 - dt * 0.8;
    return { r: 1, g: 0.7 - k * 0.3, b: 0.3 - k * 0.2, size: 4 - k * 1.5, a: Math.pow(1 - k, 1.5) * 0.85 };
  });
  // дым
  const smokeAmt = 2 + I * 6 + (fire.isOut ? ember * 8 : 0);
  for (let k = 0; k < smokeAmt * dt; k++) smoke.spawn({ x: fx + rand(-30, 30), y: fy - 40 - 150 * I, vx: rand(-6, 6), vy: -rand(25, 45), life: rand(5, 8) });
  smoke.update(dt, (p, dt, k) => {
    p.x += (p.vx + 9 + Math.sin(timeSec * 0.7 + p.life) * 8) * dt; p.y += p.vy * dt;
    return { r: 0.42, g: 0.42, b: 0.47, size: 20 + k * 90, a: Math.sin(k * Math.PI) * 0.16 };
  });
  // пар над кружкой
  if (Math.random() < dt * 3) steam.spawn({ x: P.mug[0] + rand(-10, 10), y: P.mug[1], life: rand(3, 5), ph: rand(0, 6) });
  steam.update(dt, (p, dt, k) => {
    p.y -= 14 * dt; p.x += Math.sin(timeSec * 1.5 + p.ph) * 9 * dt + 2 * dt;
    return { r: 0.9, g: 0.9, b: 0.95, size: 10 + k * 22, a: Math.sin(k * Math.PI) * 0.4 };
  });
  // летучие мыши изредка пересекают небо
  nextBats -= dt;
  if (nextBats <= 0) {
    nextBats = rand(25, 70); const dir = Math.random() < 0.5 ? 1 : -1, y = rand(140, 330), n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) bats.spawn({ x: dir > 0 ? -40 - i * 60 : W + 40 + i * 60, y: y + rand(-30, 30), vx: dir * rand(110, 160), life: 22, ph: rand(0, 6) });
  }
  bats.update(dt, (p, dt) => {
    p.x += p.vx * dt; p.y += Math.sin(timeSec * 2 + p.ph) * 18 * dt;
    if (p.x < -200 || p.x > W + 200) p.age = p.life;
    const f = 0.5 + 0.5 * Math.sin(timeSec * 16 + p.ph);
    return { r: 0.03, g: 0.03, b: 0.06, size: 22, a: 1, shape: 1 + Math.min(0.99, f * 0.98) };
  });

  if (now > saveAt) { saveAt = now + 10000; if (SPEED === 1 && fuelParam === null) fire.save(); renderPicker(); }

  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__campfire = { fire, addLog, state: () => ({ shown, ember, fuel: fire.fuel }) };
