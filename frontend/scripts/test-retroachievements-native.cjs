// Entirely offline: never sends an unlock or credentials to RetroAchievements.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

test('official rc_client identifies a ROM, evaluates memory, and submits softcore only', async () => {
  const directory = path.resolve(__dirname, '../public/retroachievements');
  const context = vm.createContext({ module: { exports: {} }, exports: {}, require, __dirname: directory,
    __filename: path.join(directory, 'rc-client.js'), process, console, TextDecoder, TextEncoder,
    setTimeout, clearTimeout, performance });
  vm.runInContext(fs.readFileSync(path.join(directory, 'rc-client.js'), 'utf8'), context);
  const ram = new Uint8Array(0x20000);
  const events = [];
  const requests = [];
  let client;
  function respond(callback, userdata, value) {
    const bytes = Buffer.from(JSON.stringify(value));
    const pointer = client._malloc(bytes.length + 1);
    client.HEAPU8.set(bytes, pointer); client.HEAPU8[pointer + bytes.length] = 0;
    client._ra_reply(callback, userdata, 200, pointer, bytes.length);
    client._free(pointer);
  }
  client = await context.module.exports({
    wasmBinary: fs.readFileSync(path.join(directory, 'rc-client.wasm')),
    readMemory: (address, length) => ram.slice(address, address + length),
    onEvent: (event) => events.push(event), print: () => {}, printErr: () => {},
    serverCall: (url, body, callback, userdata) => {
      assert.equal(url, 'https://retroachievements.org/dorequest.php');
      const params = new URLSearchParams(body); requests.push(params);
      const action = params.get('r');
      let response;
      if (action === 'login2') response = { Success: true, User: 'FixtureUser', Token: 'fixture-token', Score: 0, SoftcoreScore: 0 };
      else if (action === 'achievementsets') response = {
        Success: true, GameId: 1234, Title: 'Offline fixture', ConsoleId: 1,
        ImageIconUrl: 'https://example.invalid/icon.png', RichPresenceGameId: 1234, RichPresencePatch: '',
        Sets: [{ AchievementSetId: 1111, GameId: 1234, Title: null, Type: 'core',
          ImageIconUrl: 'https://example.invalid/icon.png', Leaderboards: [], Achievements: [{
            ID: 5501, Title: 'Memory changed', Description: 'Offline test only', Flags: 3, Points: 5,
            MemAddr: '0xH0001=3_0xH0002=7', Author: 'Fixture', BadgeName: '00234', Created: 1367266583, Modified: 1376929305,
          }] }],
      };
      else if (action === 'startsession') response = { Success: true, HardcoreUnlocks: [], Unlocks: [] };
      else if (action === 'awardachievement') response = { Success: true, Score: 0, SoftcoreScore: 5, AchievementID: 5501, AchievementsRemaining: 0 };
      else if (action === 'ping') response = { Success: true };
      else throw new Error(`Unexpected RPC action: ${action}`);
      queueMicrotask(() => respond(callback, userdata, response));
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  client._ra_init();
  client.cwrap('ra_login', null, ['string', 'string'])('FixtureUser', 'fixture-password');
  await settle();
  assert.equal(events.find((event) => event.kind === 'login').result, 0);
  const rom = Buffer.alloc(1024, 0x42);
  const pointer = client._malloc(rom.length); client.HEAPU8.set(rom, pointer);
  assert.equal(client.UTF8ToString(client._ra_hash(pointer, rom.length)), createHash('md5').update(rom).digest('hex'));
  assert.equal(client._ra_load(pointer, rom.length), 1); client._free(pointer);
  await settle(); await settle();
  const game = events.find((event) => event.kind === 'game');
  assert.equal(game?.result, 0); assert.equal(game?.points, 1);
  client._ra_frame();
  assert.equal(requests.filter((params) => params.get('r') === 'awardachievement').length, 0);
  ram[1] = 3; ram[2] = 7;
  client._ra_frame(); await settle();
  assert.equal(events.filter((event) => event.kind === 'unlock').length, 1);
  const awards = requests.filter((params) => params.get('r') === 'awardachievement');
  assert.equal(awards.length, 1); assert.equal(awards[0].get('h'), '0');
  assert.ok(requests.filter((params) => params.has('h')).every((params) => params.get('h') === '0'));
  client._ra_reset(); client._ra_frame(); client._ra_frame(); await settle();
  assert.equal(requests.filter((params) => params.get('r') === 'awardachievement').length, 1);
  client._ra_unload(); client._ra_logout(); client._ra_frame();
  assert.ok(!JSON.stringify(events).includes('fixture-password'));
  assert.ok(!JSON.stringify(events).includes('fixture-token'));
});
