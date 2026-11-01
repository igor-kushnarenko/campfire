// Скриншоты дров: поленница, перетаскивание, горение, угли, топор. node tools/woodshots.mjs [url]
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/', out = '/workspace/campfire_layers';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const K = 1920 / (1672 - 36), S = (x, y) => [(x - 18) * K, (y - 18 * 941 / 1672) * K];
const st = () => p.evaluate(() => ({ pile: window.__campfire.wood.pile.length, fire: window.__campfire.wood.fire.map((l) => l.sprite + ':' + l.p.toFixed(2)), I: window.__campfire.wood.intensity().toFixed(2) }));
const area = { x: 560, y: 520, width: 1100, height: 460 };
await p.goto(url + '?fresh=1'); await p.waitForTimeout(2500); await p.mouse.click(400, 200); await p.waitForTimeout(5000);
console.log('start', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v6_pile_full.png', clip: area });
// перетаскивание верхнего полена в костёр
const top = await p.evaluate(() => { const v = window.__campfire.woodView; const e = [...v.meshes.values()].filter((x) => x.place === 'pile').sort((a, b) => b.slot - a.slot)[0]; return [e.x, e.y]; });
let [sx, sy] = S(top[0], top[1]); await p.mouse.move(sx, sy); await p.waitForTimeout(300);
await p.screenshot({ path: out + '/v6_hover.png', clip: area });
console.log('pre-drag', JSON.stringify(await p.evaluate(() => ({ hover: window.__campfire.woodView.hover?.log.sprite }))));
await p.mouse.down();
const [fx, fy] = S(790, 740);
for (let i = 1; i <= 8; i++) { await p.mouse.move(sx + (fx - sx) * i / 10, sy + (fy - sy) * i / 10 - 60 * Math.sin(Math.PI * i / 10)); await p.waitForTimeout(120); }
await p.waitForTimeout(500);
await p.screenshot({ path: out + '/v6_dragging.png', clip: area });
await p.mouse.move(fx, fy); await p.waitForTimeout(600); await p.mouse.up(); await p.waitForTimeout(2500);
console.log('after drop', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v6_fresh_burning.png', clip: area });
// кнопка «Подбросить дрова» дважды
for (let i = 0; i < 2; i++) { await p.mouse.move(1700, 1000); await p.mouse.move(1705, 1003); await p.waitForTimeout(200); await p.click('#add'); await p.waitForTimeout(2500); }
console.log('after buttons', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v6_full_scene.png' });
// топор: три удара
const [ax, ay] = S(1460, 700);
for (let i = 0; i < 3; i++) { await p.mouse.click(ax, ay); await p.waitForTimeout(700); if (i === 1) await p.screenshot({ path: out + '/v6_chop_swing.png', clip: { x: 1250, y: 520, width: 650, height: 450 } }); await p.waitForTimeout(4500); }
console.log('after chops', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v6_after_chop.png', clip: area });
// наполовину обугленные и угли
for (const [prog, name] of [[0.5, 'half_charred'], [0.92, 'coals']]) {
  await p.goto(url + `?fresh=1&prog=${prog}`); await p.waitForTimeout(2000);
  await p.evaluate(() => { const w = window.__campfire.wood; w.fire.length = 0; for (const s of ['oak_thick', 'birch_medium', 'pine_medium', 'oak_split', 'birch_thick']) { const l = { id: 900 + Math.random() * 1e6 | 0, sprite: s, species: s.split('_')[0], thick: 0.8, moisture: 0.1, p: 0, wet: false, seed: Math.random() }; w.fire.push(l); } window.__campfire.woodView.sync(true); });
  await p.evaluate((pr) => { for (const l of window.__campfire.wood.fire) l.p = pr; }, prog);
  await p.waitForTimeout(6000);
  console.log(name, JSON.stringify(await st()));
  await p.screenshot({ path: out + `/v6_${name}.png`, clip: { x: 640, y: 640, width: 620, height: 320 } });
}
console.log('errors:', errs); await b.close();
