import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/', out = '/workspace/campfire_layers';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
for (const lvl of [0.1, 1.0]) {
  await p.goto(url + '?fuel=2400');
  await p.evaluate((l) => { localStorage.clear(); localStorage.setItem('campfire.settings.v1', JSON.stringify({ rain: true, rainLevel: l })); }, lvl);
  await p.reload(); await p.waitForTimeout(1500); await p.mouse.click(700, 300); await p.waitForTimeout(9000);
  console.log(lvl, JSON.stringify(await p.evaluate(() => window.__campfire.state())));
  const tag = lvl === 1 ? '1.0' : String(lvl);
  await p.screenshot({ path: `${out}/v5_rain_${tag}.png` });
  await p.screenshot({ path: `${out}/v5_rain_${tag}_lake.png`, clip: { x: 760, y: 420, width: 1000, height: 360 } });
}
await p.mouse.move(1700, 1000); await p.mouse.move(1705, 1002); await p.waitForTimeout(300);
const hud = await p.locator('#hud').boundingBox();
await p.screenshot({ path: `${out}/v5_ui_rainlevel.png`, clip: { x: hud.x - 20, y: hud.y - 20, width: hud.width + 40, height: hud.height + 40 } });
await p.locator('#rainlvl').focus(); await p.keyboard.press('ArrowLeft');
console.log('after remote ArrowLeft on slider:', await p.evaluate(() => JSON.parse(localStorage.getItem('campfire.settings.v1')).rainLevel));
console.log('errors', errs); await b.close();
