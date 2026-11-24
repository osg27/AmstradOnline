// Drives two-local.html in a fresh Chrome profile via the DevTools protocol and
// writes serial diagnostics, a verdict and screenshots to an output folder.
// Usage: node run-two-local.mjs <outDir> [seconds] [query]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outDir = process.argv[2] || 'out';
const seconds = Number(process.argv[3] || 30);
const query = process.argv[4] || 'game=pingpong';
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9400 + Math.floor(Math.random() * 400);
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'amiga-link-'));
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1300,560', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) { await sleep(200); targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const consoleLines = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION ' + m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
};
await new Promise((r) => (ws.onopen = r));
const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
await call('Runtime.enable'); await call('Page.enable');
await call('Page.navigate', { url: `http://127.0.0.1:8765/__linktest/two-local.html?${query}` });
const samples = [];
for (let s = 0; s < seconds; s += 5) {
  await sleep(5000);
  const d = await evaluate('JSON.stringify({A: linkTest.diag().A?.counters, B: linkTest.diag().B?.counters, hooked: [linkTest.diag().A?.hooked, linkTest.diag().B?.hooked]})');
  samples.push({ t: s + 5, ...JSON.parse(d) });
  console.log(`t=${s + 5}s`, d);
  if ((s + 5) % 15 === 0 || s + 5 >= seconds) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `screen-${s + 5}s.png`), Buffer.from(shot.data, 'base64'));
  }
}
const diag = JSON.parse(await evaluate('JSON.stringify(linkTest.diag())'));
const wire = JSON.parse(await evaluate('JSON.stringify(linkTest.wire)'));
writeFileSync(join(outDir, 'diagnostics.json'), JSON.stringify({ query, samples, diag, wire }, null, 1));
writeFileSync(join(outDir, 'console.log'), consoleLines.join('\n'));
ws.close(); proc.kill();
