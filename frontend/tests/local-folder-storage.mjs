import assert from 'node:assert/strict';
import { launchBrowser } from './amiga-link/cdp.mjs';

const browser = await launchBrowser('local-folder-storage');
try {
  await browser.navigate(process.env.TEST_URL || 'http://127.0.0.1:4198');
  const result = await browser.evaluate(`(async () => {
    const library = await import('/src/localLibraryDb.js');
    const a = { id: 'a', name: 'First folder' };
    const b = { id: 'b', name: 'Second folder' };
    const rows = Array.from({ length: 10000 }, (_, i) => ({ id: 'b:' + i, folderId: 'b' }));
    await library.updateLocalLibraryFolder('b', b, rows);
    await library.updateLocalLibraryFolder('a', a, [{ id: 'a:1', folderId: 'a' }]);
    await library.updateLocalLibraryFolder('a', a, [{ id: 'a:2', folderId: 'a' }]);
    const rescanned = await library.getLocalLibraryGames();
    let rejected = false;
    try {
      await library.updateLocalLibraryFolder('a', { ...a, name: 'Invalid update' }, [{ id: 'bad', folderId: 'a', invalid: () => {} }]);
    } catch { rejected = true; }
    const rolledBack = await library.getLocalLibraryFolder('a');
    const retained = await library.getLocalLibraryGame('a:2');
    await library.updateLocalLibraryFolder('a', null, [], ['b:1']);
    await library.patchLocalLibraryGames(new Map([['a:2', { boxArtUrl: 'late' }]]));
    return {
      rescanCount: rescanned.length,
      oldRow: rescanned.some(row => row.id === 'a:1'),
      rejected, rolledBack: rolledBack.name, retained: retained.id,
      folders: (await library.getLocalLibraryFolders()).map(row => row.id),
      count: (await library.getLocalLibraryGames()).length,
      favourites: await library.getLocalLibrarySetting('favourites'),
    };
  })()`);
  assert.deepEqual(result, {
    rescanCount: 10001, oldRow: false, rejected: true,
    rolledBack: 'First folder', retained: 'a:2', folders: ['b'],
    count: 10000, favourites: ['b:1'],
  });
  await browser.navigate(process.env.TEST_URL || 'http://127.0.0.1:4198');
  assert.equal(await browser.evaluate(`(async () => (await (await import('/src/localLibraryDb.js')).getLocalLibraryGames()).length)()`), 10000);
  console.log('PASS: link, rescan, atomic rollback, unlink, late artwork and reload with 10,000 unrelated games');
} finally {
  browser.close();
}
