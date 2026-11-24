// Startup integration test: real room API/signaling/WebRTC, synthetic local files.
// Intercepts only the emulator launcher and stubs the checksum of a synthetic
// 256 KB firmware fixture. It tests orchestration, not Kickstart authenticity or
// emulator/game compatibility. No ROMs, screenshots or token values are written.
// Start Vite + local-backend.py first. APP_URL/API_URL can override ports.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {launchBrowser,sleep} from './cdp.mjs';
if (!process.argv[2]) throw new Error('Usage: node run-library-autoload.mjs <local-test-tokens.json>');
const tokens=JSON.parse(readFileSync(process.argv[2]));
const app=process.env.APP_URL || 'http://127.0.0.1:4173', api=process.env.API_URL || 'http://127.0.0.1:8000';
const stub=`<!doctype html><canvas width="320" height="256"></canvas><script>window.bootMessages=[];addEventListener('message',e=>{if(e.data&&typeof e.data==='object')bootMessages.push({type:e.data.type,fileName:e.data.fileName,size:e.data.bytes?.length})});</script>`;
const onEvent=(m,call)=>{if(m.method==='Fetch.requestPaused')call('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(stub).toString('base64')}).catch(()=>{});};
const peers=[];
const saveKick=`async function saveKick(){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('oldstylegaming-kickstarts',1);r.onupgradeneeded=()=>r.result.createObjectStore('roms');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('roms','readwrite');tx.objectStore('roms').put({fileName:'synthetic-test-kick.rom',bytes:new Uint8Array(262144)},'amiga-a500-kickstart-clean');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}`;
async function setup(label,withKick,withGame=true){
 const p=await launchBrowser(label,{onEvent});peers.push(p);
 await p.call('Fetch.enable',{patterns:[{urlPattern:app+'/amiga/launcher.html*'}]});
 await p.navigate(app+'/login');
 await p.evaluate(`(async()=>{localStorage.setItem('token',${JSON.stringify(tokens[label])});localStorage.setItem('username',${JSON.stringify(label)});localStorage.setItem('emailVerified','true');const db=await import('/src/localLibraryDb.js');db.registerRuntimeLocalFile('synthetic',new File([new Uint8Array([1,2,3,4])],'Stunt Car Racer.adf'));await db.saveLocalLibraryGames(${withGame?JSON.stringify([{id:'synthetic',runtimeFileKey:'synthetic',title:'Stunt Car Racer',fileName:'Stunt Car Racer.adf',system:'amiga',roomSystem:'amiga'}]):'[]'});const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(algorithm,data)=>algorithm==='SHA-1'&&data.byteLength===262144?Promise.resolve(Uint8Array.from('891e9a547772fe0c6c19b610baf8bc4ea7fcb785'.match(/../g),x=>parseInt(x,16)).buffer):digest(algorithm,data);${saveKick};window.saveSyntheticKick=saveKick;${withKick?'await saveKick();':''}return true})()`);
 return p;
}
async function wait(p,expr,label){for(let i=0;i<120;i++){if(await p.evaluate(expr))return;await sleep(250)}throw new Error(label+': '+await p.evaluate('document.body.innerText.slice(-2500)'));}
try{
 const host=await setup('LinkTestA',true);
 await host.evaluate(`(async()=>{const {launchLibraryGame}=await import('/src/pages/LocalLibraryPage.jsx');await launchLibraryGame({id:'synthetic',runtimeFileKey:'synthetic',title:'Stunt Car Racer',fileName:'Stunt Car Racer.adf',system:'amiga',roomSystem:'amiga'},{linkPlay:true,navigate:path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'))}});return true})()`);
 await wait(host,`Boolean(document.querySelector('iframe[src*="/amiga/launcher.html"]')?.contentWindow.bootMessages?.some(m=>m.type==='amiga_autoload'))`,'host auto boot');
 const code=await host.evaluate("location.pathname.split('/').pop()");
 const available=process.argv.includes('--available');
 const guest=await setup('LinkTestB',available,available);
 await guest.evaluate(`(async()=>{const r=await fetch('${api}/rooms/join',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('token')},body:JSON.stringify({room_code:${JSON.stringify(code)}})});if(!r.ok)throw new Error('join '+r.status);history.pushState({},'','/room/${code}');dispatchEvent(new PopStateEvent('popstate'));return true})()`);
 if(!available){
 await wait(guest,`document.body.innerText.includes('is missing from your library')`,'missing game prompt');
 assert.equal(await guest.evaluate(`document.querySelector('iframe[src*="/amiga/launcher.html"]').contentWindow.bootMessages.some(m=>m.type==='amiga_autoload'||m.type==='amiga_start')`),false);
 await guest.evaluate(`(async()=>{const db=await import('/src/localLibraryDb.js');await db.saveLocalLibraryGames([{id:'synthetic',runtimeFileKey:'synthetic',title:'Stunt Car Racer',fileName:'Stunt Car Racer.adf',system:'amiga',roomSystem:'amiga'}]);[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry library').click();return true})()`);
 console.log('guest missing-game check: prompt shown; emulator not started');
 await wait(guest,`document.body.innerText.includes('A500 Kickstart 1.3 is missing')`,'missing kick prompt');
 let messages=await guest.evaluate(`document.querySelector('iframe[src*="/amiga/launcher.html"]').contentWindow.bootMessages`);
 assert.equal(messages.some(m=>m.type==='amiga_autoload'||m.type==='amiga_start'),false,'must not boot without kick');
 await guest.evaluate(`(async()=>{await window.saveSyntheticKick();[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry library').click();return true})()`);
 }
 await wait(guest,`Boolean(document.querySelector('iframe[src*="/amiga/launcher.html"]')?.contentWindow.bootMessages?.some(m=>m.type==='amiga_autoload'))`,'guest resume');
 for(const [label,p] of [['host',host],['guest',guest]]){
  const msgs=await p.evaluate(`document.querySelector('iframe[src*="/amiga/launcher.html"]').contentWindow.bootMessages`);
  assert(msgs.findIndex(m=>m.type==='amiga_kickstart')<msgs.findIndex(m=>m.type==='amiga_autoload'));
  assert.equal(msgs.filter(m=>m.type==='amiga_kickstart').length,1);
  assert.equal(msgs.filter(m=>m.type==='amiga_autoload').length,1);
  assert.equal(msgs.find(m=>m.type==='amiga_autoload').size,4);
  console.log(label+': own library game loaded automatically, Kickstart injected once before game');
 }
 console.log('PASS: '+(available?'both players launch automatically with their own saved assets':'missing-game and missing-Kickstart prompts, automatic resume')+'; real room signaling/WebRTC, synthetic emulator stub only.');
}catch(e){for(const p of peers)console.log(p.label,p.consoleLines.filter(s=>/EXCEPTION|error/i.test(s)).slice(-8));throw e}finally{peers.forEach(p=>p.close())}
