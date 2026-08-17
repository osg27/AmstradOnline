const DB_NAME = 'oldstylegaming-local-library';
const DB_VERSION = 1;
const FOLDERS_STORE = 'folders';
const GAMES_STORE = 'games';
const SETTINGS_STORE = 'settings';
const VIP_GAMES_KEY = 'vip-library-snapshot-v1';
const runtimeLocalFiles = new Map();

export function registerRuntimeLocalFile(key, file) {
  if (key && file) runtimeLocalFiles.set(key, file);
}

export async function readLocalLibraryFile(entry) {
  if (entry?.handle?.getFile) return entry.handle.getFile();
  const file = runtimeLocalFiles.get(entry?.runtimeFileKey);
  if (file) return file;
  throw new Error('This browser needs you to select the ROM folder again before playing.');
}

function isVipLibraryGame(game) {
  return game?.source === 'internet-archive-mame' || String(game?.source || '').startsWith('vip-');
}

function openLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
        db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(GAMES_STORE)) {
        const games = db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
        games.createIndex('system', 'system', { unique: false });
        games.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runStore(storeName, mode, callback) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = callback(store);

    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLocalLibraryFolder(folder) {
  await runStore(FOLDERS_STORE, 'readwrite', (store) => {
    store.put(folder);
  });
}

export async function saveLocalLibraryFolders(folders) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FOLDERS_STORE, 'readwrite');
    const store = transaction.objectStore(FOLDERS_STORE);
    store.clear();
    folders.forEach((folder) => store.put(folder));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getLocalLibraryFolders() {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FOLDERS_STORE, 'readonly');
    const store = transaction.objectStore(FOLDERS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getLocalLibraryFolder(id) {
  const db = await openLibraryDb();
  try {
    const transaction = db.transaction(FOLDERS_STORE, 'readonly');
    return await requestToPromise(transaction.objectStore(FOLDERS_STORE).get(id));
  } finally {
    db.close();
  }
}

export async function saveLocalLibraryGames(games) {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([GAMES_STORE, SETTINGS_STORE], 'readwrite');
    const store = transaction.objectStore(GAMES_STORE);
    const settings = transaction.objectStore(SETTINGS_STORE);
    const localGames = games.filter((game) => !isVipLibraryGame(game));
    const vipGames = games.filter(isVipLibraryGame);
    store.clear();
    localGames.forEach((game) => store.put(game));
    // Immutable VIP catalogues are one structured-clone record rather than thousands
    // of IndexedDB rows. This makes subsequent library starts dramatically cheaper.
    if (vipGames.length) settings.put({ key: VIP_GAMES_KEY, value: vipGames });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function migrateLegacyVipLibraryGames(games) {
  const existing = await getLocalLibrarySetting(VIP_GAMES_KEY, null);
  if (existing) return false;
  if (!games.some(isVipLibraryGame)) return false;
  await saveLocalLibraryGames(games);
  return true;
}

export async function getLocalLibraryGames() {
  const db = await openLibraryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([GAMES_STORE, SETTINGS_STORE], 'readonly');
    const localRequest = transaction.objectStore(GAMES_STORE).getAll();
    const vipRequest = transaction.objectStore(SETTINGS_STORE).get(VIP_GAMES_KEY);
    let localGames = [];
    let vipGames = [];
    localRequest.onsuccess = () => { localGames = localRequest.result || []; };
    vipRequest.onsuccess = () => { vipGames = vipRequest.result?.value || []; };
    localRequest.onerror = () => reject(localRequest.error);
    vipRequest.onerror = () => reject(vipRequest.error);
    transaction.oncomplete = () => {
      db.close();
      resolve([...localGames, ...vipGames]);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getLocalLibraryGame(id) {
  const db = await openLibraryDb();
  try {
    const transaction = db.transaction([GAMES_STORE, SETTINGS_STORE], 'readonly');
    const localPromise = requestToPromise(transaction.objectStore(GAMES_STORE).get(id));
    const snapshotPromise = requestToPromise(transaction.objectStore(SETTINGS_STORE).get(VIP_GAMES_KEY));
    const [localGame, snapshot] = await Promise.all([localPromise, snapshotPromise]);
    if (localGame) return localGame;
    return snapshot?.value?.find((game) => game.id === id);
  } finally {
    db.close();
  }
}

export async function saveLocalLibrarySetting(key, value) {
  await runStore(SETTINGS_STORE, 'readwrite', (store) => {
    store.put({ key, value });
  });
}

export async function getLocalLibrarySetting(key, fallback = null) {
  const db = await openLibraryDb();
  try {
    const transaction = db.transaction(SETTINGS_STORE, 'readonly');
    const result = await requestToPromise(transaction.objectStore(SETTINGS_STORE).get(key));
    return result ? result.value : fallback;
  } finally {
    db.close();
  }
}
