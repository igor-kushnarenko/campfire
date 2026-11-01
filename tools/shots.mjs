// Headless-проверка сцены. Запуск: node tools/shots.mjs http://localhost:4173/ [outdir]
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/workspace/campfire_layers';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
p.on('response', (r) => r.status() >= 400 && errs.push(r.status() + ' ' + r.url()));
const st = () => p.evaluate(() => window.__campfire.state());
await p.goto(url + '?fuel=2400'); await p.waitForTimeout(2000);
await p.mouse.click(960, 300); // клик по сцене: звук включается, дрова НЕ добавляются
const s1 = await st(); console.log('after scene click', JSON.stringify(s1));
await p.waitForTimeout(14000);
console.log('full', JSON.stringify(await st()));
await p.mouse.move(960, 1000); await p.waitForTimeout(300);
await p.screenshot({ path: out + '/v3_full_scene.png' });
const hud = await p.locator('#hud').boundingBox();
await p.screenshot({ path: out + '/v3_ui_closeup.png', clip: { x: hud.x - 30, y: hud.y - 30, width: hud.width + 60, height: hud.height + 60 } });
await p.screenshot({ path: out + '/v3_fire_closeup.png', clip: { x: 610, y: 480, width: 700, height: 440 } });
await p.screenshot({ path: out + '/v3_left_edge.png', clip: { x: 0, y: 0, width: 400, height: 1080 } });
await p.mouse.move(900, 1000); await p.waitForTimeout(400); await p.click('#douse'); await p.waitForTimeout(1500);
console.log('douse+1.5s', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v3_extinguish_1s.png', clip: { x: 460, y: 200, width: 1000, height: 720 } });
await p.waitForTimeout(16000);
console.log('douse+17s', JSON.stringify(await st()));
await p.screenshot({ path: out + '/v3_after_extinguish.png' });
await p.setViewportSize({ width: 1280, height: 1024 }); await p.waitForTimeout(1500);
await p.screenshot({ path: out + '/v3_viewport_5x4.png' });
console.log('errors:', errs); await b.close();
