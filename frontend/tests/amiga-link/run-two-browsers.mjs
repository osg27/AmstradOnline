// Two separate Chrome processes (separate profiles) join one local amiga_link
// room through the real RoomPage, signaling WebSocket and WebRTC DataChannel.
// Usage: node run-two-browsers.mjs <outDir> <tokens.json> <roomCode> [seconds] [pingpong|game]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, sleep } from './cdp.mjs';

const [outDir, tokensPath, roomCode, secondsArg, disk = 'pingpong', stepsPath] = process.argv.slice(2);
const steps = stepsPath ? JSON.parse(readFileSync(stepsPath, 'utf8')) : [];
const seconds = Number(secondsArg || 40);
const app = process.env.APP_URL || 'http://127.0.0.1:4173';
const api = process.env.API_URL || 'http://127.0.0.1:8000';
const files = process.env.FILES_URL || 'http://127.0.0.1:8765/__linktest';
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
const users = { A: 'LinkTestA', B: 'LinkTestB' };
const frameExpr = `document.querySelector('iframe[src*="/amiga/launcher.html"]')`;
mkdirSync(outDir, { recursive: true });

const peers = [await launchBrowser('A'), await launchBrowser('B')];
try {
  for (const peer of peers) {
    await peer.navigate(`${app}/`);
    await peer.evaluate(`localStorage.setItem('token', ${JSON.stringify(tokens[users[peer.label]])}); true`);
    if (peer.label === 'B') {
      const joined = await peer.evaluate(`fetch('${api}/rooms/join', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + localStorage.getItem('token')}, body: JSON.stringify({room_code:${JSON.stringify(roomCode)}})}).then(r => r.status)`);
      console.log('B join status', joined);
    }
    await peer.navigate(`${app}/room/${roomCode}`);
  }
  await sleep(4000);

  for (const peer of peers) {
    console.log(peer.label, 'launcher iframe present:', await peer.evaluate(`Boolean(${frameExpr})`));
    // The room UI normally reads the Kickstart from IndexedDB; hand it to the launcher directly.
    await peer.evaluate(`fetch('${files}/kick.rom').then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) ${frameExpr}.contentWindow.postMessage({type:'amiga_kickstart', bytes:new Uint8Array(b)}, location.origin); return Boolean(b); })`);
    const clicked = await peer.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Start local Amiga/i.test(x.textContent)); if (!b) return 'NOT FOUND: ' + [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 40).join(' | '); b.click(); return 'clicked'; })()`);
    console.log(peer.label, 'start button:', clicked);
  }
  await sleep(5000);

  const name = disk === 'pingpong' ? 'serial-pingpong.adf' : 'game.adf';
  for (const peer of peers) {
    await peer.evaluate(`fetch('${files}/${name}').then(r => r.arrayBuffer()).then(b => { ${frameExpr}.contentWindow.postMessage({type:'amiga_autoload', fileName:'${name}', bytes:new Uint8Array(b)}, location.origin); return b.byteLength; })`);
  }

  // Optional scripted input (same step format as run-steps.mjs), sent to each
  // peer's launcher exactly as the room page forwards local input.
  const byLabel = Object.fromEntries(peers.map((p) => [p.label, p]));
  const post = (side, msg) => byLabel[side].evaluate(`${frameExpr}.contentWindow.postMessage(${JSON.stringify(msg)}, location.origin); true`);
  for (const step of steps) {
    if (step.wait) await sleep(step.wait);
    if (step.key) for (const action of ['down', 'up']) { await post(step.side, { type: 'amiga_keyboard', code: step.code || step.key, key: step.key, action }); await sleep(step.ms || 120); }
    if (step.joy !== undefined) { await post(step.side, { type: 'amstrad_remote_joystick', mask: step.joy, player: step.player || 1 }); await sleep(step.ms || 150); await post(step.side, { type: 'amstrad_remote_joystick', mask: 0, player: step.player || 1 }); }
    if (step.mouse) { await post(step.side, { type: 'amiga_mouse_button', button: step.mouse, action: 'down' }); await sleep(400); }
    if (step.shot) for (const peer of peers) writeFileSync(join(outDir, `${peer.label}-${step.shot}.png`), await peer.screenshot());
  }

  const samples = [];
  for (let s = 0; s < seconds; s += 5) {
    await sleep(5000);
    const row = { t: s + 5 };
    for (const peer of peers) {
      row[peer.label] = await peer.evaluate(`(() => { const d = window.__amigaLinkDiagnostics?.(); return d ? { channel: d.channel, room: d.room, launcher: d.launcher?.counters } : null; })()`);
    }
    samples.push(row);
    console.log(JSON.stringify(row));
    if ((s + 5) % 20 === 0 || s + 5 >= seconds) {
      for (const peer of peers) writeFileSync(join(outDir, `${peer.label}-${s + 5}s.png`), await peer.screenshot());
    }
  }

  const full = {};
  for (const peer of peers) full[peer.label] = await peer.evaluate('window.__amigaLinkDiagnostics?.() || null');
  const pageText = {};
  for (const peer of peers) pageText[peer.label] = await peer.evaluate('document.body.innerText.slice(0, 4000)');
  writeFileSync(join(outDir, 'diagnostics.json'), JSON.stringify({
    roomCode,
    samples,
    diag: { A: full.A?.launcher, B: full.B?.launcher },
    room: { A: { ...full.A, launcher: undefined }, B: { ...full.B, launcher: undefined } },
    pageText,
  }, null, 1));
  writeFileSync(join(outDir, 'console.log'), peers.flatMap((p) => p.consoleLines).join('\n'));
} finally {
  peers.forEach((p) => p.close());
}
