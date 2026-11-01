// Headless-проверка: слабый и полный огонь. Запуск: node tools/shots.mjs http://localhost:4173/
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/workspace/campfire_layers';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
await p.goto(url + '?fuel=40'); await p.waitForTimeout(7000);
console.log('low', JSON.stringify(await p.evaluate(() => window.__campfire.state())));
await p.screenshot({ path: out + '/runtime_low_fire.png' });
await p.goto(url + '?fuel=1800'); await p.waitForTimeout(1500);
for (let i = 0; i < 2; i++) { await p.keyboard.press('Enter'); }
await p.waitForTimeout(9000);
console.log('full', JSON.stringify(await p.evaluate(() => window.__campfire.state())));
await p.screenshot({ path: out + '/runtime_full_fire.png' });
await p.screenshot({ path: out + '/runtime_full_fire_crop.png', clip: { x: 500, y: 450, width: 600, height: 400 } });
console.log('errors:', errs); await b.close();
