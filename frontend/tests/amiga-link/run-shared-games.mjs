// Real shared catalogue/API/room/WebRTC integration with synthetic disks and a stub emulator.
// Usage: APP_URL=... API_URL=... node run-shared-games.mjs <local-test-tokens.json>
// Local backend tester A must have admin role; B must be a regular player.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser, sleep } from './cdp.mjs';
const tokens = JSON.parse(readFileSync(process.argv[2]));
const app = process.env.APP_URL || 'http://127.0.0.1:4173';
const api = process.env.API_URL || 'http://127.0.0.1:8000';
const peers = [];
const noHandshake = process.argv.includes('--no-serial-handshake');
const stub = `<!doctype html><canvas width="320" height="256"></canvas><script>window.bootMessages=[];addEventListener('message',e=>{if(e.data&&typeof e.data==='object')bootMessages.push({type:e.data.type,fileName:e.data.fileName,size:e.data.bytes?.length})});</script>`;
const onEvent = (event, call) => {
  if (event.method === 'Fetch.requestPaused') call('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(stub).toString('base64') }).catch(() => {});
};
async function wait(peer, expression, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await peer.evaluate(expression)) return;
    await sleep(250);
  }
  throw new Error(label + ': ' + await peer.evaluate('document.body.innerText.slice(-2500)'));
}
async function setup(label, admin) {
  const peer = await launchBrowser(label, { onEvent }); peers.push(peer);
  await peer.call('Fetch.enable', { patterns: [{ urlPattern: app + '/amiga/launcher.html*' }] });
  await peer.navigate(app + '/login');
  if (!admin && noHandshake) {
    await peer.evaluate(`(()=>{const Original=window.RTCPeerConnection;window.RTCPeerConnection=class extends Original {setRemoteDescription(){return new Promise(()=>{})}};return true})()`);
  }
  await peer.evaluate(`(async()=>{
    localStorage.setItem('token', ${JSON.stringify(tokens[label])});
    localStorage.setItem('username', ${JSON.stringify(label)});
    localStorage.setItem('isAdmin', ${JSON.stringify(String(admin))});
    localStorage.setItem('isTester','false'); localStorage.setItem('emailVerified','true');
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest=(algorithm,data)=>algorithm==='SHA-1'&&data.byteLength===262144
      ?Promise.resolve(Uint8Array.from('891e9a547772fe0c6c19b610baf8bc4ea7fcb785'.match(/../g),x=>parseInt(x,16)).buffer):digest(algorithm,data);
    const db=await new Promise((resolve)=>{const r=indexedDB.open('oldstylegaming-kickstarts',1);r.onupgradeneeded=()=>r.result.createObjectStore('roms');r.onsuccess=()=>resolve(r.result)});
    await new Promise(resolve=>{const tx=db.transaction('roms','readwrite');tx.objectStore('roms').put({fileName:'synthetic-kick.rom',bytes:new Uint8Array(262144)},'amiga-a500-kickstart-clean');tx.oncomplete=resolve});db.close();
    history.pushState({},'','/link-games');dispatchEvent(new PopStateEvent('popstate'));return true;
  })()`);
  await wait(peer, `document.querySelector('.osg-link-games') && !document.body.innerText.includes('Loading Link Games...')`, 'catalogue loads');
  return peer;
}
try {
  const host = await setup('LinkTestA', true);
  await host.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload ADF').click();true`);
  await wait(host, `Boolean(document.querySelector('.osg-link-upload'))`, 'upload form');
  await host.evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(901120)],'Stunt Car Racer.adf'));const input=document.querySelector('.osg-link-upload input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await wait(host, `!document.querySelector('.osg-link-upload button[type=submit]').disabled`, 'upload ready');
  await host.evaluate(`document.querySelector('.osg-link-upload button[type=submit]').click();true`);
  await wait(host, `Boolean(document.querySelector('.osg-link-game-card')) && !document.querySelector('.osg-link-upload')`, 'published shared game');
  if (process.env.SHOT_PATH) writeFileSync(process.env.SHOT_PATH, await host.screenshot());
  await host.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await host.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile layout must fit');
  await host.call('Emulation.clearDeviceMetricsOverride');
  const guest = await setup('LinkTestB', false);
  assert.equal(await guest.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Upload ADF')`), false);
  assert.equal(await guest.evaluate(`[...document.querySelectorAll('h2')].some(h=>h.textContent==='Stunt Car Racer')`), true);
  const forbidden = await guest.evaluate(`fetch('${api}/auth/link-games',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('token')},body:new FormData()}).then(r=>r.status)`);
  assert.equal(forbidden, 403, 'regular users cannot upload');
  await host.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Host Link Play').click();true`);
  const frame = `document.querySelector('iframe[src*="/amiga/launcher.html"]')`;
  await wait(host, `${frame}?.contentWindow.bootMessages?.some(m=>m.type==='amiga_autoload')`, 'host shared game auto boot');
  const code = await host.evaluate(`location.pathname.split('/').pop()`);
  const selectedId = await host.evaluate(`new URLSearchParams(location.search).get('linkGame')`);
  const roomGameId = await guest.evaluate(`fetch('${api}/rooms/${code}',{headers:{Authorization:'Bearer '+localStorage.getItem('token')}}).then(r=>r.json()).then(r=>r.shared_link_game_id)`);
  assert.equal(roomGameId, selectedId, 'room API must identify the shared disk without the host URL');
  await guest.evaluate(`(async()=>{const r=await fetch('${api}/rooms/join',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('token')},body:JSON.stringify({room_code:${JSON.stringify(code)}})});if(!r.ok)throw new Error('join '+r.status);history.pushState({},'','/room/${code}');dispatchEvent(new PopStateEvent('popstate'));return true})()`);
  await wait(guest, `${frame}?.contentWindow.bootMessages?.some(m=>m.type==='amiga_autoload')`, 'guest shared game auto boot without local library');
  if (!noHandshake) await wait(guest, `window.__amigaLinkDiagnostics?.().channel === 'open'`, 'serial channel connected after shared game boot');
  assert.equal(await guest.evaluate(`document.body.innerText.includes('Choose matching game file')`), false);
  if (noHandshake) assert.notEqual(await guest.evaluate(`window.__amigaLinkDiagnostics?.().channel`), 'open');
  for (const peer of [host, guest]) {
    const messages = await peer.evaluate(`${frame}.contentWindow.bootMessages`);
    assert.equal(messages.filter(m=>m.type==='amiga_autoload').length, 1);
    assert.equal(messages.find(m=>m.type==='amiga_autoload').size, 901120);
    assert(messages.findIndex(m=>m.type==='amiga_kickstart') < messages.findIndex(m=>m.type==='amiga_autoload'));
  }
  if (noHandshake) {
    // Reload loses all runtime refs and has no linkGame query string. Only the
    // room API and this browser's saved synthetic Kickstart remain available.
    await guest.call('Page.addScriptToEvaluateOnNewDocument', { source: `
      const digest=crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest=(algorithm,data)=>algorithm==='SHA-1'&&data.byteLength===262144
        ?Promise.resolve(Uint8Array.from('891e9a547772fe0c6c19b610baf8bc4ea7fcb785'.match(/../g),x=>parseInt(x,16)).buffer):digest(algorithm,data);
      const Original=window.RTCPeerConnection;
      window.RTCPeerConnection=class extends Original {setRemoteDescription(){return new Promise(()=>{})}};
    ` });
    await guest.navigate(`${app}/room/${code}`);
    await wait(guest, `${frame}?.contentWindow.bootMessages?.some(m=>m.type==='amiga_autoload')`, 'guest reload without host metadata');
    assert.equal(await guest.evaluate(`document.body.innerText.includes('Choose matching game file')`), false);
  }
  await host.evaluate(`document.querySelector('.osg-back').click();true`);
  await wait(host, `location.pathname === '/link-games'`, 'return to shared catalogue');
  console.log('PASS: shared ADF loads for both players from room metadata; no local game/file prompt'+(noHandshake?' even with serial handshake blocked':'')+'; upload permissions, mobile layout and return navigation pass; stub emulator only.');
} finally { peers.forEach(peer=>peer.close()); }
