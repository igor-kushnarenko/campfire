import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs=[]; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?fresh=1'); await p.waitForTimeout(3000);
const pt = await p.evaluate(() => { const v = window.__campfire.woodView, r = v.canvas.getBoundingClientRect();
  const f = (x, y) => [r.left + (x - v.crop.x) / (v.W - 2 * v.crop.x) * r.width, r.top + (y - v.crop.y) / (v.H - 2 * v.crop.y) * r.height]; return { btn: f(218, 810), knob: f(320, 830) }; });
await p.mouse.click(...pt.btn);
const log = async (l) => console.log(l, JSON.stringify(await p.evaluate(() => { const s = window.__campfire.state().tuner; return { ...s, mix: +s.mix.toFixed(2), noise: window.__campfire.audio.radioNoise?.toFixed(2), station: document.getElementById('station').textContent }; })));
for (let i = 0; i < 6; i++) { await p.waitForTimeout(2500); await log('t' + i); }
await p.mouse.move(...pt.knob); await p.mouse.wheel(0, 120); await p.waitForTimeout(300); await log('turn');
for (let i = 0; i < 6; i++) { await p.waitForTimeout(2500); await log('u' + i); }
await p.mouse.move(1700, 1000); await p.mouse.move(1710, 1005); await p.waitForTimeout(600);
await p.screenshot({ path: '/workspace/campfire_layers/r_tuner_menu.png', clip: { x: 1300, y: 700, width: 620, height: 380 } });
console.log(errs); await b.close();
