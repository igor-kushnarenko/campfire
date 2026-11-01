// Медитативный пиксельный костёр у озера. Слои — PNG пользователя, вся анимация и свет — в коде.
import * as THREE from 'three';
import { pickEmberFade, emberLevel } from './fire.js';
import { Woodpile, loadWood, saveWood, makeLog, SPECIES, heatCurve, PILE_MAX } from './wood.js';
import { WoodView } from './woodview.js';
import { Tuner } from './radio.js';
import { SOUND_LAYERS, loadSettings, saveSettings, toggleRain, toggleRadio, setRadioVol, setRainLevel, rainParams } from './settings.js';
// Временные тестовые кнопки скорости времени. Чтобы убрать — поставить false.
const TEST_CONTROLS = true;
import { Ambience } from './audio.js';

const W = 1672, H = 941;
const CLIP_Y = 792; // ниже этой линии камни кольца — передние            // координаты мира = пиксели референса (y вниз)
const params = new URLSearchParams(location.search);
// ?q=low — старый путь для слабых ТВ: всё рисуется в 480x270 и растягивается ближайшим соседом.
// По умолчанию сцена рисуется в разрешении экрана (с учётом devicePixelRatio, не больше 1920x1080),
// а «пиксельность» эффектов задаётся в шейдерах сеткой PIX пикселей мира.
const LOW = params.get('q') === 'low';
let RW = 480, RH = 270;
const PIX = W / 480; // размер «пикселя» эффектов в координатах мира (~3.5 px)
const SPEED = Math.max(1, Number(params.get('speed')) || 1); // ?speed=60 — ускорить время для отладки

// Ключевые точки сцены (по выровненным слоям)
const P = {
  fire: [790, 752], lanternPivot: [377, 168], lanternRing: [377, 222], lanternFlame: [377, 292],
  mug: [372, 626], radio: [318, 806], radioBtn: [218, 810], radioKnob: [320, 830], moon: [1376, 123], horizon: 446,
};

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const rt = new THREE.WebGLRenderTarget(RW, RH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
const scene = new THREE.Scene();
// Кадр чуть уже холста слоёв: по краям у сгенерированных слоёв бывают пустые пиксели (была синяя полоска слева)
const CROP_X = 18, CROP_Y = CROP_X * H / W;
const cam = new THREE.OrthographicCamera(CROP_X, W - CROP_X, H - CROP_Y, CROP_Y, -10, 10); // y вверх; переводим через wy()
const wy = (y) => H - y;

// ---------- шейдер слоёв ----------
const KIND = { plain: 0, sky: 1, cloud: 2, lake: 3 };
const layerVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const common = `
  uniform float uTime,uFire,uEmber,uLit,uAmb,uLanternLit,uKind,uFlick;
  uniform vec2 uFirePos,uLanternPos,uMoon,uCloudOff; uniform float uRain,uRainRing;
  uniform sampler2D map,uRefl1,uRefl2;
  varying vec2 vUv;
  const vec2 WH=vec2(${W}.,${H}.);
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  vec4 tex(sampler2D t, vec2 p){ return texture2D(t, vec2(p.x/WH.x, 1.-p.y/WH.y)); }
`;
const layerFrag = common + `
  uniform float uClipY, uRim, uUseMask; uniform sampler2D uMask;
  uniform vec2 uLocal; // смещение локальных uv (для качающегося фонаря)
  void main(){
    vec2 p = vec2(vUv.x*WH.x, (1.-vUv.y)*WH.y) + uLocal;
    vec2 sp = p; // экранная позиция (для света)
    if (uKind==2.) { sp = p; p.x = mod(p.x - uCloudOff.x, WH.x); }
    float ripple = 0.;
    vec2 sq = (floor(sp/3.4833)+.5)*3.4833; // пиксельная сетка для эффектов воды
    if (uKind==3.) {
      float k = clamp((p.y-${P.horizon}.)/400.,0.,1.);
      ripple = floor(sin(sq.y*0.35 - uTime*1.3 + sin(sq.x*0.013+uTime*0.3)*2.)*(0.6+2.5*k)/3.4833+.5)*3.4833;
      p.x += ripple;
    }
    if (uClipY > 0. && p.y < uClipY) discard;
    if (uUseMask > .5 && tex(uMask,p).r < .5) discard;
    vec4 t = tex(map,p);
    if (t.a < 0.01 && uKind!=1.) discard;
    vec3 col = t.rgb * uAmb * vec3(0.72,0.78,0.98);
    if (uKind==1.) { // небо: звёзды и сияние луны
      vec2 cell = floor(sp/3.4833);
      float h = hash(cell);
      float fade = smoothstep(470.,120.,sp.y);
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
      float dd = p.y - ${P.horizon}.;
      vec2 rp = vec2(p.x + ripple*2. + sin(sq.y*0.9 + uTime*1.6)*(1.+dd*0.025), 2.*${P.horizon}. - p.y);
      vec4 r1 = tex(uRefl1,rp), r2 = tex(uRefl2,rp + vec2(0.,6.));
      vec3 refl = mix(r1.rgb*r1.a, r2.rgb, r2.a);
      float ra = max(r1.a,r2.a);
      // отражение гор/берегов: прозрачное (≤0.2) и тает по мере удаления от дальнего берега
      float fadeR = 1. - smoothstep(0., 190., dd);
      col = mix(col, refl*0.85, ra*0.2*fadeR*fadeR);
      if (uRain > 0.01) { // круги от капель
        vec2 g = sq/vec2(30.,11.); vec2 cc = floor(g); float h = hash(cc);
        float ph = fract(uTime*0.6 + h*7.); vec2 f = (fract(g)-.5)*vec2(30.,11.);
        float r = length(f*vec2(1.,2.6));
        float ring = smoothstep(1.6, 0., abs(r - ph*12.)) * (1.-ph) * step(1. - uRainRing, h);
        col += vec3(.45,.5,.62)*ring*.4*uRain;
      }
      float w = 14. + (p.y-${P.horizon}.)*0.32;
      float dx = abs(sq.x + ripple*3. - uMoon.x);
      float band = smoothstep(w, w*0.25, dx);
      float glint = step(0.55, noise(vec2(sq.x*0.08, sq.y*0.45 - uTime*0.7))) * (0.6+0.4*sin(uTime*3.+sq.y));
      col += vec3(0.85,0.85,0.7)*band*(0.18 + 0.75*glint)*(1.-0.6*k);
      col *= 1. + 0.07*sin(sq.y*0.9 - uTime*1.8 + noise(sq*0.02)*6.);
    }
    // тёплый свет костра и фонаря (аддитивная маска с мерцанием)
    vec2 fd = (sp-uFirePos)*vec2(1.,1.45);
    float fr = length(fd);
    float L = uFire*uFlick*exp(-fr/(170.+260.*uFire)) + uEmber*0.45*exp(-fr/80.);
    float LL = uLanternLit*exp(-length(sp-uLanternPos)/120.);
    float Lw = L*1.5/(1.+L*0.6); col += t.rgb*vec3(1.,.55,.22)*(Lw+LL*1.1)*uLit;
    col += vec3(1.,.45,.15)*L*L*0.08*uLit*t.a;
    if (uRim > 0.) { // тёплая кромка на гранях камней, обращённых к огню
      vec2 dir = normalize(uFirePos - sp);
      float face = t.a * (1. - tex(map, p + dir*7.).a*.75 - tex(map, p + dir*14.).a*.25);
      float near = exp(-fr/150.), fl = .75 + .25*noise(sp*.04 + vec2(uTime*2.3, uTime*1.1));
      float k = uFire*uFlick*fl*uRim;
      col += t.rgb*vec3(1.,.5,.18)*k*(face*3.2*exp(-fr/260.) + near*1.1) + vec3(1.,.42,.12)*face*k*k*.12*exp(-fr/200.);
    }
    gl_FragColor = vec4(col, uKind==1. ? 1. : t.a);
  }`;

const loader = new THREE.TextureLoader();
function loadTex(name) {
  const t = loader.load(LOW ? `./layers/half/${name}.png` : `./layers/aligned/${name}.png`);
  // без мип-карт: при выводе ~1:1 они только мылят картинку
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}
const shared = {
  uTime: { value: 0 }, uFire: { value: 0 }, uEmber: { value: 0 }, uFlick: { value: 1 }, uLanternLit: { value: 0.8 },
  uFirePos: { value: new THREE.Vector2(...P.fire) }, uLanternPos: { value: new THREE.Vector2(...P.lanternFlame) },
  uMoon: { value: new THREE.Vector2(...P.moon) }, uCloudOff: { value: new THREE.Vector2() }, uRain: { value: 0 }, uRainRing: { value: 0.3 }, uRainDen: { value: 0.2 }, uRainLen: { value: 1 }, uRainSlant: { value: 0.2 }, uRainA: { value: 1 }, uRainT: { value: 0 }, uRainDesat: { value: 0.2 }, uRainDark: { value: 0.1 }, uFogBoost: { value: 1 },
};
const plane = new THREE.PlaneGeometry(W, H);
let order = 0;
function layer(name, { kind = 'plain', lit = 1, amb = 1, extra = {} } = {}) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: layerVert, fragmentShader: layerFrag, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { ...shared, map: { value: loadTex(name) }, uRefl1: { value: null }, uRefl2: { value: null },
      uLit: { value: lit }, uAmb: { value: amb }, uKind: { value: KIND[kind] }, uLocal: { value: new THREE.Vector2() }, uClipY: { value: 0 }, uRim: { value: 0 }, uUseMask: { value: 0 }, uMask: { value: null }, ...extra },
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
const ptVert = `uniform float uPx; attribute float aSize,aAlpha,aShape; attribute vec3 aColor; varying vec3 vC; varying float vA,vS;
  void main(){ vC=aColor; vA=aAlpha; vS=aShape; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
    gl_PointSize=max(1.,floor(aSize*uPx/${PIX.toFixed(4)}+.5)*${PIX.toFixed(4)}*uPx); }`;
const ptFrag = `uniform float uCells; varying vec3 vC; varying float vA,vS;
  void main(){ vec2 c=gl_PointCoord*2.-1.; float a;
    if(vS<0.5){ // мягкая точка, но квантованная по пиксельной сетке
      vec2 g=(floor(gl_PointCoord*uCells)+.5)/uCells*2.-1.; a=1.-smoothstep(.2,1.,length(g)); }
    else { float f=fract(vS)*2.-1.; float y=-c.y; // летучая мышь: тельце + крылья, взмах f
      float wing=abs(y-(abs(c.x)*f*0.9))<0.22&&abs(c.x)<0.95?1.:0.; float body=length(c*vec2(2.5,1.6))<0.5?1.:0.;
      a=max(wing,body); }
    if(a<0.05) discard; gl_FragColor=vec4(vC,a*vA); }`;
const pxScale = { value: RW / W }; // пикселей буфера на пиксель мира
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
      blending, depthTest: false, depthWrite: false, uniforms: { uPx: pxScale, uCells: { value: 4 } } }));
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
// Звёздное небо: крошечные, средние и яркие звёзды, случайно (с кучностью и слабым Млечным Путём),
// мерцание у каждой своё, яркие иногда вспыхивают крестиком. За луной и облаками — гаснут.
const starMat = new THREE.ShaderMaterial({ vertexShader: layerVert, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: shared.uTime, uMoon: shared.uMoon, uRain: shared.uRain },
  fragmentShader: `uniform float uTime,uRain; uniform vec2 uMoon; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(3.1,1.7); a*=.5; } return v; }
  float dens(vec2 p){ // та же плотность, что у облаков
    vec2 q = vec2(p.x*0.0032 - uTime*0.004, p.y*0.016);
    float w = fbm(q + vec2(fbm(q*1.7+uTime*0.003)*1.2, 0.));
    float band = smoothstep(60., 170., p.y) * smoothstep(420., 250., p.y);
    float nearMoon = exp(-pow(length((p-uMoon)*vec2(.6,1.6))/260.,2.));
    return smoothstep(.46, .82, w) * band * (0.55 + 0.6*nearMoon);
  }
  float milky(vec2 p){ float d = (p.y - (40. + p.x*0.28)) / 95.; return exp(-d*d) * (0.6 + 0.8*noise(p*0.012)); }
  // одна звезда на клетку cs: x — яркость, y — флаг креста (для ярких)
  vec3 star(vec2 p, float cs, float prob, float seed, float smin, float smax, float bmin, float bmax, float crossy){
    vec2 c = floor(p/cs);
    float clump = noise(c*cs*0.006 + seed) ;
    float pr = prob * (0.35 + 1.3*clump) * (1. + 1.6*milky(c*cs));
    if (hash(c + seed) > pr) return vec3(0.);
    vec2 pos = floor((c + .15 + .7*vec2(hash(c+seed+1.3), hash(c+seed+2.7)))*cs) + .5;
    float h2 = hash(c+seed+4.1), h3 = hash(c+seed+5.9), h4 = hash(c+seed+8.3);
    float s = floor(mix(smin, smax, h2*h2) + .5);
    vec2 d = abs(p - pos);
    float b = mix(bmin, bmax, h3*h3);
    float tw = 0.62 + 0.38*sin(uTime*(0.5 + 3.2*h4) + h3*40.) * (0.7 + 0.3*sin(uTime*(1.7+h2*4.) + h4*20.));
    float core = step(max(d.x,d.y), s*.5);
    float v = core * b * tw;
    if (crossy > 0.) { // редкая вспышка: 4 луча, растут и тают
      float g = pow(max(0., sin(uTime*(0.09 + 0.17*h4) + h2*60.)), 70.);
      float arm = 1. + 5.*g;
      float cr = (step(d.x, .5)*step(d.y, s*.5 + arm) + step(d.y, .5)*step(d.x, s*.5 + arm));
      float fall = 1. - max(d.x, d.y)/(s*.5 + arm + 1.);
      v = max(v, min(1., cr) * fall * g * 1.4) + core*g*.6;
    }
    return vec3(v, h3, h2);
  }
  void main(){
    vec2 p = vec2(vUv.x*${W}., (1.-vUv.y)*${H}.);
    float fade = smoothstep(470., 120., p.y);
    if (fade <= 0.) discard;
    p = floor(p) + .5;                                     // сетка в 1 пиксель мира
    vec3 s1 = star(p, 5., .42, 11., 1., 1., .14, .5, 0.);      // крошечные, много
    vec3 s2 = star(p, 17., .36, 37., 1., 2., .4, .8, 0.);     // средние
    vec3 s3 = star(p, 60., .45, 71., 2., 3., .8, 1.15, 1.);     // яркие, с бликами
    float v = s1.x + s2.x + s3.x;
    float hue = s1.x > 0. ? s1.y : s2.x > 0. ? s2.y : s3.z;
    vec3 tint = mix(vec3(.75,.85,1.), vec3(1.,.9,.76), smoothstep(.55, 1., hue)); // голубоватые и тёплые
    float mw = milky(p) * .05 * (0.5 + noise(p*.03));       // слабое сияние Млечного Пути
    float moon = smoothstep(55., 120., length(p - uMoon));
    float cl = 1. - min(1., dens(p)*1.8);
    float a = (v + mw) * fade * moon * cl * (1. - .85*uRain);
    if (a < .004) discard;
    gl_FragColor = vec4(tint*v*fade*moon*cl*(1.-.85*uRain) + vec3(.55,.6,.8)*mw*fade*moon*cl*(1.-uRain), 1.);
  }` });
const stars = new THREE.Mesh(plane, starMat); stars.position.set(W / 2, H / 2, 0); stars.renderOrder = order++; scene.add(stars);

// Процедурные облака вместо мультяшного PNG: тонкие перистые/слоистые полосы, низкая прозрачность
const cloudMat = new THREE.ShaderMaterial({ vertexShader: layerVert, transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uTime: shared.uTime, uMoon: shared.uMoon },
  fragmentShader: `uniform float uTime; uniform vec2 uMoon; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(3.1,1.7); a*=.5; } return v; }
  float dens(vec2 p){
    vec2 q = vec2(p.x*0.0032 - uTime*0.004, p.y*0.016);          // сильно растянуто по горизонтали
    float w = fbm(q + vec2(fbm(q*1.7+uTime*0.003)*1.2, 0.));       // перистая «вытянутость»
    float band = smoothstep(60., 170., p.y) * smoothstep(420., 250., p.y);   // облака только в небе
    float nearMoon = exp(-pow(length((p-uMoon)*vec2(.6,1.6))/260.,2.));
    return smoothstep(.46, .82, w) * band * (0.55 + 0.6*nearMoon);
  }
  void main(){
    vec2 p = vec2(vUv.x*${W}., (1.-vUv.y)*${H}.);
    p = (floor(p/${PIX.toFixed(4)})+.5)*${PIX.toFixed(4)};          // та же пиксельная сетка
    float d = dens(p);
    if (d < 0.02) discard;
    vec2 dir = normalize(uMoon - p);
    float rim = clamp(d - dens(p + dir*14.), 0., 1.);               // кромка, обращённая к луне
    float near = exp(-length(p-uMoon)/380.);
    vec3 col = mix(vec3(.16,.2,.32), vec3(.42,.48,.62), near) + vec3(.6,.66,.8)*rim*near*1.4;
    gl_FragColor = vec4(col, clamp(d,0.,1.)*0.42);
  }` });
const clouds = new THREE.Mesh(plane, cloudMat); clouds.position.set(W / 2, H / 2, 0); clouds.renderOrder = order++; scene.add(clouds);
const mountains = layer('04_mountains', { lit: 0 });
// лёгкий туман в низинах: мягкая полоса fbm, медленно плывёт
const fogFrag = `uniform float uTime,uY0,uY1,uA,uFogBoost; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.05+vec2(1.3,2.1); a*=.5; } return v; }
  void main(){
    vec2 p = vec2(vUv.x*${W}., (1.-vUv.y)*${H}.);
    p = (floor(p/${PIX.toFixed(4)})+.5)*${PIX.toFixed(4)};
    float h = uY1 - uY0;
    float band = smoothstep(uY0, uY0 + h*.45, p.y) * smoothstep(uY1, uY1 - h*.45, p.y);
    float d = fbm(vec2(p.x*.0045 - uTime*.006, p.y*.035 + uTime*.003));
    float a = band * smoothstep(.38 - .08*(uFogBoost-1.), .8, d) * uA * uFogBoost;
    if (a < .004) discard;
    gl_FragColor = vec4(.48,.55,.68, a);
  }`;
function fog(y0, y1, a) {
  const m = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: layerVert, fragmentShader: fogFrag, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uTime: shared.uTime, uY0: { value: y0 }, uY1: { value: y1 }, uA: { value: a }, uFogBoost: shared.uFogBoost } }));
  m.position.set(W / 2, H / 2, 0); m.renderOrder = order++; scene.add(m); return m;
}
fog(340, 425, 0.26); // между подножием гор и дальним берегом
const shore = layer('05_far_shore', { lit: 0, amb: 0.95 });
const lake = layer('06_lake', { kind: 'lake', lit: 0.15 });
lake.material.uniforms.uRefl1.value = mountains.material.uniforms.map.value;
lake.material.uniforms.uRefl2.value = shore.material.uniforms.map.value;
fog(425, 500, 0.2); // над дальней водой
// дождь: тонкие пиксельные штрихи под небольшим углом, два слоя глубины
const rainFrag = `uniform float uRain,uNear,uRainDen,uRainLen,uRainSlant,uRainA,uRainT; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 p = vec2(vUv.x*${W}., (1.-vUv.y)*${H}.);
    float near = step(.5, uNear);
    float px = ${PIX.toFixed(4)} * mix(.75, 1., near);
    p = (floor(p/px)+.5)*px;
    float x = p.x + p.y*uRainSlant;                  // наклон растёт с силой дождя (ветер)
    float c = floor(x/px);
    float h = hash(vec2(c, uNear));
    float per = mix(200., 300., near);
    float len = mix(13., 26., near) * uRainLen;
    float shift = uRainT * mix(560., 950., near) * (.85+.3*h) - h*per*9.; // фаза копится в JS — без рывков при смене скорости
    float yy = p.y - shift;
    float cyc = floor(yy/per);
    // каждая капля «живёт» с вероятностью density — от единичных капель до ливня
    if (hash(vec2(c*1.7 + cyc*13.1, 3.+uNear)) > uRainDen * mix(1.2, 1., near)) discard;
    float m = mod(yy, per);
    if (m > len) discard;
    float a = mix(.2, .32, near) * uRain * uRainA * (m/len);
    gl_FragColor = vec4(.72,.78,.9, a);
  }`;
function rainLayer(near) {
  const m = new THREE.Mesh(plane, new THREE.ShaderMaterial({ vertexShader: layerVert, fragmentShader: rainFrag, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uRain: shared.uRain, uNear: { value: near ? 1 : 0 }, uRainDen: shared.uRainDen, uRainLen: shared.uRainLen, uRainSlant: shared.uRainSlant, uRainA: shared.uRainA, uRainT: shared.uRainT } }));
  m.position.set(W / 2, H / 2, 0); m.renderOrder = order++; scene.add(m); return m;
}
const rainFar = rainLayer(false);
layer('07_forest_mid', { lit: 0.5, amb: 0.9 });
const bats = new Particles(12, THREE.NormalBlending); scene.add(bats.points);
layer('08_ground', { lit: 1.2 });
layer('09_tree', { lit: 1.5 });
// фонарь качается вокруг точки подвеса
const lanternPivot = new THREE.Group(); lanternPivot.position.set(P.lanternPivot[0], wy(P.lanternPivot[1]), 0); scene.add(lanternPivot);
const lanternMesh = layer('10_lantern', { lit: 0.6 }); scene.remove(lanternMesh);
lanternMesh.position.set(W / 2 - P.lanternPivot[0], H / 2 - wy(P.lanternPivot[1]), 0); lanternPivot.add(lanternMesh);
// цепочка от ветки до кольца фонаря — качается вместе с ним (точка подвеса на ветке)
const chainLen = P.lanternRing[1] - P.lanternPivot[1] + 4;
const chain = new THREE.Mesh(new THREE.PlaneGeometry(PIX * 3, chainLen), new THREE.ShaderMaterial({ vertexShader: layerVert, transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uLit: shared.uLanternLit, uFire: shared.uFire },
  fragmentShader: `uniform float uLit,uFire; varying vec2 vUv;
  void main(){
    float rows = ${(chainLen / PIX).toFixed(2)};
    float cx = floor(vUv.x*3.), cy = floor(vUv.y*rows);
    bool on = mod(cy, 2.) < 1. ? (cx != 1.) : (cx == 1.);   // звенья: «кольцо» / «ребро» по очереди
    if (!on) discard;
    vec3 iron = vec3(.16,.14,.13) + vec3(.55,.32,.14)*(uLit*.45 + uFire*.25) * (cx == 0. ? 1. : .6);
    gl_FragColor = vec4(iron, 1.);
  }` }));
chain.position.set(0, -chainLen / 2 + 2, 0);
chain.renderOrder = lanternMesh.renderOrder - 0.5; lanternPivot.add(chain);
const lanternFlame = glow(14, 22, [1.0, 0.75, 0.35]);
const lanternGlow = glow(170, 170, [0.9, 0.5, 0.18]);
for (const g of [lanternFlame, lanternGlow]) { g.position.set(P.lanternFlame[0] - P.lanternPivot[0], -(P.lanternFlame[1] - P.lanternPivot[1]), 0); lanternPivot.add(g); }
layer('11_firering', { lit: 1.0, extra: { uRim: { value: 1 } } });
layer('12_fire_logs', { lit: 1.0 });
const ORD_FIRE = order++; // поленья в костре
const coal = glow(300, 90, [1.0, 0.28, 0.05], { noise: 1 }); coal.position.set(P.fire[0], wy(P.fire[1] + 5), 0); scene.add(coal);
// Пламя в три слоя: задний широкий тусклый, средний оранжевый, переднее бело-жёлтое ядро.
// У каждого слоя свои языки (позиция, высота, ширина, фаза), скорость и зерно шума.
const flameFrag = `uniform float uTime,uI,uSpeed,uMode; uniform vec2 uSize; uniform vec3 uSeed; uniform vec4 uT[6]; varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+1.7; a*=.5; } return v; }
  float tongue(vec2 q, vec4 T, float hs, float n, float t){
    if (T.z <= 0.) return 0.;
    float fl = .72 + .28*sin(t*(2.2+T.w*.9) + T.w*7.) + .22*(noise(vec2(t*(1.5+T.w*.4), T.w*13.)) - .5);
    float h = T.y*hs*fl;
    float y = q.y / h; if (y > 1.05) return 0.;
    float bend = (n - .5) * .6 * y + sin(t*2.1 + T.w*5.)*.05*y;
    float width = T.z * pow(max(0., 1. - y), .9) * (0.55 + .45*smoothstep(0., .22, y + .02));
    float d = abs(q.x - T.x - bend) / max(width, 1e-3);
    return clamp(1. - d, 0., 1.) * (1. - y*.5);
  }
  void main(){
    vec2 cells = uSize / ${PIX.toFixed(4)};
    vec2 suv = (floor(vUv*cells)+.5)/cells;
    vec2 q = vec2(suv.x*2.-1., suv.y);
    float t = floor(uTime*12.)/12. * uSpeed;
    float n = fbm(vec2(q.x*2.4, q.y*3. - t*2.4) + uSeed.xy);
    float n2 = fbm(vec2(q.x*5., q.y*6. - t*3.8) + uSeed.yz);
    float I = clamp(uI, 0., 1.);
    float hs = mix(.3, 1., I);
    float heat = 0.;
    for (int i = 0; i < 6; i++) heat = max(heat, tongue(q, uT[i], hs, n, t));
    heat = max(heat, clamp(1. - abs(q.x)*1.25, 0., 1.) * smoothstep(.14*hs, 0., q.y) * .6);
    heat = heat + (n2 - .5) * .45 * heat - q.y * .06;
    heat *= .75 + .35*I;
    heat *= smoothstep(.0, .1, q.y + (n2-.5)*.08) * (1. - smoothstep(.75, 1., abs(q.x))); // без резких краёв квада
    vec3 c; float a = 1.;
    if (uMode < .5) {            // задний слой: тёмно-красный/оранжевый, полупрозрачный
      if (heat > .5) c = vec3(.92,.38,.08); else if (heat > .28) c = vec3(.7,.18,.05); else if (heat > .13) { c = vec3(.36,.07,.03); a = .7; } else discard;
      a *= .85;
    } else if (uMode < 1.5) {    // средний: оранжевый
      if (heat > .6) c = vec3(1.,.72,.22); else if (heat > .34) c = vec3(.98,.5,.12); else discard;
    } else {                     // ядро: бело-жёлтое
      if (heat > .58) c = vec3(1.,.97,.8); else if (heat > .36) c = vec3(1.,.86,.42); else discard;
    }
    gl_FragColor = vec4(c, a);
  }`;
const flameGeo = new THREE.PlaneGeometry(1, 1); flameGeo.translate(0, 0.5, 0);
const FLAME_BASE_Y = P.fire[1] + 40; // основание прячется за передними камнями
const T = (x, h, w, ph) => new THREE.Vector4(x, h, w, ph);
const FLAME_LAYERS = [
  { mode: 0, w: 340, h: 320, speed: 0.8, tongues: [T(-.62, .45, .2, 1.1), T(-.32, .7, .26, 2.3), T(0, .82, .32, 3.7), T(.3, .66, .26, 4.2), T(.6, .42, .2, 5.9)] },
  { mode: 1, w: 270, h: 350, speed: 1.0, tongues: [T(-.42, .6, .26, .7), T(-.08, .95, .34, 1.9), T(.26, .78, .3, 3.3), T(.55, .45, .2, 6.1)] },
  { mode: 2, w: 170, h: 250, speed: 1.25, tongues: [T(-.22, .72, .36, 2.6), T(.2, .9, .4, 4.8)] },
];
const flames = FLAME_LAYERS.map((L) => {
  const tongues = [...L.tongues]; while (tongues.length < 6) tongues.push(T(0, 0, 0, 0));
  const mat = new THREE.ShaderMaterial({ vertexShader: layerVert, fragmentShader: flameFrag, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uTime: shared.uTime, uI: { value: 0 }, uSpeed: { value: L.speed }, uMode: { value: L.mode }, uT: { value: tongues },
      uSize: { value: new THREE.Vector2(1, 1) }, uSeed: { value: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) } } });
  const m = new THREE.Mesh(flameGeo, mat); m.renderOrder = order++; m.position.set(P.fire[0], wy(FLAME_BASE_Y), 0); scene.add(m);
  return { m, L };
});
// передние камни кольца рисуем повторно поверх пламени
const ringFront = layer('11_firering', { lit: 1.0, extra: { uUseMask: { value: 1 }, uMask: { value: loadTex('11_firering_front') }, uRim: { value: 1 } } }); // маска по силуэту передних и боковых камней
const ORD_ZONE = order++;
const sparks = new Particles(150, THREE.AdditiveBlending); scene.add(sparks.points);
// статичная поленница заменена отдельными поленьями (см. woodview.js)
const ORD_PILE = order++;
layer('14_stump', { lit: 1.2 });
const ORD_AXE = order++;
const chips = new Particles(90, THREE.NormalBlending); scene.add(chips.points); chips.points.material.uniforms.uCells.value = 2;
layer('15_camp_left', { lit: 1.2 });
const steam = new Particles(80, THREE.NormalBlending); scene.add(steam.points);
// радио: кнопка-диод слева на корпусе (красный — выкл., зелёный — вкл.) и оранжевый ореол при наведении
const radioHalo = glow(64, 64, [1.0, 0.55, 0.15]); radioHalo.position.set(P.radioBtn[0], wy(P.radioBtn[1]), 0); scene.add(radioHalo);
const radioLed = glow(16, 16, [1.0, 0.12, 0.08]); radioLed.position.set(P.radioBtn[0], wy(P.radioBtn[1]), 0); scene.add(radioLed);
let radioHover = 0, radioHoverT = 0, knobAngle = 0;
const smoke = new Particles(160, THREE.NormalBlending); scene.add(smoke.points);
smoke.points.material.uniforms.uCells.value = 14; steam.points.material.uniforms.uCells.value = 8; // дым мягче искр
const fireGlow = glow(700, 420, [1.0, 0.42, 0.12]); fireGlow.position.set(P.fire[0], wy(P.fire[1] - 60), 0); scene.add(fireGlow);
layer('16_foreground', { lit: 0.9 });
const ORD_DRAG = order++; // перетаскиваемое полено — поверх всего
const rainNear = rainLayer(true);

// апскейл ближайшим соседом + лёгкая виньетка
const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { t: { value: rt.texture }, uRain: shared.uRain, uRainDesat: shared.uRainDesat, uRainDark: shared.uRainDark }, depthTest: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
  fragmentShader: `uniform sampler2D t; uniform float uRain,uRainDesat,uRainDark; varying vec2 vUv; void main(){ vec3 c=texture2D(t,vUv).rgb;
    c = mix(c, vec3(dot(c, vec3(.3,.59,.11)))*vec3(.92,.96,1.05),  uRainDesat*uRain) * (1. - uRainDark*uRain); // дождь: темнее и бледнее
    vec2 q=vUv-.5; c*=1.-dot(q,q)*0.55; gl_FragColor=vec4(c,1.); }` }));
const postScene = new THREE.Scene(); postScene.add(post); const postCam = new THREE.Camera();

const rand = (a, b) => a + Math.random() * (b - a);
// ---------- состояние и логика костра ----------
let vclock = Date.now(), speed = SPEED; // виртуальные часы костра (тестовые кнопки меняют speed)
const vnow = () => vclock;
// ?fresh=1 — начать с чистого состояния; ?prog=0.5 — прогресс горения поленьев в костре (отладка)
const fresh = params.has('fresh');
function startWood() {
  const w = new Woodpile();
  const k = makeLog('kindling'); k.p = 0.12; const b = makeLog('birch_medium'); b.p = 0.04;
  w.fire.push(k, b); return w;
}
const wood = (!fresh && loadWood(localStorage, Date.now())) || startWood();
if (params.has('prog')) for (const l of wood.fire) l.p = Math.min(0.99, Number(params.get('prog')));
// совместимость со старым кодом сцены
const fire = { get fuel() { return wood.burning ? 1 : 0; }, get isOut() { return !wood.burning; }, get intensity() { return wood.intensity(); },
  tick() {}, extinguish() { wood.douse(); }, save() { saveWood(wood, Date.now()); } };
const fuelParam = null;
let shown = 0, ember = 0, doused = 0, outAt = null, fadeDur = 420, emberStart = 0; // doused: секунд с момента тушения (0 — не тушили)
const audio = new Ambience();
let sel = 0, burst = 0;
let settings = loadSettings();
audio.setVolumes(settings.volumes); audio.setRain(settings.rain, settings.rainLevel);
let rainLevelShown = settings.rainLevel;
shared.uRain.value = settings.rain ? 1 : 0;
const rainBtn = document.getElementById('rain');
function renderRain() {
  rainBtn.classList.toggle('on', settings.rain); rainBtn.setAttribute('aria-pressed', settings.rain);
  // «Сила дождя» видна только при дожде; скрытый ползунок не участвует в навигации пультом
  const box = document.querySelector('label.rainlvl'); box.classList.toggle('collapsed', !settings.rain);
  const r = document.getElementById('rainlvl'); r.disabled = !settings.rain; r.tabIndex = settings.rain ? 0 : -1;
  if (!settings.rain && document.activeElement === r) rainBtn.focus();
}
rainBtn.addEventListener('click', () => { settings = toggleRain(settings); saveSettings(settings); audio.setRain(settings.rain, settings.rainLevel); renderRain(); });
const rainLvl = document.getElementById('rainlvl');
rainLvl.value = Math.round(settings.rainLevel * 100);
rainLvl.addEventListener('input', () => { settings = setRainLevel(settings, rainLvl.value / 100); saveSettings(settings); audio.setRain(settings.rain, settings.rainLevel); });
renderRain();
// ---------- радио ----------
const radioBtn = document.getElementById('radio'), radioVolEl = document.getElementById('radiovol');
audio.setRadio(settings.radio, settings.radioVol);
const stationEl = document.getElementById('station');
const tuner = new Tuner({ audio, onName: (name) => {
  stationEl.textContent = name || (navigator.onLine ? 'нет сигнала' : 'нет сети — только эфир');
  if (name) { settings.radioStation = tuner.cur()?.id || ''; saveSettings(settings); }
} });
tuner.setVolume(settings.radioVol);
const tunerReady = tuner.load();
let audioUnlocked = false;
function syncTuner() { tunerReady.then(() => { if (settings.radio && audioUnlocked) { if (tuner.state === 'off') { stationEl.textContent = 'настройка…'; tuner.setOn(true, settings.radioStation); } } else if (!settings.radio) tuner.setOn(false); }); }
function renderRadio() {
  radioBtn.classList.toggle('on', settings.radio); radioBtn.setAttribute('aria-pressed', settings.radio);
  const box = document.querySelector('label.radiovol'); box.classList.toggle('collapsed', !settings.radio);
  for (const el of [radioVolEl, document.getElementById('stprev'), document.getElementById('stnext')]) { el.disabled = !settings.radio; el.tabIndex = settings.radio ? 0 : -1; }
  if (!settings.radio && document.activeElement === radioVolEl) radioBtn.focus();
}
function switchRadio() { firstInteraction(); settings = toggleRadio(settings); saveSettings(settings); audio.radioClick(); audio.setRadio(settings.radio, settings.radioVol); renderRadio(); syncTuner(); }
radioBtn.addEventListener('click', switchRadio);
radioVolEl.value = Math.round(settings.radioVol * 100);
radioVolEl.addEventListener('input', () => { settings = setRadioVol(settings, radioVolEl.value / 100); saveSettings(settings); audio.setRadio(settings.radio, settings.radioVol); tuner.setVolume(settings.radioVol); });
document.getElementById('stprev').addEventListener('click', () => tuner.turn(-1));
document.getElementById('stnext').addEventListener('click', () => tuner.turn(1));
renderRadio();
const hitRadio = (x, y) => Math.hypot(x - P.radioBtn[0], y - P.radioBtn[1]) < 16;
const hitKnob = (x, y) => Math.hypot(x - P.radioKnob[0], y - P.radioKnob[1]) < 26;
let wheelAcc = 0;
canvas.addEventListener('wheel', (ev) => { // колесо над круглой ручкой — перестройка станций
  const [x, y] = woodView.toWorld(ev.clientX, ev.clientY); if (!hitKnob(x, y)) return;
  ev.preventDefault(); if (!settings.radio) { hint('Сначала включите радио — кнопка слева на корпусе'); return; }
  wheelAcc += ev.deltaY; const st = Math.trunc(wheelAcc / 90); if (!st) return; wheelAcc -= st * 90; // один щелчок колеса — одна станция
  knobAngle += st * 0.5; tuner.turn(st);
}, { passive: false });
window.addEventListener('pointermove', (ev) => { // на window — после обработчика поленьев, чтобы курсор не сбрасывался
  if (ev.target !== canvas) { radioHover = 0; return; }
  if (woodView.drag) { radioHover = 0; return; }
  const [x, y] = woodView.toWorld(ev.clientX, ev.clientY); radioHover = hitRadio(x, y) ? 1 : 0;
  if (radioHover) canvas.style.cursor = 'pointer'; else if (hitKnob(x, y) && settings.radio) canvas.style.cursor = 'ns-resize';
});
canvas.addEventListener('pointerleave', () => { radioHover = 0; });
canvas.addEventListener('pointerdown', (ev) => { const [x, y] = woodView.toWorld(ev.clientX, ev.clientY); if (hitRadio(x, y)) switchRadio(); });
const volPanel = document.getElementById('volumes'), volBtn = document.getElementById('volbtn');
for (const { id, name } of SOUND_LAYERS) {
  const row = document.createElement('label'); row.className = 'vol';
  row.innerHTML = `<span>${name}</span><input type="range" min="0" max="100" step="5">`;
  const inp = row.querySelector('input'); inp.value = Math.round(settings.volumes[id] * 100);
  inp.addEventListener('input', () => { settings.volumes[id] = inp.value / 100; audio.setVolumes({ [id]: settings.volumes[id] }); saveSettings(settings); });
  volPanel.appendChild(row);
}
volBtn.addEventListener('click', () => { volPanel.hidden = !volPanel.hidden; volBtn.setAttribute('aria-expanded', !volPanel.hidden); });
const testRow = document.getElementById('testrow');
if (TEST_CONTROLS) {
  testRow.hidden = false;
  for (const v of [0.5, 1, 10, 60]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'seg'; b.textContent = '×' + v;
    b.addEventListener('click', () => { speed = v; [...testRow.querySelectorAll('button')].forEach((x) => x.classList.toggle('sel', x === b)); });
    if (v === speed) b.classList.add('sel');
    testRow.appendChild(b);
  }
} else testRow.remove();

const info = document.getElementById('info');
// выбор породы для кнопки «Подбросить дрова» (если такой нет в поленнице — берётся любая)
// «Подбросить дрова» берёт случайное полено из поленницы
const persist = () => { if (speed === 1) fire.save(); };
const toast = document.getElementById('toast'); let toastT;
function hint(text) { toast.textContent = text; toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 2600); }
function renderUI() {
  const inFire = wood.fire.filter((l) => !l.wet).length;
  info.textContent = `${fire.isOut ? (ember > 0.02 ? 'тлеют угли' : 'костёр погас') : `в костре: ${inFire}`} · в поленнице: ${wood.pile.length}/${PILE_MAX}`;
}
function addLog() {
  if (!woodView.throwOne(null)) hint('Поленница пуста — наколите дров топором у пня');
  renderUI();
}
function douse() {
  if (fire.isOut && ember < 0.05) return;
  fire.extinguish(vnow()); persist();
  doused = 0.001; audio.hiss();
  const [fx, fy] = P.fire; // клуб пара
  for (let k = 0; k < 70; k++) smoke.spawn({ x: fx + rand(-90, 90), y: fy - rand(0, 40), vx: rand(-25, 25), vy: -rand(50, 110), life: rand(2.5, 5), steam: 1 });
  renderUI();
}

// ---------- интерфейс: ТВ-режим ----------
let idleTimer;
function wake() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 6000); }
const overlay = document.getElementById('overlay');
let started = false;
// Звук: AudioContext создаётся/возобновляется только внутри жеста пользователя
function firstInteraction() {
  audio.start(); if (!audioUnlocked) { audioUnlocked = true; syncTuner(); }
  if (started) return; started = true; overlay.classList.add('gone');
  // ?owl=1 — отладка: сова и крылья через 2 и 6 с после первого жеста
  if (params.has('owl')) { setTimeout(() => audio.owl?.(), 2000); setTimeout(() => audio.wings?.(1), 6000); }
}
const muteBtn = document.getElementById('mute'), fsBtn = document.getElementById('fs');
function toggleMute() { audio.setMuted(!audio.muted); muteBtn.querySelector('span').textContent = audio.muted ? 'Звук выкл' : 'Звук'; muteBtn.classList.toggle('off', audio.muted); }
function toggleFs() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}
document.getElementById('add').addEventListener('click', addLog);
document.getElementById('douse').addEventListener('click', douse);
document.getElementById('chopbtn').addEventListener('click', () => woodView.chop());
muteBtn.addEventListener('click', toggleMute);
fsBtn.addEventListener('click', toggleFs);
// любой жест (клик, тап, клавиша пульта) включает звук; дрова по клику на сцену НЕ добавляются
for (const ev of ['pointerdown', 'touchend', 'click']) window.addEventListener(ev, () => { firstInteraction(); wake(); }, { capture: true });
window.addEventListener('pointermove', wake);
// меню прячется в круглую кнопку: раскрывается при наведении/нажатии/пульте, сворачивается через 5 с после ухода мыши
const hud = document.getElementById('hud'), menuBtn = document.getElementById('menubtn');
let menuTimer = 0, overMenu = false;
function openMenu() { clearTimeout(menuTimer); hud.classList.remove('closed'); menuBtn.setAttribute('aria-expanded', 'true'); }
function scheduleClose(ms = 5000) { clearTimeout(menuTimer); menuTimer = setTimeout(() => { if (overMenu) return; hud.classList.add('closed'); menuBtn.setAttribute('aria-expanded', 'false'); if (hud.contains(document.activeElement)) document.activeElement.blur(); }, ms); }
for (const el of [hud, menuBtn]) {
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { overMenu = true; openMenu(); } });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { overMenu = false; scheduleClose(); } });
}
menuBtn.addEventListener('click', () => { openMenu(); if (!overMenu) scheduleClose(); });
hud.addEventListener('pointerdown', () => { if (!overMenu) scheduleClose(); }); // касание на телефоне продлевает
const focusables = () => [...document.querySelectorAll('#hud button, #hud input')].filter((el) => el.offsetParent !== null && !el.disabled && !el.closest('.collapsed') && !el.closest('.closed'));
window.addEventListener('keydown', (e) => {
  firstInteraction(); wake();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) { // пульт: открыть меню, закрыть через 5 с тишины
    const wasClosed = hud.classList.contains('closed'); openMenu(); if (!overMenu) scheduleClose();
    if (wasClosed) { document.getElementById('add').focus(); e.preventDefault(); return; }
  }
  const list = focusables(), i = list.indexOf(document.activeElement);
  const k = e.key;
  const onRange = document.activeElement?.type === 'range';
  if (onRange && (k === 'ArrowLeft' || k === 'ArrowRight')) { /* ползунок громкости — стрелки двигают его */ }
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    const n = i < 0 ? list.indexOf(document.getElementById('add')) : (i + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[n].focus(); e.preventDefault();
  } else if (k === 'ArrowLeft' || k === 'ArrowRight') { // навигация пультом между кнопками
    const n = i < 0 ? list.indexOf(document.getElementById('add')) : (i + (k === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[n].focus(); e.preventDefault();
  } else if ((k === 'Enter' || k === ' ') && i < 0) { document.getElementById('add').focus(); e.preventDefault(); } // первое OK — показать фокус
  else if (k === 'l' || k === 'L' || k === 'д' || k === 'Д') addLog();
  else if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') toggleMute();
  else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') toggleFs();
}, { capture: true });
wake(); renderUI();

function resize() {
  // cover: кадр 16:9 заполняет экран целиком, лишнее обрезается — без полос
  const vw = innerWidth, vh = innerHeight; const sc = Math.max(vw / 16, vh / 9);
  let w = Math.ceil(sc * 16), h = Math.ceil(sc * 9);
  const dpr = devicePixelRatio || 1;
  let bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  const cap = Math.min(1, 1920 / bw, 1080 / bh); // не больше 1920x1080 — бережём ТВ
  bw = Math.round(bw * cap); bh = Math.round(bh * cap);
  renderer.setSize(bw, bh, false);
  if (LOW) { RW = 480; RH = 270; } else { RW = bw; RH = bh; }
  rt.setSize(RW, RH); pxScale.value = RW / (W - 2 * CROP_X);
  Object.assign(canvas.style, { width: w + 'px', height: h + 'px', left: Math.floor((vw - w) / 2) + 'px', top: Math.floor((vh - h) / 2) + 'px' });
}
addEventListener('resize', resize); resize();

// ---------- дрова: поленница, перетаскивание, топор ----------
function sparkBurst(x, y, n) {
  for (let k = 0; k < n; k++) sparks.spawn({ x: x + rand(-30, 30), y: y - rand(0, 20), vx: rand(-120, 120), vy: -rand(120, 320), life: rand(0.6, 1.6), ph: rand(0, 6), drift: rand(20, 60) });
}
function chipBurst(x, y) {
  for (let k = 0; k < 14; k++) chips.spawn({ x: x + rand(-10, 10), y, vx: rand(-160, 160), vy: -rand(80, 260), life: rand(0.5, 0.9), c: Math.random() });
}
const woodView = new WoodView({ scene, shared, PIX, W, H, wy, crop: { x: CROP_X, y: CROP_Y }, canvas, audio, wood, hint, sparkBurst, chipBurst,
  orders: { pile: ORD_PILE, fire: ORD_FIRE, drag: ORD_DRAG, axe: ORD_AXE, zone: ORD_ZONE },
  isRaining: () => settings.rain,
  changed: () => { persist(); renderUI(); },
  onLand: (log, x, y) => {
    doused = 0; burst = 1; audio.thud?.(); sparkBurst(x, y - 10, 22);
    if (settings.rain && log.moisture > 0.25) audio.wetHiss?.();
  } });
// ---------- кадр ----------

let last = performance.now(), nextBats = 60 + Math.random() * 120, saveAt = 0, timeSec = 0;
function frame(now) {
  const realDt = Math.max(0, (now - last) / 1000), dt = Math.min(0.1, realDt); last = now; timeSec += dt;
  vclock += realDt * 1000 * speed;
  shared.uRain.value += ((settings.rain ? 1 : 0) - shared.uRain.value) * (1 - Math.exp(-dt * 0.5));
  rainLevelShown += (settings.rainLevel - rainLevelShown) * (1 - Math.exp(-dt * 1.2)); // плавно, без рывков
  const RP = rainParams(rainLevelShown);
  shared.uRainDen.value = RP.density; shared.uRainLen.value = RP.length; shared.uRainSlant.value = RP.slant;
  shared.uRainA.value = RP.alpha; shared.uRainRing.value = RP.rings; shared.uRainDesat.value = RP.desat; shared.uRainDark.value = RP.darken;
  shared.uRainT.value += dt * RP.speed;
  shared.uFogBoost.value = 1 + shared.uRain.value * (RP.fog - 1);
  const raining = settings.rain && shared.uRain.value > 0.5;
  wood.tick(realDt * speed, raining);
  const [shx, shy] = woodView.update(dt); cam.position.set(shx, shy, 0);
  // сосна «стреляет» искрами
  for (const l of wood.fire) if (!l.wet && l.species === 'pine' && Math.random() < dt * 0.5 * heatCurve('pine', l.thick, l.p)) {
    audio.pop?.(); const [px, py] = P.fire; sparkBurst(px + rand(-50, 50), py - 10, 8);
  }
  const target = fire.intensity * (1 - shared.uRain.value * RP.fireDamp); // под дождём приглушён (сильнее при ливне), но не гаснет
  // огонь разгорается за несколько секунд и угасает медленно
  if (doused > 0) doused += dt;
  const downRate = doused > 0 ? 2.5 : 0.08; // после тушения пламя гаснет за ~1–2 с
  shown += (target - shown) * (target > shown ? 1 - Math.exp(-dt * 0.6) : 1 - Math.exp(-dt * downRate));
  if (fire.fuel > 0) { ember = Math.max(ember, 0.25 + 0.5 * shown, Math.min(1, wood.coal * 0.6)); outAt = null; }
  else { wood.coal = ember / 0.6; // угли полностью гаснут за 5–10 минут (и после тушения, и когда прогорело само)
    if (outAt === null) { outAt = vclock; fadeDur = pickEmberFade(); emberStart = ember; }
    ember = emberLevel((vclock - outAt) / 1000, fadeDur, emberStart);
  }
  const I = fire.isOut ? Math.min(shown, doused > 0 ? shown : ember * 0.3) : shown;
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
  shared.uLanternPos.value.set(P.lanternFlame[0] + Math.sin(ang) * (P.lanternFlame[1] - P.lanternPivot[1]), P.lanternFlame[1]);

  coal.material.uniforms.uI.value = Math.min(1.3, ember * 0.9 + I * 0.5) * (0.85 + 0.15 * Math.sin(timeSec * 1.7));
  fireGlow.material.uniforms.uI.value = I * (0.1 + 0.06 * Math.max(0, I - 1)) * flick;
  tuner.update(dt); tuner.plain.muted = audio.muted;
  radioHoverT += ((radioHover ? 1 : 0) - radioHoverT) * (1 - Math.exp(-dt * 10));
  radioHalo.material.uniforms.uI.value = 0.95 * radioHoverT;
  if (settings.radio) { radioLed.material.uniforms.uColor.value.setRGB(0.25, 1.0, 0.3); radioLed.material.uniforms.uI.value = 0.9 + 0.05 * Math.sin(timeSec * 2.3); }
  else { radioLed.material.uniforms.uColor.value.setRGB(1.0, 0.12, 0.08); radioLed.material.uniforms.uI.value = 0.28 + 0.12 * radioHoverT; }

  // пламя
  const [fx, fy] = P.fire;
  burst = Math.max(0, burst - dt);
  const fI = Math.min(1.5, I + burst * 0.15); // 8–10 поленьев — до 1.5: выше, ярче
  for (const { m, L } of flames) {
    m.visible = fI > 0.02;
    m.scale.set(L.w * (0.5 + 0.5 * fI), L.h * (0.3 + 0.7 * fI), 1);
    m.material.uniforms.uI.value = Math.min(1.2, fI); m.material.uniforms.uSize.value.set(m.scale.x, m.scale.y);
  }
  for (let k = 0; k < (0.6 + 5 * I + burst * 8) * dt; k++) if (I > 0.03 || Math.random() < 0.02)
    // искры рождаются в нижней части пламени по всей ширине и сразу расходятся в стороны
    sparks.spawn({ x: fx + rand(-1, 1) * (70 + 70 * I), y: fy - rand(5, 45) * (0.5 + I), vx: rand(-60, 60), vy: -rand(90, 240) * (0.5 + 0.7 * I), life: rand(0.9, 2.4), ph: rand(0, 6), drift: rand(20, 70) });
  sparks.update(dt, (p, dt, k) => {
    p.x += (p.vx + Math.sin(timeSec * (1.5 + p.ph * 0.4) + p.ph) * p.drift) * dt; p.y += p.vy * dt; p.vy *= 1 - dt * 0.8;
    return { r: 1, g: 0.7 - k * 0.3, b: 0.3 - k * 0.2, size: 4 - k * 1.5, a: Math.pow(1 - k, 1.5) * 0.85 };
  });
  // дым
  const smokeAmt = (fire.isOut ? ember * 7 : 2 + I * 6) + (doused > 0 && doused < 6 ? 25 : 0); // дым сходит на нет вместе с углями
  for (let k = 0; k < smokeAmt * dt; k++) smoke.spawn({ x: fx + rand(-30, 30), y: fy - 40 - 150 * I, vx: rand(-6, 6), vy: -rand(25, 45), life: rand(5, 8) });
  smoke.update(dt, (p, dt, k) => {
    p.x += (p.vx + 9 + Math.sin(timeSec * 0.7 + p.life) * 8) * dt; p.y += p.vy * dt;
    if (p.steam || doused > 0 && doused < 6 && p.age < 0.05) p.steam = 1;
    return p.steam ? { r: 0.78, g: 0.8, b: 0.86, size: 26 + k * 120, a: Math.sin(k * Math.PI) * 0.26 }
      : { r: 0.42, g: 0.42, b: 0.47, size: 20 + k * 90, a: Math.sin(k * Math.PI) * 0.16 };
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
    nextBats = rand(120, 300); // редко: раз в 2–5 минут
    const dir = Math.random() < 0.5 ? 1 : -1, y = rand(140, 330), n = 1 + (Math.random() * 3 | 0);
    if (Math.random() < 0.6) audio.wings?.(dir);
    for (let i = 0; i < n; i++) bats.spawn({ x: dir > 0 ? -40 - i * 60 : W + 40 + i * 60, y: y + rand(-30, 30), vx: dir * rand(110, 160), life: 22, ph: rand(0, 6) });
  }
  chips.update(dt, (p, dt, k) => {
    p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    const c = p.c > 0.5 ? [0.85, 0.7, 0.48] : [0.55, 0.38, 0.24];
    return { r: c[0], g: c[1], b: c[2], size: 5, a: 1 - k * k };
  });
  bats.update(dt, (p, dt) => {
    p.x += p.vx * dt; p.y += Math.sin(timeSec * 2 + p.ph) * 18 * dt;
    if (p.x < -200 || p.x > W + 200) p.age = p.life;
    const f = 0.5 + 0.5 * Math.sin(timeSec * 16 + p.ph);
    return { r: 0.03, g: 0.03, b: 0.06, size: 22, a: 1, shape: 1 + Math.min(0.99, f * 0.98) };
  });

  if (now > saveAt) { saveAt = now + 10000; persist(); renderUI(); }

  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__campfire = { tuner, fire, wood, woodView, addLog, douse, audio, state: () => ({ shown, ember, fuel: fire.fuel, doused, audio: audio.ctx?.state ?? 'none', radio: settings.radio, radioVol: settings.radioVol, tuner: { state: tuner.state, idx: tuner.idx, name: tuner.cur()?.name, mix: tuner.mix, bad: [...tuner.bad] }, rain: settings.rain, rainLevel: settings.rainLevel, rainShown: rainLevelShown, speed, outAt, fadeDur }), setSpeed: (v) => { speed = v; } };
