// Scripted checks: gentle landing → service; hard landing → crash; free mode landing.
import { chromium } from 'playwright';
const url = 'file://' + new URL('../dist/index.html', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(url); await page.waitForTimeout(800);
const st = () => page.evaluate(() => { const P = __duel.P; return { x: +P.pos.x.toFixed(0), y: +P.pos.y.toFixed(1), spd: +P.speed.toFixed(1), grounded: P.grounded, alive: P.alive, fuel: +P.fuel.toFixed(1), bombs: P.bombs, lives: __duel.S.lives }; });
for (const mode of ['classic', 'free']) {
  await page.evaluate(m => __duel.startGame(m), mode);
  await page.evaluate(() => { const P = __duel.P; P.grounded = false; P.pos.set(-200, 4.5, 0); P.speed = 36; P.thr = 0.15; P.sink = 2; P.fuel = 30; P.bombs = 2; });
  await page.waitForTimeout(1500);
  console.log(mode, 'gentle touchdown', await st());
  await page.evaluate(() => { __duel.P.thr = 0; });
  await page.waitForTimeout(9000);
  console.log(mode, 'after rollout+service', await st());
  await page.screenshot({ path: `shots/${mode}-landed.png` });
  await page.evaluate(() => { const P = __duel.P; P.grounded = false; P.pos.set(-100, 40, 0); P.speed = 70; P.sink = 0; P.thr = 1; P.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)); P.th = -1.0; });
  await page.waitForTimeout(1500);
  console.log(mode, 'steep dive into ground', await st());
}
await browser.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
