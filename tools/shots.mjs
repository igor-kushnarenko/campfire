// Headless-проверка: два кадра сцены. Запуск: node tools/shots.mjs http://localhost:4173/
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/workspace/campfire_layers';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(url + '?speed=1'); await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(4000);
await p.screenshot({ path: out + '/runtime_1_start.png' });
for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); }
await p.waitForTimeout(9000);
console.log(JSON.stringify(await p.evaluate(() => window.__campfire.state())));
await p.screenshot({ path: out + '/runtime_2_after_logs.png' });
console.log('errors:', errs); await b.close();
