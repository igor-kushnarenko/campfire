import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs=[]; p.on('pageerror', e => errs.push(String(e)));
const o='/workspace/campfire_layers', clip = { x: 1300, y: 700, width: 620, height: 380 };
await p.goto('http://localhost:4173/?fresh=1'); await p.waitForTimeout(3000);
const r = await p.evaluate(() => { const b = document.getElementById('menubtn').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
await p.mouse.move(900, 300); await p.mouse.move(905, 300); await p.waitForTimeout(800); await p.screenshot({ path: o + '/m_closed.png', clip });
await p.mouse.move(...r); await p.waitForTimeout(800); await p.screenshot({ path: o + '/m_open.png', clip });
const st = async () => p.evaluate(() => document.getElementById('hud').classList.contains('closed'));
console.log('open closed?', await st());
await p.mouse.move(1500, 960); await p.waitForTimeout(500); // внутри меню
await p.mouse.move(900, 300); await p.waitForTimeout(3000); console.log('3s closed?', await st());
await p.mouse.move(905, 305); await p.waitForTimeout(2600); console.log('5.6s closed?', await st());
// радио: путь через WebAudio
const pt = await p.evaluate(() => { const v = window.__campfire.woodView, r = v.canvas.getBoundingClientRect(); return [r.left + (218 - v.crop.x) / (v.W - 2 * v.crop.x) * r.width, r.top + (810 - v.crop.y) / (v.H - 2 * v.crop.y) * r.height]; });
await p.mouse.click(...pt); await p.waitForTimeout(9000);
console.log(JSON.stringify(await p.evaluate(() => { const t = window.__campfire.state().tuner, a = window.__campfire; return { ...t, path: a.tuner?.el === a.tuner?.cors ? 'cors' : 'plain' }; })));
console.log(errs); await b.close();
