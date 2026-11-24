// Game-agnostic link check on diagnostics.json: every SERDAT word one Amiga's
// UART transmitted must arrive, unchanged and in order, at the other Amiga's
// serial input (in-flight words at the end of the capture are allowed).
import { readFileSync } from 'node:fs';

const { diag } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let ok = true;
for (const [tx, rx] of [['A', 'B'], ['B', 'A']]) {
  const sent = diag[tx].streams.uartTx;
  const got = diag[rx].streams.emuIn;
  const n = Math.min(sent.length, got.length);
  const mismatch = sent.slice(0, n).findIndex((v, i) => v !== got[i]);
  const ninthBit = sent.filter((w) => w & 0x100).length;
  console.log(`${tx}->${rx}: sent ${sent.length} words (${ninthBit} with bit 8 set), received ${got.length}, in flight ${sent.length - got.length}, first mismatch ${mismatch}`);
  console.log(`   ${tx} first words: ${sent.slice(0, 18).map((w) => w.toString(16).padStart(3, '0')).join(' ')}`);
  if (mismatch !== -1 || !got.length || sent.length - got.length > 64) ok = false;
}
console.log(`input path A=${diag.A.inputPath} B=${diag.B.inputPath}`);
console.log(ok ? 'VERDICT: PASS - word-exact delivery in both directions' : 'VERDICT: FAIL');
process.exit(ok ? 0 : 1);
