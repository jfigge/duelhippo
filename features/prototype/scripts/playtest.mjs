// Headless playtest: loads dist/index.html, flies a short scripted sortie, screenshots, reports errors.
import { chromium } from 'playwright';
const url = 'file://' + new URL('../dist/index.html', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
async function run(modeName, w, h, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(modeName + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(modeName + ' console: ' + m.text()); });
  await page.goto(url); await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/${modeName}-title.png` });
  await page.click(`[data-start=${modeName.split('-')[0]}]`);
  await page.waitForTimeout(300);
  const st = () => page.evaluate(() => { const d = window.__duel, P = d.P; return { state: d.state, x: +P.pos.x.toFixed(1), y: +P.pos.y.toFixed(1), z: +P.pos.z.toFixed(1), spd: +P.speed.toFixed(1), thr: +P.thr.toFixed(2), grounded: P.grounded, alive: P.alive, fuel: +P.fuel.toFixed(1), lives: d.S.lives, enemies: d.enemies.filter(e => e.alive).length }; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1600); await page.keyboard.up('KeyW');
  await page.waitForTimeout(3500);
  console.log(modeName, 'rolling', await st());
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(900); await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(2500);
  console.log(modeName, 'airborne', await st());
  await page.keyboard.down('Space'); await page.keyboard.press('KeyB'); await page.waitForTimeout(600); await page.keyboard.up('Space');
  await page.screenshot({ path: `shots/${modeName}-flying.png` });
  await page.waitForTimeout(6000);
  console.log(modeName, 'later', await st());
  await page.screenshot({ path: `shots/${modeName}-later.png` });
  await ctx.close();
}
await run('classic', 1280, 760, false);
await run('free', 1280, 760, false);
await run('classic-phone', 844, 390, true);
await browser.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
