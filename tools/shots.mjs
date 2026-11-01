// Headless-проверка: слабый и полный огонь. Запуск: node tools/shots.mjs http://localhost:4173/
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/workspace/campfire_layers';
const tag = process.argv[4] || '';
const q = process.argv[5] ? '&' + process.argv[5] : '';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
await p.goto(url + '?fuel=40' + q); await p.waitForTimeout(7000);
console.log('low', JSON.stringify(await p.evaluate(() => window.__campfire.state())));
await p.screenshot({ path: out + '/runtime_low_fire' + tag + '.png' });
await p.screenshot({ path: out + '/crop_left' + tag + '.png', clip: { x: 0, y: 150, width: 800, height: 500 } });
await p.goto(url + '?fuel=1800' + q); await p.waitForTimeout(1500);
for (let i = 0; i < 2; i++) { await p.keyboard.press('Enter'); }
await p.waitForTimeout(9000);
console.log('full', JSON.stringify(await p.evaluate(() => window.__campfire.state())));
await p.screenshot({ path: out + '/runtime_full_fire' + tag + '.png' });
await p.screenshot({ path: out + '/runtime_full_fire_crop' + tag + '.png', clip: { x: 600, y: 520, width: 800, height: 500 } });
console.log('errors:', errs); await b.close();
