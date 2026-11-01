import test from 'node:test';
import assert from 'node:assert/strict';
import { Fire, START_FUEL, MAX_FUEL, STORAGE_KEY } from '../src/fire.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('starts with ~10 minutes', () => {
  const f = new Fire({ now: 0 });
  assert.equal(f.fuel, START_FUEL);
  assert.ok(f.intensity > 0);
});
test('burns in real time', () => {
  const f = new Fire({ now: 0 }).tick(60_000);
  assert.equal(f.fuel, START_FUEL - 60);
});
test('goes out and does not go negative', () => {
  const f = new Fire({ now: 0 }).tick(10 * 3600_000);
  assert.equal(f.fuel, 0); assert.equal(f.intensity, 0); assert.ok(f.isOut);
});
test('log durations', () => {
  for (const [id, s] of [['chips', 300], ['birch', 1200], ['oak', 2700]]) {
    const f = new Fire({ fuel: 0, now: 0 }).addLog(id, 0);
    assert.equal(f.fuel, s);
  }
});
test('unknown log throws', () => assert.throws(() => new Fire().addLog('pine')));
test('fuel capped', () => {
  const f = new Fire({ now: 0 });
  for (let i = 0; i < 20; i++) f.addLog('oak', 0);
  assert.equal(f.fuel, MAX_FUEL);
});
test('intensity monotonic in fuel', () => {
  let prev = -1;
  for (const fuel of [0, 10, 60, 300, 900, 1800, 3600]) {
    const i = new Fire({ fuel, now: 0 }).intensity;
    assert.ok(i >= prev && i <= 1); prev = i;
  }
});
test('configurable logs', () => {
  const f = new Fire({ fuel: 0, now: 0, logs: [{ id: 'x', name: 'x', seconds: 7 }] }).addLog('x', 0);
  assert.equal(f.fuel, 7);
});
test('save/load accounts for time closed', () => {
  const s = mem();
  new Fire({ fuel: 600, now: 1000 }).save(s);
  assert.ok(s.getItem(STORAGE_KEY));
  const f = Fire.load(s, 1000 + 120_000);
  assert.equal(f.fuel, 480);
});
test('load with empty or broken storage gives fresh fire', () => {
  assert.equal(Fire.load(mem(), 0).fuel, START_FUEL);
  const s = mem(); s.setItem(STORAGE_KEY, '{bad');
  assert.equal(Fire.load(s, 0).fuel, START_FUEL);
});
test('extinguish sets fuel to 0 and saves', () => {
  const s = mem();
  const f = new Fire({ fuel: 900, now: 0 }).addLog('oak', 0);
  f.extinguish(1000); f.save(s);
  assert.equal(f.fuel, 0); assert.equal(f.intensity, 0); assert.ok(f.isOut);
  assert.equal(JSON.parse(s.getItem(STORAGE_KEY)).fuel, 0);
  assert.equal(Fire.load(s, 5000).fuel, 0);
});
test('add log after extinguish relights', () => {
  const f = new Fire({ fuel: 100, now: 0 }).extinguish(0).addLog('birch', 0);
  assert.equal(f.fuel, 1200); assert.ok(f.intensity > 0);
});
test('add log gives a flare and different types burn differently', () => {
  const a = new Fire({ fuel: 0, now: 0 }).addLog('chips', 0), b = new Fire({ fuel: 0, now: 0 }).addLog('oak', 0);
  assert.ok(a.boost > 0); assert.ok(b.fuel > a.fuel);
  assert.ok(a.tick(301_000).isOut); assert.ok(!b.tick(301_000).isOut);
});
import { pickEmberFade, emberLevel, EMBER_FADE_MIN, EMBER_FADE_MAX } from '../src/fire.js';
import { loadSettings, saveSettings, toggleRain, toggleRadio, setRadioVol, SETTINGS_KEY } from '../src/settings.js';
test('ember fade duration is 5..10 minutes', () => {
  assert.equal(pickEmberFade(() => 0), 300); assert.equal(pickEmberFade(() => 1), 600);
  for (let i = 0; i < 50; i++) { const d = pickEmberFade(); assert.ok(d >= EMBER_FADE_MIN && d <= EMBER_FADE_MAX); }
});
test('ember level fades monotonically to exactly 0 at the end', () => {
  const d = 420; let prev = 2;
  for (let t = 0; t <= d; t += 10) { const e = emberLevel(t, d, 0.8); assert.ok(e <= prev && e >= 0); prev = e; }
  assert.equal(emberLevel(0, d, 0.8), 0.8); assert.equal(emberLevel(d, d, 0.8), 0); assert.equal(emberLevel(d + 100, d, 0.8), 0);
  assert.ok(emberLevel(d * 0.5, d, 1) > 0.05);
});
test('rain toggle persists', () => {
  const s = mem();
  let st = loadSettings(s); assert.equal(st.rain, false);
  st = toggleRain(st); saveSettings(st, s);
  assert.equal(loadSettings(s).rain, true);
  saveSettings(toggleRain(loadSettings(s)), s); assert.equal(loadSettings(s).rain, false);
});
test('volumes persist and are clamped', () => {
  const s = mem(); s.setItem(SETTINGS_KEY, JSON.stringify({ volumes: { fire: 5, wind: -1, water: 'x', owl: 0.3 } }));
  const v = loadSettings(s).volumes;
  assert.equal(v.fire, 1); assert.equal(v.wind, 0); assert.equal(v.water, 1); assert.equal(v.owl, 0.3);
});
import { rainParams, setRainLevel } from '../src/settings.js';
test('rain intensity mapping is monotonic and bounded', () => {
  const lo = rainParams(0), hi = rainParams(1), mid = rainParams(0.5);
  for (const k of ['density', 'speed', 'length', 'slant', 'rings', 'soundGain', 'soundCutoff', 'desat', 'darken', 'fog', 'fireDamp'])
    assert.ok(lo[k] < mid[k] && mid[k] < hi[k], k);
  assert.ok(lo.dripInterval > hi.dripInterval);
  assert.ok(lo.density < 0.02, 'weakest = just a few drops');
  assert.ok(hi.fireDamp < 0.5, 'downpour dampens but never puts the fire out');
  assert.deepEqual(rainParams(-3), lo); assert.deepEqual(rainParams(7), hi);
});
test('rain level persists and is clamped', () => {
  const s = mem();
  saveSettings(setRainLevel(loadSettings(s), 0.9), s); assert.equal(loadSettings(s).rainLevel, 0.9);
  saveSettings(setRainLevel(loadSettings(s), 4), s); assert.equal(loadSettings(s).rainLevel, 1);
});

test('радио: вкл/выкл и громкость сохраняются', () => {
  const m = new Map(); const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  let st = loadSettings(s); assert.equal(st.radio, false); assert.equal(st.radioVol, 0.6);
  st = setRadioVol(toggleRadio(st), 1.7); saveSettings(st, s);
  const r = loadSettings(s); assert.equal(r.radio, true); assert.equal(r.radioVol, 1);
});

import { nextIndex } from '../src/radio.js';
test('тюнер: пропуск нерабочих станций и круг', () => {
  assert.equal(nextIndex(5, 0, 1, new Set()), 1);
  assert.equal(nextIndex(5, 0, -1, new Set()), 4);
  assert.equal(nextIndex(5, 1, 1, new Set([2, 3])), 4);
  assert.equal(nextIndex(3, 0, 1, new Set([0, 1, 2])), -1);
  assert.equal(nextIndex(0, 0, 1, new Set()), -1);
});
