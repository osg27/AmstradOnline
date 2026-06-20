import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('frontend/public');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.img': 'application/octet-stream', '.css': 'text/css' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(4189, '127.0.0.1', resolve));

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=9230', `--user-data-dir=${path.resolve('.tmp-atarist-cdp-profile-3')}`,
  'http://127.0.0.1:4189/atarist/smoke.html',
], { stdio: 'ignore' });

await new Promise((resolve) => setTimeout(resolve, 2500));
const tabs = await fetch('http://127.0.0.1:9230/json').then((response) => response.json());
const tab = tabs.find((entry) => entry.type === 'page');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const browserLog = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, { resolve, reject });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.consoleAPICalled') {
    browserLog.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    browserLog.push(`EXCEPTION: ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description || ''}`);
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
};
await new Promise((resolve) => { socket.onopen = resolve; });
await send('Runtime.enable');
await new Promise((resolve) => setTimeout(resolve, 20000));
const result = await send('Runtime.evaluate', {
  expression: `(() => {
    const doc = document.getElementById('st').contentDocument;
    const canvas = doc.getElementById('atarist-screen');
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    let coloured = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] || data[i + 1] || data[i + 2]) coloured++;
    return {
      coloured, width: canvas.width, height: canvas.height,
      gameCanvas: Boolean(doc.querySelector('#game canvas')),
      gameText: doc.getElementById('game').innerText,
      emulator: Boolean(doc.defaultView.EJS_emulator),
      started: Boolean(doc.defaultView.EJS_emulator?.started),
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(result.result.value));
console.log(browserLog.join('\n'));
socket.close();
chrome.kill();
server.close();
