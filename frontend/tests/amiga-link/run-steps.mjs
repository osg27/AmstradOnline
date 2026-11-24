// Boots two-local.html with a game and plays a scripted list of inputs on
// either Amiga, saving screenshots and serial diagnostics.
// Usage: node run-steps.mjs <outDir> <steps.json> [query]
// Step forms: {"wait":ms} {"shot":"name"} {"side":"A","key":"F1","code":"F1"}
//             {"side":"A","joy":16,"ms":150}  (joystick mask: 1 up 2 down 4 left 8 right 16 fire)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, sleep } from './cdp.mjs';

const [outDir, stepsPath, query = 'game=game'] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const page = await launchBrowser('local', { width: 1320, height: 560 });
const counters = [];
try {
  await page.navigate(`http://127.0.0.1:8765/__linktest/two-local.html?${query}`);
  for (const step of steps) {
    if (step.wait) await sleep(step.wait);
    if (step.key) {
      for (const action of ['down', 'up']) {
        await page.evaluate(`linkTest.send('${step.side}', {type:'amiga_keyboard', code:${JSON.stringify(step.code || step.key)}, key:${JSON.stringify(step.key)}, action:'${action}'}); true`);
        await sleep(step.ms || 120);
      }
    }
    if (step.joy !== undefined) {
      await page.evaluate(`linkTest.send('${step.side}', {type:'amstrad_remote_joystick', mask:${step.joy}, player:${step.player || 1}}); true`);
      await sleep(step.ms || 150);
      await page.evaluate(`linkTest.send('${step.side}', {type:'amstrad_remote_joystick', mask:0, player:${step.player || 1}}); true`);
      await sleep(100);
    }
    if (step.mouse) {
      await page.evaluate(`linkTest.send('${step.side}', {type:'amiga_mouse_button', button:${step.mouse}, action:'down'}); true`);
      await sleep(400);
    }
    if (step.shot) {
      writeFileSync(join(outDir, `${step.shot}.png`), await page.screenshot());
      const c = await page.evaluate('JSON.stringify({A: linkTest.diag().A?.counters, B: linkTest.diag().B?.counters})');
      counters.push({ shot: step.shot, ...JSON.parse(c) });
      console.log(step.shot, c);
    }
  }
  writeFileSync(join(outDir, 'diagnostics.json'), JSON.stringify({ query, steps, counters, diag: JSON.parse(await page.evaluate('JSON.stringify(linkTest.diag())')), wire: JSON.parse(await page.evaluate('JSON.stringify(linkTest.wire)')) }, null, 1));
  writeFileSync(join(outDir, 'console.log'), page.consoleLines.join('\n'));
} finally {
  page.close();
}
