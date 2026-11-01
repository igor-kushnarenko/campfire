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
