import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs=[]; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:4173/?fresh=1'); await p.waitForTimeout(2500); await p.mouse.click(300,150);
await p.evaluate(() => { const c = window.__campfire, w = c.wood; w.fire.length = 0; const sp = ['birch_medium','oak_medium','pine_medium','birch_thick','oak_split','birch_split','pine_thick','oak_thin','birch_thin','kindling'];
  sp.forEach((s, i) => w.fire.push({ id: 5000 + i, sprite: s, species: s.split('_')[0] === 'kindling' ? 'kindling' : s.split('_')[0], thick: 0.6, moisture: 0.1, p: 0.18 + i * 0.01, wet: false, seed: Math.random() })); c.woodView.sync(true); });
await p.mouse.move(100,100); await p.waitForTimeout(14000);
await p.screenshot({ path: '/workspace/campfire_layers/v8_front.png', clip: { x: 520, y: 380, width: 900, height: 600 } });
console.log(errs); await b.close();
