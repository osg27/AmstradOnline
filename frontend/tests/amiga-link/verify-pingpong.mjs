// Checks the ping-pong proof in diagnostics.json:
//  1. every byte A's Amiga transmitted reached B's emulator input unchanged, and vice versa;
//  2. each side's UART output (excluding $00 kick-offs) equals, in order, the bytes
//     its emulator input received plus one, i.e. the Amiga CPU read them.
import { readFileSync } from 'node:fs';
const { diag } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Streams hold SERDAT words; the test program uses 8 data bits + stop bit.
const stream = (side, stage) => diag[side].streams[stage];
const data = (side, stage) => stream(side, stage).map((w) => w & 0xff);
let ok = true;
for (const [tx, rx] of [['A', 'B'], ['B', 'A']]) {
  const sent = stream(tx, 'uartTx'); const got = stream(rx, 'emuIn');
  const n = Math.min(sent.length, got.length);
  const mismatch = sent.slice(0, n).findIndex((v, i) => v !== got[i]);
  console.log(`${tx}->${rx}: ${tx} UART sent ${sent.length}, ${rx} emulator input got ${got.length}, first mismatch: ${mismatch}`);
  if (mismatch !== -1 || got.length === 0) ok = false;
}
for (const side of ['A', 'B']) {
  const rx = data(side, 'emuIn'); const tx = data(side, 'uartTx').filter((v) => v !== 0);
  const expected = rx.map((v) => (v + 1) & 255).filter((v) => v !== 0);
  const n = Math.min(tx.length, expected.length);
  const mismatch = tx.slice(0, n).findIndex((v, i) => v !== expected[i]);
  console.log(`${side}: received ${rx.length}, replied ${tx.length} non-kickoff bytes; reply==received+1 for first ${n}: ${mismatch === -1 ? 'yes' : 'NO at ' + mismatch}`);
  console.log(`   ${side} rx sample: ${rx.slice(0, 16).map((v) => v.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`   ${side} tx sample: ${data(side, 'uartTx').slice(0, 16).map((v) => v.toString(16).padStart(2, '0')).join(' ')}`);
  if (mismatch !== -1 || n === 0) ok = false;
}
console.log(ok ? 'VERDICT: PASS - bidirectional serial data reached and was processed by both emulated Amigas' : 'VERDICT: FAIL');
process.exit(ok ? 0 : 1);
