import test from 'node:test';
import assert from 'node:assert/strict';
import { Woodpile, makeLog, burnDuration, heatCurve, phaseOf, peakAt, PILE_MAX, PILE_START, saveWood, loadWood, WOOD_KEY, SPRITES } from '../src/wood.js';
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('species burn times: kindling fastest, oak longest, thick longer than thin', () => {
  assert.ok(burnDuration('twigs', 0.1) < burnDuration('kindling', 0.25));
  assert.ok(burnDuration('kindling', 0.25) < burnDuration('pine', 0.6));
  assert.ok(burnDuration('pine', 0.6) < burnDuration('birch', 0.6));
  assert.ok(burnDuration('birch', 0.6) < burnDuration('oak', 0.6));
  for (const s of ['birch', 'oak', 'pine']) assert.ok(burnDuration(s, 1) > burnDuration(s, 0.3) * 1.8, s);
});
test('heat curve: zero at ends, peaks later for thick logs, oak plateau is wide', () => {
  for (const s of ['birch', 'oak', 'pine', 'kindling', 'twigs']) { assert.equal(heatCurve(s, 0.5, 0), 0); assert.equal(heatCurve(s, 0.5, 1), 0); }
  assert.ok(peakAt(1) > peakAt(0.3));
  const argmax = (s, t) => { let b = 0, bp = 0; for (let p = 0; p <= 1; p += 0.01) { const h = heatCurve(s, t, p); if (h > b) { b = h; bp = p; } } return bp; };
  assert.ok(argmax('birch', 1) > argmax('birch', 0.3));
  const above = (s) => { let n = 0; for (let p = 0; p <= 1; p += 0.01) if (heatCurve(s, 0.6, p) > 0.9 * heatCurve(s, 0.6, peakAt(0.6) + 0.01)) n++; return n; };
  assert.ok(above('oak') > above('kindling'));
  assert.ok(heatCurve('kindling', 0.25, peakAt(0.25) + 0.01) > heatCurve('oak', 0.65, peakAt(0.65) + 0.01), 'kindling brighter');
});
test('phases progress ignite → burn → smolder → coals', () => {
  const ph = [0.01, 0.4, 0.8, 0.95].map((p) => phaseOf('birch', 0.6, p));
  assert.deepEqual(ph, ['ignite', 'burn', 'smolder', 'coals']);
});
test('pile take/put: by species, fallback to random, shrinks and caps', () => {
  const w = new Woodpile({ rnd: seq(0.1, 0.5, 0.9) });
  assert.equal(w.pile.length, PILE_START);
  const oak = w.take({ species: 'oak' }); assert.equal(oak.species, 'oak'); assert.equal(w.pile.length, PILE_START - 1);
  const none = new Woodpile({ pile: [makeLog('birch_thin')] }).take({ species: 'oak' }); assert.equal(none.species, 'birch');
  assert.equal(new Woodpile({ pile: [] }).take(), null);
  w.putBack(oak); assert.equal(w.pile.length, PILE_START);
  const id = w.pile[2].id; assert.equal(w.take({ id }).id, id);
});
test('chop counter: a new log every 2–3 chops, nothing when pile is full', () => {
  const w = new Woodpile({ pile: [], rnd: seq(0.2) });
  assert.equal(w.chop().log, null); const r = w.chop(); assert.ok(r.log); assert.equal(w.pile.length, 1);
  assert.equal(w.chopNeed, 2);
  const w3 = new Woodpile({ pile: [], rnd: seq(0.9) }); w3.chop(); w3.chop(); assert.equal(w3.chopNeed, 3);
  w3.chop(); w3.chop(); assert.equal(w3.pile.length, 1); assert.ok(w3.chop().log, '3rd chop yields');
  const full = new Woodpile({ pile: Array.from({ length: PILE_MAX }, () => makeLog('twigs')) });
  const f = full.chop(); assert.ok(f.full); assert.equal(full.pile.length, PILE_MAX);
});
test('burning: logs progress, sum heat drives intensity, burnt logs become coal', () => {
  const w = new Woodpile({ pile: [] });
  assert.equal(w.intensity(), 0);
  w.addToFire(makeLog('kindling', seq(0.5))); w.addToFire(makeLog('birch_medium', seq(0.5)));
  w.tick(30); w.tick(30); w.tick(30); assert.ok(w.intensity() > 0.2);
  const one = new Woodpile({ pile: [] }); one.addToFire(makeLog('kindling', seq(0.5))); one.tick(30);
  assert.ok(w.heat() > one.heat(), 'more logs, more heat');
  for (let i = 0; i < 400; i++) w.tick(30);
  assert.equal(w.fire.length, 0); assert.ok(w.coal > 0); assert.equal(w.intensity(), 0);
});
test('rain slows burning; douse makes wet char and stops heat', () => {
  const a = new Woodpile({ pile: [] }), b = new Woodpile({ pile: [] });
  a.addToFire(makeLog('birch_medium', seq(0.5))); b.addToFire(makeLog('birch_medium', seq(0.5)), true);
  for (let i = 0; i < 20; i++) { a.tick(10); b.tick(10, true); }
  assert.ok(a.fire[0].p > b.fire[0].p);
  a.douse(); assert.equal(a.heat(), 0); assert.ok(a.fire[0].wet);
  const p = a.fire[0].p; a.tick(100); assert.equal(a.fire[0].p, p);
  a.addToFire(makeLog('kindling')); assert.ok(!a.fire[0].wet, 'relit');
});
test('persistence: pile and fire progress survive reload, offline time burns', () => {
  const s = mem(), w = new Woodpile({ pile: [makeLog('oak_thick'), makeLog('twigs')] });
  w.addToFire(makeLog('oak_thick')); w.tick(60); const p = w.fire[0].p;
  saveWood(w, 1000, s); assert.ok(s.getItem(WOOD_KEY));
  const r = loadWood(s, 1000); assert.equal(r.pile.length, 2); assert.equal(r.fire[0].sprite, 'oak_thick'); assert.ok(Math.abs(r.fire[0].p - p) < 1e-9);
  const later = loadWood(s, 1000 + 600_000); assert.ok(later.fire[0].p > p);
  s.setItem(WOOD_KEY, '{bad'); assert.equal(loadWood(s, 0), null);
  assert.equal(Object.keys(SPRITES).length, 12);
});
