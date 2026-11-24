// Minimal Chrome DevTools Protocol helper shared by the Amiga Link test drivers.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchBrowser(label, { width = 1400, height = 1000, onEvent } = {}) {
  const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const port = 9400 + Math.floor(Math.random() * 500);
  // A fresh profile per browser: no shared storage, cookies or IndexedDB.
  const profile = mkdtempSync(join(tmpdir(), `amiga-link-${label}-`));
  const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new',
    '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`, '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60 && !targets; i++) {
    await sleep(250);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(`[${label}] ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`[${label}] EXCEPTION ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method && onEvent) onEvent(m, call);
  };
  await new Promise((r) => { ws.onopen = r; });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const navigate = async (url) => { await call('Page.navigate', { url }); await sleep(1500); };
  const screenshot = async () => Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  const close = () => { try { ws.close(); } catch { /* already closed */ } proc.kill(); };
  return { label, call, evaluate, navigate, screenshot, close, consoleLines };
}
