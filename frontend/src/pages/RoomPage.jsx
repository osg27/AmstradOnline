import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { unzipSync } from 'fflate';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';
import RoomChat from '../components/RoomChat';
import SocialSidebar from '../components/SocialSidebar';
import useSignaling from '../hooks/useSignaling';
import { buildRtcConfig, waitForIceGatheringComplete } from '../utils/webrtc';
import amstradControlProfiles from '../data/amstradControlProfiles.json';
import mame2003PlusTitles from '../data/mame2003PlusTitles';

const KICKSTART_DB_NAME = 'oldstylegaming-kickstarts';
const KICKSTART_STORE_NAME = 'roms';
const AMIGA_KICKSTART_KEY = 'amiga-a500-kickstart';
const AMIGA_AGA_KICKSTART_KEY = 'amiga-aga-a1200-kickstart';
const PLAYSTATION_BIOS_KEY = 'playstation-bios';
const ATARI_ST_TOS_KEY = 'atari-st-tos';
const CONTROL_MATCH_LIMIT = 6;
const ROOM_SYSTEM_OPTIONS = [
  ['cpc', 'Amstrad CPC'],
  ['cpc_party', 'Amstrad CPC Party'],
  ['cpc_pinball', 'Amstrad Pinball Dreams'],
  ['spectrum', 'ZX Spectrum'],
  ['c64', 'Commodore 64'],
  ['atari8', 'Atari 400/800 XL'],
  ['atarist', 'Atari ST'],
  ['amiga', 'Amiga'],
  ['amiga_link', 'Amiga Link Play'],
  ['amiga_aga', 'Amiga AGA'],
  ['mastersystem', 'Sega Master System'],
  ['megadrive', 'Mega Drive'],
  ['nes', 'NES'],
  ['snes', 'SNES'],
  ['pcengine', 'PC Engine / TurboGrafx-16'],
  ['playstation', 'Sony PlayStation'],
  ['arcade', 'MAME Arcade'],
];

const CONTROL_ACTION_LABELS = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  upLeft: 'Up left',
  upRight: 'Up right',
  downLeft: 'Down left',
  downRight: 'Down right',
  fire1: 'Fire 1',
  fire2: 'Fire 2',
  pause: 'Pause',
  start: 'Start',
  quit: 'Quit',
};

const CONTROL_DIRECTIONS = [
  ['upLeft', 'Up left'],
  ['up', 'Up'],
  ['upRight', 'Up right'],
  ['left', 'Left'],
  ['fire1', 'Fire'],
  ['right', 'Right'],
  ['downLeft', 'Down left'],
  ['down', 'Down'],
  ['downRight', 'Down right'],
];

const CONTROL_UTILITY_ACTIONS = ['fire2', 'pause', 'start', 'quit'];
const ATARI8_ZIP_EXTENSIONS = ['.atr', '.xfd', '.atx', '.xex', '.com', '.car', '.rom', '.bin', '.cas'];
const ATARI8_ZIP_EXTENSION_PRIORITY = ['.xex', '.com', '.car', '.rom', '.bin', '.atr', '.xfd', '.atx', '.cas'];

function normaliseSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(side|disk|disc|tape|part|set)\s*[a-z0-9]+\b/g, ' ')
    .replace(/\b(europe|uk|usa|france|germany|spain|italy|amstrad|cpc|dsk|cracked|crack|trainer|budget|re-release)\b/g, ' ')
    .replace(/\b(the|of|and|a|an)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normaliseSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function tokenSimilarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const shared = Array.from(left).filter((token) => right.has(token)).length;
  const coverage = shared / Math.max(left.size, right.size);
  const precision = shared / Math.min(left.size, right.size);

  return Math.round((coverage * 70) + (precision * 30));
}

function scoreControlProfile(fileName, profile) {
  const queryText = normaliseSearchText(fileName);
  const queryTokens = searchTokens(fileName);
  const candidates = [profile.gameSlug, profile.title, profile.source?.manualFile];

  return Math.max(...candidates.map((candidate) => {
    const candidateText = normaliseSearchText(candidate);
    const candidateTokens = searchTokens(candidate);
    let score = tokenSimilarity(queryTokens, candidateTokens);

    if (candidateText && queryText === candidateText) {
      score = Math.max(score, 120);
    } else if (candidateText && (queryText.includes(candidateText) || candidateText.includes(queryText))) {
      score = Math.max(score, 96);
    }

    return score;
  }));
}

function findControlProfileMatches(fileName) {
  if (!fileName) return [];

  return amstradControlProfiles
    .map((profile) => ({
      profile,
      score: scoreControlProfile(fileName, profile),
    }))
    .filter((match) => match.score >= 45)
    .sort((left, right) => right.score - left.score || left.profile.title.localeCompare(right.profile.title))
    .slice(0, CONTROL_MATCH_LIMIT);
}

function shouldAutoSelectControlMatch(matches) {
  if (!matches.length) return false;

  const [best, next] = matches;
  return best.score >= 110 || (best.score >= 92 && (!next || best.score - next.score >= 12));
}

function atari8ZipEntryPriority(entryName) {
  const lowerName = entryName.toLowerCase();
  const index = ATARI8_ZIP_EXTENSION_PRIORITY.findIndex((extension) => lowerName.endsWith(extension));
  return index === -1 ? ATARI8_ZIP_EXTENSION_PRIORITY.length : index;
}

function formatControlAction(action) {
  return CONTROL_ACTION_LABELS[action] || action.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function formatControlValue(value) {
  return String(value || '')
    .replace(/CURSOR_/g, '')
    .replace(/_/g, ' ')
    .trim();
}

function openKickstartDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(KICKSTART_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(KICKSTART_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open Kickstart storage'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Kickstart storage request failed'));
  });
}

function roomSystemLabel(system) {
  return ROOM_SYSTEM_OPTIONS.find(([value]) => value === system)?.[1] || 'Amstrad CPC';
}

async function expandAtari8ZipFile(file) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const entries = Object.entries(archive)
    .filter(([entryName]) => {
      const lowerName = entryName.toLowerCase();
      return !lowerName.endsWith('/') && ATARI8_ZIP_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    })
    .sort(([leftName], [rightName]) => {
      const leftPriority = atari8ZipEntryPriority(leftName);
      const rightPriority = atari8ZipEntryPriority(rightName);
      return leftPriority - rightPriority || leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
    });

  if (!entries.length) {
    throw new Error('Atari 8-bit zip files need to contain an .atr, .xex, .car, .rom, .bin, or .cas file');
  }

  const [entryName, bytes] = entries[0];
  const fileName = entryName.split(/[\\/]/).pop() || entryName;
  return { fileName, bytes };
}

function clearAtari8SessionStorage() {
  try {
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('a8.')) {
        keys.push(key);
      }
    }
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Run without storage access if the browser blocks it.
  }
}

function buildAmigaKickstartPayload(system, fileName, bytes) {
  if (system === 'amiga_aga') {
    return {
      type: 'amiga_kickstart',
      fileName,
      bytes,
    };
  }

  return {
    type: 'amiga_kickstart',
    fileName,
    bytes,
    kickstart_rom: bytes,
  };
}

async function saveStoredKickstart(key, fileName, bytes) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    await requestToPromise(store.put({ fileName, bytes }, key));
  } finally {
    db.close();
  }
}

async function loadStoredKickstart(key) {
  const db = await openKickstartDb();

  try {
    const transaction = db.transaction(KICKSTART_STORE_NAME, 'readonly');
    const store = transaction.objectStore(KICKSTART_STORE_NAME);
    const stored = await requestToPromise(store.get(key));

    if (!stored?.fileName || !stored?.bytes) return null;

    return {
      fileName: stored.fileName,
      bytes: new Uint8Array(stored.bytes),
    };
  } finally {
    db.close();
  }
}

export default function RoomPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams();
  const [searchParams] = useSearchParams();
  const username = localStorage.getItem('username');
  const isSoloMode = searchParams.get('mode') === 'solo';

  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('Loading room...');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [hostStarted, setHostStarted] = useState(false);
  const [guestPrepared, setGuestPrepared] = useState(false);
  const [loadedDiskName, setLoadedDiskName] = useState('');
  const [arcadeRomFolderName, setArcadeRomFolderName] = useState('');
  const [arcadeRomEntries, setArcadeRomEntries] = useState([]);
  const [arcadeRomSearch, setArcadeRomSearch] = useState('');
  const [showArcadeCloneRoms, setShowArcadeCloneRoms] = useState(false);
  const [arcadeRomScanning, setArcadeRomScanning] = useState(false);
  const [loadedAgaDiskCount, setLoadedAgaDiskCount] = useState(0);
  const [currentAgaDiskIndex, setCurrentAgaDiskIndex] = useState(0);
  const [kickstartRomName, setKickstartRomName] = useState('');
  const [playstationBiosName, setPlaystationBiosName] = useState('');
  const [inputCaptured, setInputCaptured] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isScreenFullscreen, setIsScreenFullscreen] = useState(false);
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const [emulatorFrameLoadCount, setEmulatorFrameLoadCount] = useState(0);
  const [roomSessionKey, setRoomSessionKey] = useState(0);
  const [emulatorSessionKey, setEmulatorSessionKey] = useState(0);
  const [selectedRoomSystem, setSelectedRoomSystem] = useState('cpc');
  const [switchingSystem, setSwitchingSystem] = useState(false);
  const [inputDebug, setInputDebug] = useState({
    mask: 0,
    source: 'none',
    events: [],
  });
  const [hostDisplayName, setHostDisplayName] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');
  const [activePartyPlayer, setActivePartyPlayer] = useState(1);
  const [partyPlayerNumber, setPartyPlayerNumber] = useState(null);
  const [partyRoster, setPartyRoster] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [serialActivity, setSerialActivity] = useState({ sent: 0, received: 0 });

  const remoteMediaStreamRef = useRef(null);
  const remoteVoiceStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteVoiceAudioRef = useRef(null);
  const emulatorFrameRef = useRef(null);
  const mirrorCanvasRef = useRef(null);
  const mirrorLoopRef = useRef(null);
  const fileInputRef = useRef(null);
  const swapDiskInputRef = useRef(null);
  const kickstartInputRef = useRef(null);
  const atariTosInputRef = useRef(null);
  const playstationBiosInputRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const serialChannelRef = useRef(null);
  const serialOfferStartedRef = useRef(false);
  const handleGuestPayloadOnHostRef = useRef(null);
  const localOfferRef = useRef(null);
  const hostVideoStreamRef = useRef(null);
  const hostAudioStreamRef = useRef(null);
  const partyHostPeersRef = useRef(new Map());
  const pendingPartyGuestsRef = useRef(new Map());
  const hostStartingRef = useRef(false);
  const hostStartedRef = useRef(false);
  const loadedDiskNameRef = useRef('');
  const guestPreparedRef = useRef(false);
  const gamepadIndexRef = useRef(null);
  const inputSessionIdRef = useRef(`${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inputSequenceRef = useRef(0);
  const localJoystickMaskRef = useRef(0);
  const localMicStreamRef = useRef(null);
  const localMicSenderRef = useRef(null);
  const micRenegotiationNeededRef = useRef(false);
  const lastRemoteInputSessionRef = useRef('');
  const lastRemoteInputSeqRef = useRef(0);
  const lastRemoteInputAtRef = useRef(0);
  const remoteJoystickMaskRef = useRef(0);
  const pendingIceCandidatesRef = useRef([]);
  const isHostRef = useRef(false);
  const signalingClientIdRef = useRef(window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const activeGuestSignalIdRef = useRef('');
  const activePeerSignalIdRef = useRef('');
  const sentStoredKickstartFrameRef = useRef(0);
  const savedSystemMediaRef = useRef(new Map());
  const [micEnabled, setMicEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micStatus, setMicStatus] = useState('Mic off');
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
  const [c64WarpEnabled, setC64WarpEnabled] = useState(false);
  const [c64JoystickPortsSwapped, setC64JoystickPortsSwapped] = useState(false);
  const [c64MediaCount, setC64MediaCount] = useState(0);
  const [c64MediaIndex, setC64MediaIndex] = useState(0);
  const [atariTosName, setAtariTosName] = useState('');
  const [atariStMediaCount, setAtariStMediaCount] = useState(0);
  const [atariStMediaIndex, setAtariStMediaIndex] = useState(0);
  const [controlProfileMatches, setControlProfileMatches] = useState([]);
  const [selectedControlProfile, setSelectedControlProfile] = useState(null);
  const [controlProfileDrawerOpen, setControlProfileDrawerOpen] = useState(false);

  const userId = useMemo(() => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Number(payload.sub);
    } catch {
      return null;
    }
  }, []);

  const isHost = room ? room.owner_user_id === userId : null;
  const roomSystem = room?.system || 'cpc';
  const isCpcParty = roomSystem === 'cpc_party';
  const isCpcPinball = roomSystem === 'cpc_pinball';
  const isCpcSystem = roomSystem === 'cpc' || roomSystem === 'cpc_party' || isCpcPinball;
  const isSpectrum = roomSystem === 'spectrum';
  const isAmiga = roomSystem === 'amiga';
  const isAmigaLink = roomSystem === 'amiga_link';
  const isAmigaAga = roomSystem === 'amiga_aga';
  const isAmigaFamily = isAmiga || isAmigaLink || isAmigaAga;
  const canControlLocalEmulator = isHost || isAmigaLink;
  const isMasterSystem = roomSystem === 'mastersystem';
  const isMegaDrive = roomSystem === 'megadrive';
  const isSegaConsole = isMasterSystem || isMegaDrive;
  const isNes = roomSystem === 'nes';
  const isSnes = roomSystem === 'snes';
  const isPcEngine = roomSystem === 'pcengine';
  const isPlayStation = roomSystem === 'playstation';
  const isC64 = roomSystem === 'c64';
  const isAtari8 = roomSystem === 'atari8';
  const isAtariSt = roomSystem === 'atarist';
  const isMouseComputer = isAmigaFamily || isAtariSt;
  const isArcade = roomSystem === 'arcade';
  const kickstartStorageKey = isAmiga || isAmigaLink ? AMIGA_KICKSTART_KEY : isAmigaAga ? AMIGA_AGA_KICKSTART_KEY : isPlayStation ? PLAYSTATION_BIOS_KEY : isAtariSt ? ATARI_ST_TOS_KEY : '';
  const partyMaxPlayers = Math.min(8, Math.max(2, Number(room?.party_max_players) || 2));
  const isC64Party = isC64 && !isSoloMode && partyMaxPlayers > 2;
  const isArcadeParty = isArcade && !isSoloMode && partyMaxPlayers > 2;
  const isMultiPeerParty = isCpcParty || isC64Party || isArcadeParty;
  const currentPartyPlayerNumber = isHost ? 1 : partyPlayerNumber || 2;
  const isDirectJoystickSystem = isAmigaFamily || isSegaConsole || isNes || isSnes || isPcEngine || isPlayStation || isC64 || isAtari8 || isAtariSt || isArcade;
  const systemLabel = isCpcParty ? 'Amstrad CPC Party' : isCpcPinball ? 'Amstrad Pinball Dreams' : isAmigaAga ? 'Amiga AGA' : isAmigaLink ? 'Amiga Link Play' : isAmiga ? 'Amiga' : isMasterSystem ? 'Sega Master System' : isMegaDrive ? 'Mega Drive' : isNes ? 'NES' : isSnes ? 'SNES' : isPcEngine ? 'PC Engine / TurboGrafx-16' : isPlayStation ? 'Sony PlayStation' : isC64 ? 'Commodore 64' : isAtari8 ? 'Atari 400/800 XL' : isAtariSt ? 'Atari ST' : isArcade ? 'MAME Arcade' : isSpectrum ? 'ZX Spectrum' : 'Amstrad CPC';
  useEffect(() => {
    setSelectedRoomSystem(roomSystem);
  }, [roomSystem]);

  const emulatorSrc = isAmigaAga
    ? '/amiga-aga/launcher.html?v=2026-06-13-2'
    : isAmiga || isAmigaLink
    ? '/amiga/launcher.html?v=2026-06-27-1'
    : isSegaConsole ? `/megadrive/launcher.html?system=${isMasterSystem ? 'mastersystem' : 'megadrive'}&v=2026-06-22-3` : isNes ? '/nes/launcher.html?v=2026-07-01-2' : isSnes ? '/snes/launcher.html?v=2026-06-01-2' : isPcEngine ? '/pcengine/launcher.html?v=2026-06-14-2' : isPlayStation ? '/playstation/launcher.html?v=2026-06-14-3' : isC64 ? '/c64/launcher.html?v=2026-06-13-2' : isAtari8 ? '/atari8/?v=2026-07-01-5' : isAtariSt ? '/atarist/launcher.html?v=2026-06-21-3' : isArcade ? '/arcade/launcher.html?v=2026-06-23-1' : isSpectrum ? '/spectrum/index.html?v=2026-06-01-2' : isCpcPinball ? '/emulator-pinball-cpcbox/index.html?v=2026-06-19-7' : '/emulator/index.html?v=2026-06-01-1';
  const emulatorTitle = `${systemLabel} Emulator`;
  const acceptedMedia = isAmigaFamily
    ? '.adf,.zip'
    : isMasterSystem ? '.sms' : isMegaDrive ? '.bin,.gen,.md,.smd' : isNes ? '.nes' : isSnes ? '.sfc,.smc,.fig,.swc,.bsx,.gd3,.gd7,.dx2' : isPcEngine ? '.pce,.sgx,.zip' : isPlayStation ? '.cue,.bin,.chd,.pbp,.iso,.zip,.7z' : isC64 ? '.d64,.t64,.tap,.prg,.crt' : isAtari8 ? '.atr,.xfd,.atx,.xex,.com,.car,.rom,.bin,.cas,.zip' : isAtariSt ? '.st,.msa,.stx,.ipf' : isArcade ? '.zip' : isSpectrum ? '.tap,.tzx,.z80,.sna,.szx,.zip' : '.dsk';
  const mediaLabel = isAmigaAga ? 'Load Amiga AGA file' : isAmiga || isAmigaLink ? 'Load Amiga file' : isMasterSystem ? 'Load Master System ROM' : isMegaDrive ? 'Load Mega Drive ROM' : isNes ? 'Load NES ROM' : isSnes ? 'Load SNES ROM' : isPcEngine ? loadedDiskName ? 'Change PC Engine game' : 'Load PC Engine ROM' : isPlayStation ? loadedDiskName ? 'Change PlayStation game' : 'Load PlayStation game' : isC64 ? 'Load C64 file' : isAtari8 ? loadedDiskName ? 'Change Atari 8-bit file' : 'Load Atari 8-bit file' : isAtariSt ? 'Load Atari ST disk' : isArcade ? 'Load MAME ROM' : isSpectrum ? 'Load Spectrum file' : 'Load .dsk';
  const controlLabel = !room
    ? 'Loading controls'
    : isSoloMode
      ? isAmigaFamily
        ? 'P1 Amiga controls + keyboard/mouse'
        : isMasterSystem ? 'P1 controller 1 / Button 1 / Button 2 / Pause' : isMegaDrive ? 'P1 controller 1 / A B C / Start' : isNes ? 'P1 controller 1 / A B / Start / Select' : isSnes ? 'P1 controller 1 / B Y A / Start' : isPcEngine ? 'P1 controller 1 / I II / Run / Select' : isPlayStation ? 'P1 PlayStation controller' : isC64 ? 'P1 C64 joystick + keyboard' : isAtari8 ? 'P1 Atari joystick + keyboard' : isAtariSt ? 'P1 Atari ST joystick + keyboard/mouse' : isArcade ? 'P1 arcade controls' : isSpectrum ? 'P1 Sinclair controls' : isCpcPinball ? 'Z / M flippers, Down plunger, Space nudge' : isCpcParty ? `P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : 'Cursor keys + X / Z'
      : isAmigaFamily
      ? 'P1 port 2 / P2 port 1 + keyboard/mouse'
      : isMasterSystem ? (isHost ? 'P1 controller 1 / Button 1 / Button 2 / Pause' : 'P2 controller 2 / Button 1 / Button 2') : isMegaDrive ? (isHost ? 'P1 controller 1 / A B C / Start' : 'P2 controller 2 / A B C / Start') : isNes ? (isHost ? 'P1 controller 1 / A B / Start / Select' : 'P2 controller 2 / A B / Start / Select') : isSnes ? (isHost ? 'P1 controller 1 / B Y A / Start' : 'P2 controller 2 / B Y A / Start') : isPcEngine ? (isHost ? 'P1 controller 1 / I II / Run / Select' : 'P2 controller 2 / I II / Run / Select') : isPlayStation ? (isHost ? 'P1 PlayStation controller' : 'P2 PlayStation controller') : isC64Party ? `P${currentPartyPlayerNumber} C64 joystick` : isC64 ? (isHost ? 'P1 C64 joystick' : 'P2 C64 joystick') : isAtari8 ? (isHost ? 'P1 Atari joystick + keyboard' : 'P2 Atari joystick') : isAtariSt ? (isHost ? 'P1 Atari ST joystick + keyboard/mouse' : 'P2 Atari ST joystick') : isArcadeParty ? `P${currentPartyPlayerNumber} arcade controls` : isArcade ? (isHost ? 'P1 arcade controls' : 'P2 arcade controls') : isSpectrum ? 'P1 Sinclair 1 / P2 Sinclair 2' : isCpcParty ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}` : isHost ? 'Cursor keys + X / Z' : 'Q A O P / F / G';
  const roleLabel = !room
    ? 'Loading...'
    : isSoloMode ? 'Solo' : isHost ? 'Host' : 'Guest';
  const playerOneName = hostDisplayName || (isHost ? username : 'Host');
  const playerTwoName = guestDisplayName || (!isHost ? username : 'Guest');
  const normalPlayerSummary = `P1: ${playerOneName} / P2: ${playerTwoName}`;
  const assignedControlLabel = isSoloMode
    ? `P1: ${username || playerOneName}`
    : isCpcParty
    ? `You: P${currentPartyPlayerNumber} / turn: P${activePartyPlayer}`
    : isC64Party
      ? `P${currentPartyPlayerNumber}: ${isHost ? playerOneName : username || playerTwoName} / C64 joystick`
    : isArcadeParty
      ? `P${currentPartyPlayerNumber}: ${isHost ? playerOneName : username || playerTwoName} / controller ${currentPartyPlayerNumber}`
    : isDirectJoystickSystem
      ? `${isHost ? `P1: ${playerOneName}` : `P2: ${playerTwoName}`} / controller ${isHost ? '1' : '2'}`
      : isHost
        ? `P1: ${playerOneName}`
        : `P2: ${playerTwoName}`;
  const partyPlayerNameByNumber = useMemo(() => {
    const names = new Map();
    partyRoster.forEach((player) => {
      names.set(player.playerNumber, player.username);
    });
    return names;
  }, [partyRoster]);
  const activePartyPlayerName = partyPlayerNameByNumber.get(activePartyPlayer);
  const arcadeParentRomCount = useMemo(
    () => arcadeRomEntries.filter((entry) => !entry.isClone).length,
    [arcadeRomEntries],
  );
  const arcadeCloneRomCount = arcadeRomEntries.length - arcadeParentRomCount;
  const filteredArcadeRomEntries = useMemo(() => {
    const query = arcadeRomSearch.trim().toLowerCase();
    const visibleEntries = showArcadeCloneRoms
      ? arcadeRomEntries
      : arcadeRomEntries.filter((entry) => !entry.isClone);
    const entries = query
      ? visibleEntries.filter((entry) => (
        entry.name.toLowerCase().includes(query)
        || entry.displayName.toLowerCase().includes(query)
        || entry.path.toLowerCase().includes(query)
        || entry.parentTitle.toLowerCase().includes(query)
      ))
      : visibleEntries;

    return entries.slice(0, 120);
  }, [arcadeRomEntries, arcadeRomSearch, showArcadeCloneRoms]);

  useEffect(() => {
    isHostRef.current = isHost === true;
  }, [isHost]);

  useEffect(() => {
    setEmulatorFrameLoadCount(0);
    sentStoredKickstartFrameRef.current = 0;
    if (isAtari8) {
      clearAtari8SessionStorage();
    }
  }, [emulatorSrc, emulatorSessionKey]);

  useEffect(() => {
    if (isCpcParty || !navigator.mediaDevices?.addEventListener) {
      return undefined;
    }

    const handleDeviceChange = () => {
      refreshMicrophoneDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    refreshMicrophoneDevices();

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [isCpcParty]);

  useEffect(() => {
    if (!room || !username) return;

    if (isHost) {
      setHostDisplayName(username);
    } else {
      setGuestDisplayName(username);
    }
  }, [isHost, room, username]);

  useEffect(() => {
    if (!isMultiPeerParty || !isHost) {
      setPartyRoster([]);
      return;
    }

    refreshPartyRoster();
  }, [isHost, isMultiPeerParty, username]);

  const addLog = useCallback((message) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${message}`, ...prev].slice(0, 80));
  }, []);

  const sendSignalRef = useRef(() => false);

  function clearMirrorCanvas(message = 'Loading emulator...') {
    const canvas = mirrorCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#d8d8d4';
    context.font = '20px sans-serif';
    context.textAlign = 'center';
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  }

  function resetLiveRoomSession(message = 'Room session reset', { preservePeer = false } = {}) {
    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    clearMirrorCanvas(message);

    if (!preservePeer) {
      dataChannelRef.current?.close();
      serialChannelRef.current?.close();
      dataChannelRef.current = null;
      serialChannelRef.current = null;
      serialOfferStartedRef.current = false;
      localOfferRef.current = null;
      pendingIceCandidatesRef.current = [];
      activeGuestSignalIdRef.current = '';
      activePeerSignalIdRef.current = '';
      remoteMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteMediaStreamRef.current = null;
      remoteVoiceStreamRef.current = null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      if (remoteVoiceAudioRef.current) {
        remoteVoiceAudioRef.current.pause();
        remoteVoiceAudioRef.current.srcObject = null;
      }

      for (const [guestId] of partyHostPeersRef.current) {
        closePartyPeer(guestId);
      }
      partyHostPeersRef.current.clear();
      pendingPartyGuestsRef.current.clear();
      pcRef.current?.close();
      pcRef.current = null;
    }

    setHostStarted(false);
    hostStartedRef.current = false;
    hostStartingRef.current = false;
    if (!preservePeer) {
      setGuestPrepared(false);
      guestPreparedRef.current = false;
      setRemoteConnected(false);
    }
    setLoadedDiskName('');
    setInputCaptured(false);
    setEmulatorFrameLoadCount(0);
    sentStoredKickstartFrameRef.current = 0;
    if (!preservePeer) {
      setPartyPlayerNumber(null);
      setPartyRoster([]);
      setGuestDisplayName('');
      setRemoteConnected(false);
      setRoomSessionKey((key) => key + 1);
    }
    setActivePartyPlayer(1);
    setEmulatorSessionKey((key) => key + 1);
    setStatus(message);
    addLog(message);
  }

  function applyRoomSystemUpdate(nextRoom, messagePrefix = 'Room switched') {
    if (!nextRoom?.system) return;
    setRoom(nextRoom);
    setSelectedRoomSystem(nextRoom.system);
    resetLiveRoomSession(`${messagePrefix} to ${roomSystemLabel(nextRoom.system)}`, { preservePeer: true });
  }

  const addInputDebug = useCallback((message, mask = null, source = null) => {
    setInputDebug((prev) => ({
      mask: mask ?? prev.mask,
      source: source ?? prev.source,
      events: [`${new Date().toLocaleTimeString()} - ${message}`, ...prev.events].slice(0, 14),
    }));
  }, []);

  function shouldHandleKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'button'
      && tag !== 'a'
      && !event.metaKey
      && (!event.altKey || event.key === 'Alt')
    );
  }

  function shouldHandleHostKey(event) {
    const tag = event.target?.tagName?.toLowerCase();

    return (
      tag !== 'input'
      && tag !== 'textarea'
      && tag !== 'select'
      && !event.target?.isContentEditable
      && !event.metaKey
      && !event.altKey
    );
  }

  function getKeyboardKey(event) {
    if (event.code === 'Space' || event.key === 'Spacebar' || event.keyCode === 32) {
      return ' ';
    }

    return event.key;
  }

  function keyToJoystickBit(key) {
    switch (key) {
      case 'q':
      case 'Q':
        return 1;
      case 'a':
      case 'A':
        return 2;
      case 'o':
      case 'O':
        return 4;
      case 'p':
      case 'P':
        return 8;
      case 'f':
      case 'F':
        return 16;
      case 'g':
      case 'G':
        return 32;
      default:
        return 0;
    }
  }

  function gamepadToJoystickMask(pad, system = roomSystem) {
    let mask = 0;
    const deadzone = 0.45;

    const left = pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -deadzone;
    const right = pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > deadzone;
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -deadzone;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > deadzone;
    if (system === 'cpc_pinball') {
      let pinballMask = 0;
      if (up) pinballMask |= 1;
      if (left) pinballMask |= 4;
      if (right) pinballMask |= 8;
      if (down) pinballMask |= 2;
      if (pad.buttons[0]?.pressed) pinballMask |= 16;
      if (pad.buttons[1]?.pressed) pinballMask |= 64;
      if (pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) pinballMask |= 32;
      return pinballMask;
    }
    const isMultiButtonSystem = system === 'mastersystem' || system === 'megadrive' || system === 'nes' || system === 'snes' || system === 'pcengine' || system === 'playstation' || system === 'arcade';
    const fire = isMultiButtonSystem
      ? pad.buttons[0]?.pressed
      : [0, 1].some((index) => pad.buttons[index]?.pressed);
    const extra = isMultiButtonSystem
      ? pad.buttons[1]?.pressed
      : [2, 3].some((index) => pad.buttons[index]?.pressed);
    const third = isMultiButtonSystem && pad.buttons[2]?.pressed;
    const start = system === 'arcade'
      ? pad.buttons[9]?.pressed
      : [7, 9].some((index) => pad.buttons[index]?.pressed);

    if (up) mask |= 1;
    if (down) mask |= 2;
    if (left) mask |= 4;
    if (right) mask |= 8;
    if (fire) mask |= 16;
    if (extra) mask |= 32;
    if (start) mask |= 64;
    if (third) mask |= 128;
    if (system === 'arcade') {
      if (pad.buttons[3]?.pressed) mask |= 256;
      if (pad.buttons[4]?.pressed) mask |= 512;
      if (pad.buttons[5]?.pressed) mask |= 1024;
      if (pad.buttons[6]?.pressed) mask |= 2048;
      if (pad.buttons[8]?.pressed) mask |= 4096;
    }
    if (system === 'playstation') {
      if (pad.buttons[3]?.pressed) mask |= 256;
      if (pad.buttons[8]?.pressed) mask |= 512;
      if (pad.buttons[4]?.pressed) mask |= 1024;
      if (pad.buttons[5]?.pressed) mask |= 2048;
    }

    return mask;
  }

  function joystickMaskToLabels(mask) {
    if (isArcade) {
      return [
        ['Up', Boolean(mask & 1)],
        ['Down', Boolean(mask & 2)],
        ['Left', Boolean(mask & 4)],
        ['Right', Boolean(mask & 8)],
        ['Button 0', Boolean(mask & 16)],
        ['Button 1', Boolean(mask & 32)],
        ['Button 2', Boolean(mask & 128)],
        ['Button 3', Boolean(mask & 256)],
        ['Button 4', Boolean(mask & 512)],
        ['Button 5', Boolean(mask & 1024)],
        ['Button 6', Boolean(mask & 2048)],
        ['Coin', Boolean(mask & 4096)],
        ['Start', Boolean(mask & 64)],
      ];
    }

    return [
      ['Up', Boolean(mask & 1)],
      ['Down', Boolean(mask & 2)],
      ['Left', Boolean(mask & 4)],
      ['Right', Boolean(mask & 8)],
      ['Fire', Boolean(mask & 16)],
      ['Extra', Boolean(mask & 32)],
      ['Start', Boolean(mask & 64)],
      ['Third', Boolean(mask & 128)],
    ];
  }

  function formatInputPayload(payload) {
    if (!payload) return 'empty payload';

    if (payload.type === 'control') {
      return `P${payload.player} ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'key') {
      return `P${payload.player} key ${payload.key} ${payload.action}`;
    }

    if (payload.type === 'joystick') {
      return `P${payload.player} mask ${payload.mask}`;
    }

    if (payload.type === 'input_state') {
      return `P${payload.player} state ${payload.mask} #${payload.seq}`;
    }

    if (payload.type === 'amiga_mouse_button') {
      return `Amiga mouse button ${payload.button} ${payload.action}`;
    }

    if (payload.type === 'amiga_mouse_move') {
      return `Amiga mouse move ${payload.movementX},${payload.movementY}`;
    }

    return `${payload.type || 'unknown'} input`;
  }

  function joystickMaskToKeys(mask, player) {
    const keys = player === 1
      ? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'x', extra: 'z' }
      : { up: 'q', down: 'a', left: 'o', right: 'p', fire: 'f', extra: 'g' };

    return [
      [keys.up, 1, Boolean(mask & 1)],
      [keys.down, 2, Boolean(mask & 2)],
      [keys.left, 4, Boolean(mask & 4)],
      [keys.right, 8, Boolean(mask & 8)],
      [keys.fire, 16, Boolean(mask & 16)],
      [keys.extra, 32, Boolean(mask & 32)],
    ];
  }

  function hostKeyToCpcKeyboardKey(key) {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case ' ':
        return key;
      case 'q':
      case 'Q':
        return 'q';
      case 'a':
      case 'A':
        return 'a';
      case 'o':
      case 'O':
        return 'o';
      case 'p':
      case 'P':
        return 'p';
      case 'f':
      case 'F':
        return 'f';
      case 'Enter':
        return 'Enter';
      case 'Tab':
        return 'Tab';
      case 'CapsLock':
        return 'CapsLock';
      case 'Control':
      case 'ControlLeft':
      case 'ControlRight':
        return 'Control';
      case 'Alt':
      case 'AltLeft':
      case 'AltRight':
        return 'Alt';
      case 'Shift':
      case 'ShiftLeft':
      case 'ShiftRight':
        return 'Shift';
      case 'Backspace':
        return 'Backspace';
      case 'Delete':
        return 'Delete';
      case 'Escape':
        return 'Escape';
      case 'Home':
        return 'Home';
      case 'End':
        return 'End';
      case 'PageUp':
        return 'PageUp';
      case 'PageDown':
        return 'PageDown';
      case 'F1':
      case 'F2':
      case 'F3':
      case 'F4':
      case 'F5':
      case 'F6':
      case 'F7':
      case 'F8':
      case 'F9':
      case 'F10':
      case 'F11':
      case 'F12':
        return key;
      default:
        return key.length === 1 ? key : null;
    }
  }

  function isMenuKey(key) {
    return [
      'Enter',
      'Tab',
      'CapsLock',
      'Shift',
      'ShiftLeft',
      'ShiftRight',
      'Control',
      'ControlLeft',
      'ControlRight',
      'Alt',
      'AltLeft',
      'AltRight',
      'Backspace',
      'Delete',
      'Escape',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
      'F12',
      ' ',
    ].includes(key);
  }

  function isGuestKeyboardKey(key) {
    return isMenuKey(key) || key.length === 1;
  }

  const forwardInputToEmulator = useCallback((payload) => {
    const frame = emulatorFrameRef.current;
    const targetWindow = frame?.contentWindow;

    if (!targetWindow) return;

    targetWindow.postMessage(payload, window.location.origin);
  }, []);

  const reloadC64Frame = useCallback(async ({ start = false } = {}) => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isC64) return;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    if (!start) return;

    frame.contentWindow?.postMessage({ type: 'c64_start', soloMode: isSoloMode }, window.location.origin);
    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
  }, [emulatorSrc, isC64, isSoloMode]);

  const reloadAtariStFrame = useCallback(async ({ start = false } = {}) => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isAtariSt) return;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    if (!start) return;
    frame.contentWindow?.postMessage({ type: 'atarist_start', soloMode: isSoloMode }, window.location.origin);
    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
  }, [emulatorSrc, isAtariSt, isSoloMode]);

  const reloadAmigaAgaFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isAmigaAga) return;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const storedKickstart = await loadStoredKickstart(AMIGA_AGA_KICKSTART_KEY);
    if (storedKickstart) {
      frame.contentWindow?.postMessage(
        buildAmigaKickstartPayload('amiga_aga', storedKickstart.fileName, storedKickstart.bytes),
        window.location.origin,
      );
    }

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);
  }, [emulatorSrc, isAmigaAga]);

  const reloadPcEngineFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isPcEngine) return;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);

    const previousAudioTrack = hostAudioStreamRef.current?.getAudioTracks?.()[0] || null;
    const nextAudioStream = await waitForHostAudioStream(frame);
    const nextAudioTrack = nextAudioStream?.getAudioTracks?.()[0] || null;

    if (!isSoloMode && previousAudioTrack && nextAudioTrack) {
      const audioSender = pcRef.current?.getSenders?.().find((sender) => sender.track === previousAudioTrack);
      await audioSender?.replaceTrack(nextAudioTrack);
    }

    hostAudioStreamRef.current = nextAudioStream || null;
  }, [emulatorSrc, isPcEngine, isSoloMode]);

  const reloadNesFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isNes) return null;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    return frame;
  }, [emulatorSrc, isNes]);

  const reloadPlayStationFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isPlayStation) return;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    const storedBios = await loadStoredKickstart(PLAYSTATION_BIOS_KEY);
    if (storedBios) {
      frame.contentWindow?.postMessage({
        type: 'playstation_bios',
        fileName: storedBios.fileName,
        bytes: storedBios.bytes,
      }, window.location.origin);
    }

    const emulatorCanvas = await waitForEmulatorCanvas(frame);
    startMirrorLoop(emulatorCanvas);

    const previousAudioTrack = hostAudioStreamRef.current?.getAudioTracks?.()[0] || null;
    const nextAudioStream = await waitForHostAudioStream(frame);
    const nextAudioTrack = nextAudioStream?.getAudioTracks?.()[0] || null;

    if (!isSoloMode && previousAudioTrack && nextAudioTrack) {
      const audioSender = pcRef.current?.getSenders?.().find((sender) => sender.track === previousAudioTrack);
      await audioSender?.replaceTrack(nextAudioTrack);
    }

    hostAudioStreamRef.current = nextAudioStream || null;
  }, [emulatorSrc, isPlayStation, isSoloMode]);

  const reloadArcadeFrame = useCallback(async () => {
    const frame = emulatorFrameRef.current;
    if (!frame || !isArcade) return null;

    if (mirrorLoopRef.current) {
      cancelAnimationFrame(mirrorLoopRef.current);
      mirrorLoopRef.current = null;
    }

    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      const separator = emulatorSrc.includes('?') ? '&' : '?';
      frame.src = `${emulatorSrc}${separator}runtime=${Date.now()}`;
    });

    return frame;
  }, [emulatorSrc, isArcade]);

  async function replaceHostMediaStreams(nextVideoStream, nextAudioStream = null) {
    const previousVideoStream = hostVideoStreamRef.current;
    const previousAudioStream = hostAudioStreamRef.current;
    const nextVideoTrack = nextVideoStream?.getVideoTracks?.()[0] || null;
    const nextAudioTrack = nextAudioStream?.getAudioTracks?.()[0] || null;

    if (!nextVideoTrack) {
      throw new Error('New arcade video stream missing');
    }

    const peerConnections = isMultiPeerParty
      ? Array.from(partyHostPeersRef.current.values()).map((peer) => peer.pc).filter(Boolean)
      : [pcRef.current].filter(Boolean);

    for (const pc of peerConnections) {
      const videoSender = pc.getSenders?.().find((sender) => sender.track?.kind === 'video');
      const audioSender = pc.getSenders?.().find((sender) => sender.track?.kind === 'audio' && nextAudioTrack);

      if (videoSender) {
        await videoSender.replaceTrack(nextVideoTrack);
      } else if (!isSoloMode) {
        pc.addTrack(nextVideoTrack, nextVideoStream);
      }

      if (nextAudioTrack) {
        if (audioSender) {
          await audioSender.replaceTrack(nextAudioTrack);
        } else if (!isSoloMode) {
          pc.addTrack(nextAudioTrack, nextAudioStream);
        }
      }
    }

    previousVideoStream?.getTracks?.().forEach((track) => track.stop());
    previousAudioStream?.getTracks?.().forEach((track) => track.stop());
    hostVideoStreamRef.current = nextVideoStream;
    hostAudioStreamRef.current = nextAudioStream || null;
  }

  const configureSerialChannel = useCallback((channel) => {
    serialChannelRef.current = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      addLog('Amiga serial link connected');
      setStatus('Amiga serial link connected');
    };
    channel.onclose = () => {
      addLog('Amiga serial link closed');
      setStatus('Amiga serial link closed');
    };
    channel.onmessage = (event) => {
      const bytes = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data instanceof Blob
          ? null
          : new Uint8Array([Number(event.data) & 255]);

      if (bytes) {
        setSerialActivity((activity) => ({ ...activity, received: activity.received + bytes.length }));
        bytes.forEach((value) => forwardInputToEmulator({ type: 'amiga_serial_in', value }));
        return;
      }

      event.data.arrayBuffer().then((buffer) => {
        const bytesFromBlob = new Uint8Array(buffer);
        setSerialActivity((activity) => ({ ...activity, received: activity.received + bytesFromBlob.length }));
        bytesFromBlob.forEach((value) => forwardInputToEmulator({ type: 'amiga_serial_in', value }));
      });
    };
  }, [addLog, forwardInputToEmulator]);

  useEffect(() => {
    if (!isAmigaLink) return undefined;

    function handleAmigaSerialOutput(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;
      if (event.data?.type !== 'amiga_serial_out') return;

      const channel = serialChannelRef.current;
      if (channel?.readyState === 'open') {
        channel.send(new Uint8Array([Number(event.data.value) & 255]));
        setSerialActivity((activity) => ({ ...activity, sent: activity.sent + 1 }));
      }
    }

    window.addEventListener('message', handleAmigaSerialOutput);
    return () => window.removeEventListener('message', handleAmigaSerialOutput);
  }, [isAmigaLink]);

  useEffect(() => {
    function handleArcadeMessage(event) {
      if (event.origin !== window.location.origin) return;

      const message = event.data || {};
      if (message.type !== 'arcade_log') return;

      const prefix = message.level === 'error' ? 'Arcade error' : 'Arcade';
      addLog(`${prefix}: ${message.message}`);
    }

    window.addEventListener('message', handleArcadeMessage);

    return () => {
      window.removeEventListener('message', handleArcadeMessage);
    };
  }, [addLog]);

  useEffect(() => {
    if (!isC64) return undefined;

    function handleC64Message(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;

      const message = event.data || {};
      if (message.type !== 'c64_media_status') return;

      setC64MediaCount(Number(message.count) || 0);
      setC64MediaIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleC64Message);
    return () => window.removeEventListener('message', handleC64Message);
  }, [addLog, isC64]);

  useEffect(() => {
    if (!isAtariSt) return undefined;

    function handleAtariStMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;
      const message = event.data || {};
      if (message.type !== 'atarist_media_status') return;

      setAtariStMediaCount(Number(message.count) || 0);
      setAtariStMediaIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleAtariStMessage);
    return () => window.removeEventListener('message', handleAtariStMessage);
  }, [addLog, isAtariSt]);

  useEffect(() => {
    if (!isAmigaAga) return undefined;

    function handleAmigaAgaMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== emulatorFrameRef.current?.contentWindow) return;

      const message = event.data || {};
      if (message.type !== 'amiga_aga_disk_status') return;

      setLoadedAgaDiskCount(Number(message.count) || 0);
      setCurrentAgaDiskIndex(Number(message.current) || 0);
      if (message.message) {
        addLog(message.message);
        setStatus(message.message);
      }
    }

    window.addEventListener('message', handleAmigaAgaMessage);
    return () => window.removeEventListener('message', handleAmigaAgaMessage);
  }, [addLog, isAmigaAga]);

  useEffect(() => {
    if (!isHost || !emulatorFrameLoadCount || !kickstartStorageKey) return undefined;
    if (sentStoredKickstartFrameRef.current === emulatorFrameLoadCount) return undefined;

    let cancelled = false;
    const timers = [];
    sentStoredKickstartFrameRef.current = emulatorFrameLoadCount;
    const timer = window.setTimeout(async () => {
      try {
        let storedKickstart = savedSystemMediaRef.current.get(kickstartStorageKey);
        if (!storedKickstart) {
          storedKickstart = await loadStoredKickstart(kickstartStorageKey);
          if (storedKickstart) {
            savedSystemMediaRef.current.set(kickstartStorageKey, storedKickstart);
          }
        }

        if (cancelled || !storedKickstart) return;

        const payload = isPlayStation
          ? {
            type: 'playstation_bios',
            fileName: storedKickstart.fileName,
            bytes: storedKickstart.bytes,
          }
          : isAtariSt
            ? {
              type: 'atarist_tos',
              fileName: storedKickstart.fileName,
              bytes: storedKickstart.bytes,
            }
            : buildAmigaKickstartPayload(roomSystem, storedKickstart.fileName, storedKickstart.bytes);

        [0, 350, 900, 1600].forEach((delay) => {
          const retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              forwardInputToEmulator(payload);
            }
          }, delay);
          timers.push(retryTimer);
        });

        if (isPlayStation) {
          setPlaystationBiosName(`${storedKickstart.fileName} (saved locally)`);
          addLog(`Loaded saved PlayStation BIOS: ${storedKickstart.fileName}`);
        } else if (isAtariSt) {
          setAtariTosName(`${storedKickstart.fileName} (saved locally)`);
          addLog(`Loaded saved Atari TOS: ${storedKickstart.fileName}`);
        } else {
          setKickstartRomName(`${storedKickstart.fileName} (saved)`);
          addLog(`Loaded saved Kickstart ROM: ${storedKickstart.fileName}`);
        }
      } catch (err) {
        if (!cancelled) {
          addLog(`Saved Kickstart unavailable: ${err.message}`);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      timers.forEach((retryTimer) => window.clearTimeout(retryTimer));
    };
  }, [addLog, emulatorFrameLoadCount, forwardInputToEmulator, isAtariSt, isHost, isPlayStation, kickstartStorageKey, emulatorSessionKey, roomSystem]);

  const forwardExtraButtonAsKey = useCallback((mask, player, previousMask) => {
    const extraBit = 32;
    const active = Boolean(mask & extraBit);
    const wasActive = Boolean(previousMask & extraBit);

    if (active === wasActive) return;

    const key = player === 1 ? 'z' : 'g';
    const action = active ? 'down' : 'up';

    addInputDebug(`forward P${player} extra key ${key} ${action}`, mask, player === 1 ? 'host local' : 'guest remote');
    forwardInputToEmulator({
      type: 'amstrad_remote_control',
      player,
      key,
      action,
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const forwardJoystickMaskAsKeys = useCallback((mask, player, previousMask) => {
    joystickMaskToKeys(mask, player).forEach(([key, bit, active]) => {
      const wasActive = Boolean(previousMask & bit);

      if (active === wasActive) return;

      const action = active ? 'down' : 'up';

      addInputDebug(`forward held P${player} key ${key} ${action}`, mask, 'shared joystick');
      forwardInputToEmulator({
        type: 'amstrad_remote_control',
        player,
        key,
        action,
      });
    });
  }, [addInputDebug, forwardInputToEmulator]);

  const releaseCpcPartySharedInput = useCallback((previousMask = 63) => {
    if (!isCpcParty) return;

    forwardJoystickMaskAsKeys(0, 1, previousMask);
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 1,
      mask: 0,
    });
    forwardInputToEmulator({
      type: 'amstrad_remote_joystick',
      player: 2,
      mask: 0,
    });
  }, [forwardInputToEmulator, forwardJoystickMaskAsKeys, isCpcParty]);

  const sendLocalJoystickMask = useCallback((mask) => {
    const player = isHost ? 1 : isMultiPeerParty ? currentPartyPlayerNumber : 2;
    const joystickMask = isDirectJoystickSystem || isCpcPinball ? mask : mask & 31;
    const previousMask = localJoystickMaskRef.current;
    const payload = {
      type: 'joystick',
      player,
      mask,
    };

    addInputDebug(`local P${player} joystick mask ${mask}`, mask, isHost ? 'host local' : 'guest local');

    if (isAmigaLink) {
      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player: 1,
        mask: joystickMask,
      });
      localJoystickMaskRef.current = mask;
      return;
    }

    if (isHost) {
      if (isCpcParty && activePartyPlayer !== 1) {
        if (previousMask) {
          releaseCpcPartySharedInput(previousMask);
        }
        localJoystickMaskRef.current = 0;
        addInputDebug(`ignored host input, party turn is P${activePartyPlayer}`, 0, 'party turn');
        return;
      }

      if (isCpcParty) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: joystickMask,
        });
        forwardExtraButtonAsKey(mask, 1, previousMask);
        localJoystickMaskRef.current = mask;
        return;
      }

      forwardInputToEmulator({
        type: 'amstrad_remote_joystick',
        player,
        mask: joystickMask,
      });
      if (!isDirectJoystickSystem && !isCpcPinball) {
        forwardExtraButtonAsKey(mask, player, previousMask);
      }
      localJoystickMaskRef.current = mask;
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      localJoystickMaskRef.current = mask;
      const statePayload = {
        type: 'input_state',
        player,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current + 1,
        mask,
        ts: performance.now(),
      };

      inputSequenceRef.current = statePayload.seq;
      addInputDebug(`send to host ${formatInputPayload(statePayload)}`);
      channel.send(JSON.stringify(statePayload));
    } else {
      addInputDebug(`not sent, channel closed ${formatInputPayload(payload)}`);
    }
  }, [activePartyPlayer, addInputDebug, currentPartyPlayerNumber, forwardExtraButtonAsKey, forwardInputToEmulator, isAmigaLink, isCpcParty, isCpcPinball, isDirectJoystickSystem, isHost, isMultiPeerParty, releaseCpcPartySharedInput]);

  const releaseInputCapture = useCallback(() => {
    sendLocalJoystickMask(0);
    if (isCpcPinball) {
      forwardInputToEmulator({ type: 'amstrad_release_all' });
    }
    setInputCaptured(false);
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }, [forwardInputToEmulator, isCpcPinball, sendLocalJoystickMask]);

  const captureInput = useCallback((event = null) => {
    setInputCaptured(true);
    forwardInputToEmulator({
      type: 'amstrad_audio_unlock',
    });

    const captureTarget = event?.currentTarget;
    if (
      isAmigaFamily
      && captureTarget
      && ['CANVAS', 'VIDEO'].includes(captureTarget.tagName)
      && document.pointerLockElement !== captureTarget
    ) {
      captureTarget.requestPointerLock?.();
    }

    const channel = dataChannelRef.current;
    if (!isHost && channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type: 'audio_unlock' }));
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.volume = 1;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [forwardInputToEmulator, isAmigaFamily, isHost]);

  const forwardAmigaMouse = useCallback((payload) => {
    if (!isMouseComputer) return;

    if (canControlLocalEmulator) {
      forwardInputToEmulator(payload);
      return;
    }

    const channel = dataChannelRef.current;
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(payload));
    }
  }, [canControlLocalEmulator, forwardInputToEmulator, isMouseComputer]);

  const handleAmigaPointerDown = useCallback((event) => {
    if (!isMouseComputer) return;

    captureInput();
    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    };

    addInputDebug(`Amiga mouse button ${button} down`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, captureInput, forwardAmigaMouse, isHost, isMouseComputer]);

  const handleAmigaPointerUp = useCallback((event) => {
    if (!isMouseComputer) return;

    const button = event.button === 2 ? 3 : 1;
    const payload = {
      type: 'amiga_mouse_button',
      button,
      action: 'up',
    };

    addInputDebug(`Amiga mouse button ${button} up`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse(payload);
    event.preventDefault();
  }, [addInputDebug, forwardAmigaMouse, isHost, isMouseComputer]);

  const handleAmigaPointerMove = useCallback((event) => {
    if (!isMouseComputer || !inputCaptured) return;
    if (!event.movementX && !event.movementY) return;

    forwardAmigaMouse({
      type: 'amiga_mouse_move',
      movementX: event.movementX,
      movementY: event.movementY,
    });
  }, [forwardAmigaMouse, inputCaptured, isMouseComputer]);

  useEffect(() => {
    if (!isMouseComputer || !inputCaptured) return undefined;

    function handleLockedMouseMove(event) {
      if (!document.pointerLockElement) return;
      if (!event.movementX && !event.movementY) return;

      forwardAmigaMouse({
        type: 'amiga_mouse_move',
        movementX: event.movementX,
        movementY: event.movementY,
      });
    }

    window.addEventListener('mousemove', handleLockedMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleLockedMouseMove);
    };
  }, [forwardAmigaMouse, inputCaptured, isMouseComputer]);

  const sendAmigaMouseClick = useCallback((button) => {
    if (!isMouseComputer) return;

    captureInput();
    addInputDebug(`Amiga mouse button ${button} pulse`, null, isHost ? 'host mouse' : 'guest mouse');
    forwardAmigaMouse({
      type: 'amiga_mouse_button',
      button,
      action: 'down',
    });
    window.setTimeout(() => {
      forwardAmigaMouse({
        type: 'amiga_mouse_button',
        button,
        action: 'up',
      });
    }, 140);
  }, [addInputDebug, captureInput, forwardAmigaMouse, isHost, isMouseComputer]);

  const setPartyTurn = useCallback((playerNumber) => {
    if (!isCpcParty || !isHost) return;

    const nextPlayer = Math.min(partyMaxPlayers, Math.max(1, playerNumber));

    if (localJoystickMaskRef.current) {
      releaseCpcPartySharedInput(localJoystickMaskRef.current);
      localJoystickMaskRef.current = 0;
    }

    if (remoteJoystickMaskRef.current) {
      releaseCpcPartySharedInput(remoteJoystickMaskRef.current);
      remoteJoystickMaskRef.current = 0;
    }

    for (const peer of partyHostPeersRef.current.values()) {
      if (!peer.joystickMask) continue;
      releaseCpcPartySharedInput(peer.joystickMask);
      peer.joystickMask = 0;
    }

    releaseCpcPartySharedInput();
    setActivePartyPlayer(nextPlayer);
    sendSignalRef.current({
      type: 'party-turn',
      playerNumber: nextPlayer,
    });
    addInputDebug(`party turn switched to P${nextPlayer}`, 0, 'party turn');
    addLog(`Party turn switched to player ${nextPlayer}`);
  }, [addInputDebug, addLog, isCpcParty, isHost, partyMaxPlayers, releaseCpcPartySharedInput]);

  const nextPartyTurn = useCallback(() => {
    setPartyTurn(activePartyPlayer >= partyMaxPlayers ? 1 : activePartyPlayer + 1);
  }, [activePartyPlayer, partyMaxPlayers, setPartyTurn]);

  useEffect(() => {
    if (!inputCaptured) {
      return undefined;
    }

    let animationFrame = 0;
    let lastMask = -1;

    function findGamepad(pads) {
      if (gamepadIndexRef.current !== null && pads[gamepadIndexRef.current]) {
        return pads[gamepadIndexRef.current];
      }

      const pad = pads.find(Boolean);
      if (pad) {
        gamepadIndexRef.current = pad.index;
      }

      return pad;
    }

    function pollGamepad() {
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = findGamepad(pads);

      if (pad) {
        const mask = gamepadToJoystickMask(pad);

        if (mask !== lastMask) {
          lastMask = mask;
          sendLocalJoystickMask(mask);
        }
      }

      animationFrame = requestAnimationFrame(pollGamepad);
    }

    pollGamepad();

    return () => {
      cancelAnimationFrame(animationFrame);
      sendLocalJoystickMask(0);
    };
  }, [inputCaptured, sendLocalJoystickMask]);

  useEffect(() => {
    function handleGamepadConnected(event) {
      gamepadIndexRef.current = event.gamepad.index;
      addLog(`Gamepad connected: ${event.gamepad.id}`);
    }

    function handleGamepadDisconnected(event) {
      if (gamepadIndexRef.current === event.gamepad.index) {
        gamepadIndexRef.current = null;
        sendLocalJoystickMask(0);
      }

      addLog('Gamepad disconnected');
    }

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [addLog, sendLocalJoystickMask]);

  useEffect(() => {
    if (isHost !== false || !inputCaptured) {
      return undefined;
    }

    const sendSnapshot = () => {
      const mask = localJoystickMaskRef.current;
      const channel = dataChannelRef.current;

      if (channel?.readyState !== 'open') return;

      inputSequenceRef.current += 1;
      channel.send(JSON.stringify({
        type: 'input_state',
        player: currentPartyPlayerNumber,
        sessionId: inputSessionIdRef.current,
        seq: inputSequenceRef.current,
        mask,
        ts: performance.now(),
      }));
    };

    const snapshotTimer = window.setInterval(sendSnapshot, 33);
    sendSnapshot();

    return () => {
      window.clearInterval(snapshotTimer);
    };
  }, [currentPartyPlayerNumber, inputCaptured, isHost]);

  useEffect(() => {
    if (isHost !== true) {
      return undefined;
    }

    const staleRemoteInputTimer = window.setInterval(() => {
      if (isMultiPeerParty) {
        for (const peer of partyHostPeersRef.current.values()) {
          if (!peer.joystickMask) continue;
          if (!peer.lastInputAt) continue;
          if (performance.now() - peer.lastInputAt < 180) continue;

          addInputDebug(`P${peer.playerNumber} input timed out, releasing held input`, 0, 'guest remote');
          if (isCpcParty) {
            releaseCpcPartySharedInput(peer.joystickMask);
          } else {
            forwardInputToEmulator({
              type: 'amstrad_remote_joystick',
              player: peer.playerNumber,
              mask: 0,
            });
          }
          peer.joystickMask = 0;
        }
        return;
      }

      if (remoteJoystickMaskRef.current === 0) return;
      if (!lastRemoteInputAtRef.current) return;
      if (performance.now() - lastRemoteInputAtRef.current < 180) return;

      const previousMask = remoteJoystickMaskRef.current;

      addInputDebug('guest input timed out, releasing held input', 0, 'guest remote');
      if (isDirectJoystickSystem) {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 2,
          mask: 0,
        });
      } else {
        forwardJoystickMaskAsKeys(0, isCpcParty ? 1 : 2, previousMask);
      }
      remoteJoystickMaskRef.current = 0;
    }, 90);

    return () => {
      window.clearInterval(staleRemoteInputTimer);
    };
  }, [addInputDebug, forwardInputToEmulator, forwardJoystickMaskAsKeys, isCpcParty, isDirectJoystickSystem, isHost, isMultiPeerParty, releaseCpcPartySharedInput]);

  useEffect(() => {
    if (isHost !== true || isDirectJoystickSystem) {
      return undefined;
    }

    const pumpRemoteHeldKeys = window.setInterval(() => {
      if (isCpcParty) {
        const activePeer = Array.from(partyHostPeersRef.current.values()).find((peer) => peer.playerNumber === activePartyPlayer);
        const mask = activePeer?.joystickMask || 0;

        if (!mask) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: 1,
          mask: mask & 31,
        });
        return;
      }

      const mask = remoteJoystickMaskRef.current;

      if (!mask) return;

      joystickMaskToKeys(mask, 2).forEach(([key, , active]) => {
        if (!active) return;

        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 2,
          key,
          action: 'down',
        });
      });
    }, 50);

    return () => {
      window.clearInterval(pumpRemoteHeldKeys);
    };
  }, [activePartyPlayer, forwardInputToEmulator, isCpcParty, isDirectJoystickSystem, isHost]);

  useEffect(() => {
    if (isHost !== false) {
      return undefined;
    }

    function releaseGuestInput() {
      sendLocalJoystickMask(0);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        releaseGuestInput();
      }
    }

    window.addEventListener('blur', releaseGuestInput);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', releaseGuestInput);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isHost, sendLocalJoystickMask]);

  const handleGuestPayloadOnHost = useCallback((rawMessage, partyPlayerOverride = null, partyPeerState = null) => {
    try {
      const parsed = JSON.parse(rawMessage);
      addInputDebug(`host received ${formatInputPayload(parsed)}`, parsed.mask ?? null, 'guest remote');

      const getRemoteMask = () => (partyPeerState ? partyPeerState.joystickMask || 0 : remoteJoystickMaskRef.current);
      const setRemoteMask = (mask) => {
        if (partyPeerState) {
          partyPeerState.joystickMask = mask;
        } else {
          remoteJoystickMaskRef.current = mask;
        }
      };
      const getLastSession = () => (partyPeerState ? partyPeerState.lastSession || '' : lastRemoteInputSessionRef.current);
      const setLastSession = (sessionId) => {
        if (partyPeerState) {
          partyPeerState.lastSession = sessionId;
        } else {
          lastRemoteInputSessionRef.current = sessionId;
        }
      };
      const getLastSeq = () => (partyPeerState ? partyPeerState.lastSeq || 0 : lastRemoteInputSeqRef.current);
      const setLastSeq = (seq) => {
        if (partyPeerState) {
          partyPeerState.lastSeq = seq;
        } else {
          lastRemoteInputSeqRef.current = seq;
        }
      };
      const markInputAt = () => {
        if (partyPeerState) {
          partyPeerState.lastInputAt = performance.now();
        } else {
          lastRemoteInputAtRef.current = performance.now();
        }
      };
      const getInputPlayer = (fallbackPlayer = parsed.player) => {
        if (partyPeerState) return partyPlayerOverride || 2;
        if (isCpcParty) return partyPlayerOverride || 2;
        return fallbackPlayer;
      };

      if (parsed.type === 'key') {
        const player = getInputPlayer(parsed.player);

        if (isCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest key, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        if (isAtari8) {
          forwardInputToEmulator({
            type: 'atari8_keyboard',
            action: parsed.action,
            key: parsed.key,
            code: parsed.code || '',
          });
          return;
        }

        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: isCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'control') {
        const player = getInputPlayer(parsed.player);

        if (isCpcParty && activePartyPlayer !== player) {
          addInputDebug(`ignored guest control, party turn is P${activePartyPlayer}`, null, 'party turn');
          return;
        }

        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`);
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          key: parsed.key,
          action: parsed.action,
          player: isCpcParty ? 1 : player,
        });
      }

      if (parsed.type === 'audio_unlock') {
        addInputDebug('guest requested host audio unlock', null, 'guest remote');
        forwardInputToEmulator({
          type: 'amstrad_audio_unlock',
        });
      }

      if (parsed.type === 'amiga_mouse_button' || parsed.type === 'amiga_mouse_move') {
        addInputDebug(`forward to emulator ${formatInputPayload(parsed)}`, null, 'guest mouse');
        forwardInputToEmulator(parsed);
      }

      if (parsed.type === 'input_state') {
        const player = getInputPlayer(parsed.player === 2 ? 2 : 1);
        const mask = parsed.mask | 0;
        const seq = Number(parsed.seq) || 0;
        const sessionId = String(parsed.sessionId || 'legacy');

        if (sessionId !== getLastSession()) {
          const previousMask = getRemoteMask();

          if (previousMask) {
            if (isCpcParty) {
              releaseCpcPartySharedInput(previousMask);
            } else if (isDirectJoystickSystem) {
              forwardInputToEmulator({
                type: 'amstrad_remote_joystick',
                player,
                mask: 0,
              });
            } else {
              forwardJoystickMaskAsKeys(0, player, previousMask);
            }
          }

          setLastSession(sessionId);
          setLastSeq(0);
          setRemoteMask(0);
          addInputDebug(`guest input session ${sessionId}`, 0, 'guest remote');
        }

        if (seq && seq <= getLastSeq()) {
          addInputDebug(`ignored old P${player} state #${seq}`, getRemoteMask(), 'guest remote');
          return;
        }

        const previousMask = getRemoteMask();

        setLastSeq(seq || getLastSeq());
        markInputAt();
        if (mask !== previousMask) {
          addInputDebug(`host received P${player} state ${mask} #${seq}`, mask, 'guest remote');
        }
        if (isCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest state, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isDirectJoystickSystem) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }

      if (parsed.type === 'joystick') {
        const player = getInputPlayer(parsed.player === 2 ? 2 : 1);
        const mask = parsed.mask | 0;
        const previousMask = getRemoteMask();

        markInputAt();
        addInputDebug(`host received P${player} held mask ${mask}`, mask, 'guest remote');
        if (isCpcParty && activePartyPlayer !== player) {
          if (previousMask) {
            releaseCpcPartySharedInput(previousMask);
          }
          setRemoteMask(0);
          addInputDebug(`ignored guest held mask, party turn is P${activePartyPlayer}`, 0, 'party turn');
          return;
        }

        if (isCpcParty) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: 1,
            mask: mask & 31,
          });
          forwardExtraButtonAsKey(mask, 1, previousMask);
        } else if (isDirectJoystickSystem) {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player,
            mask,
          });
        } else {
          forwardJoystickMaskAsKeys(mask, isCpcParty ? 1 : player, previousMask);
        }
        setRemoteMask(mask);
      }
    } catch (err) {
      addLog(`Input parse error: ${err.message}`);
      addInputDebug(`parse error ${err.message}`);
    }
  }, [activePartyPlayer, addInputDebug, addLog, forwardExtraButtonAsKey, forwardInputToEmulator, forwardJoystickMaskAsKeys, isAtari8, isCpcParty, isDirectJoystickSystem, releaseCpcPartySharedInput]);

  useEffect(() => {
    handleGuestPayloadOnHostRef.current = handleGuestPayloadOnHost;
  }, [handleGuestPayloadOnHost]);

  const onSignalMessage = useCallback(async (message) => {
    if (message.to && message.to !== signalingClientIdRef.current) {
      return;
    }

    if (message.type === 'system') {
      addLog(message.message);
      return;
    }

    if (message.type === 'room-chat') {
      setChatMessages((items) => [...items.slice(-99), {
        id: message.id || `${Date.now()}-${Math.random()}`,
        username: message.username || 'Player',
        message: String(message.message || '').slice(0, 300),
        time: message.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        mine: false,
      }]);
      return;
    }

    if (message.type === 'room-system-changed' && message.room) {
      applyRoomSystemUpdate(message.room, `${message.username || 'Host'} switched the room`);
      return;
    }

    if (message.type === 'party-room-full') {
      setStatus('Party room full');
      setError('This party room has no free live player slots.');
      addLog('Party room full');
      return;
    }

    if (message.type === 'party-assigned') {
      setPartyPlayerNumber(message.playerNumber || null);
      addLog(`Assigned party player P${message.playerNumber}`);
      return;
    }

    if (message.type === 'party-turn') {
      setActivePartyPlayer(message.playerNumber || 1);
      addInputDebug(`party turn is P${message.playerNumber || 1}`, 0, 'party turn');
      return;
    }

    if (isHost && isMultiPeerParty) {
      if (message.type === 'peer-ready' && message.role === 'guest') {
        await createPartyPeerForGuest(message);
        return;
      }

      if (message.type === 'answer') {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party answer from unknown guest');
          return;
        }

        await peer.pc.setRemoteDescription(message.answer);

        const candidates = peer.pendingIceCandidates;
        peer.pendingIceCandidates = [];
        for (const candidate of candidates) {
          try {
            await peer.pc.addIceCandidate(candidate);
            addLog(`Added queued ICE candidate for P${peer.playerNumber}`);
          } catch (err) {
            addLog(`Party ICE error: ${err.message}`);
          }
        }

        addLog(`Received answer from P${peer.playerNumber}`);
        return;
      }

      if (message.type === 'ice-candidate' && message.candidate) {
        const peer = partyHostPeersRef.current.get(message.from);
        if (!peer) {
          addLog('Ignored party ICE from unknown guest');
          return;
        }

        if (!peer.pc.remoteDescription) {
          peer.pendingIceCandidates.push(message.candidate);
          addLog(`Queued ICE candidate for P${peer.playerNumber}`);
          return;
        }

        try {
          await peer.pc.addIceCandidate(message.candidate);
          addLog(`Added ICE candidate for P${peer.playerNumber}`);
        } catch (err) {
          addLog(`Party ICE error: ${err.message}`);
        }
        return;
      }

      return;
    }

    if (message.type === 'peer-ready') {
      if (message.role === 'host') {
        setHostDisplayName(message.username || 'Host');
      }

      if (message.role === 'guest') {
        setGuestDisplayName(message.username || 'Guest');
      }
    }

    const pc = pcRef.current;

    if (!pc) {
      addLog('Signal received before peer connection existed');
      return;
    }

    async function flushPendingIceCandidates() {
      if (!pc.remoteDescription) return;
      if (pendingIceCandidatesRef.current.length === 0) return;

      const candidates = pendingIceCandidatesRef.current;
      pendingIceCandidatesRef.current = [];

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(candidate);
          addLog('Added queued ICE candidate');
        } catch (err) {
          addLog(`ICE error: ${err.message}`);
        }
      }
    }

    if (message.type === 'peer-ready') {
      if (isHost && message.role === 'guest') {
        if (!activeGuestSignalIdRef.current && message.from) {
          activeGuestSignalIdRef.current = message.from;
          activePeerSignalIdRef.current = message.from;
          addLog(`Live guest slot assigned to ${message.username || 'guest'}`);
        }

        if (activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
          sendSignalRef.current({
            type: 'live-slot-taken',
            to: message.from,
          });
          addLog(`Ignored extra guest ${message.username || message.from}`);
          return;
        }
      }

      if (isHost && localOfferRef.current && (!activeGuestSignalIdRef.current || message.from === activeGuestSignalIdRef.current)) {
        const sent = sendSignalRef.current({
          type: 'offer',
          to: activeGuestSignalIdRef.current || undefined,
          offer: localOfferRef.current,
        });

        addLog(sent ? 'Re-sent offer to ready guest' : 'Queued offer for ready guest');
      }

      return;
    }

    if (message.type === 'offer') {
      addLog('Received offer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      await pc.setRemoteDescription(message.offer);
      await flushPendingIceCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      sendSignalRef.current({
        type: 'answer',
        to: message.from || undefined,
        answer: pc.localDescription,
      });

      addLog('Sent answer');
      setStatus('Answer sent');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('Microphone');
      }
      return;
    }

    if (message.type === 'answer') {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored answer from extra guest');
        return;
      }

      addLog('Received answer');
      if (message.from) {
        activePeerSignalIdRef.current = message.from;
      }

      await pc.setRemoteDescription(message.answer);
      await flushPendingIceCandidates();
      setStatus('Peer connected');

      if (micRenegotiationNeededRef.current && pc.signalingState === 'stable') {
        micRenegotiationNeededRef.current = false;
        await renegotiatePeerConnection('microphone');
      }
      return;
    }

    if (message.type === 'ice-candidate' && message.candidate) {
      if (isHost && activeGuestSignalIdRef.current && message.from && message.from !== activeGuestSignalIdRef.current) {
        addLog('Ignored ICE candidate from extra guest');
        return;
      }

      if (!pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(message.candidate);
        addLog('Queued ICE candidate until remote description');
        return;
      }

      try {
        await pc.addIceCandidate(message.candidate);
        addLog('Added ICE candidate');
      } catch (err) {
        addLog(`ICE error: ${err.message}`);
      }
    }
  }, [addLog, isHost, isMultiPeerParty, partyMaxPlayers]);

  const { send: sendSignal, isOpen: signalingOpen } = useSignaling(isSoloMode ? null : roomCode, onSignalMessage, signalingClientIdRef.current);

  function sendChatMessage(message) {
    if (!signalingOpen || isSoloMode) return;
    const chatMessage = {
      type: 'room-chat',
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      username: username || 'Player',
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    sendSignal(chatMessage);
    setChatMessages((items) => [...items.slice(-99), { ...chatMessage, mine: true }]);
  }

  async function switchRoomSystem() {
    if (!room || !isHost || isSoloMode || switchingSystem || selectedRoomSystem === roomSystem) return;

    setSwitchingSystem(true);
    try {
      setError('');
      const nextPartyMax = selectedRoomSystem === 'cpc_party'
        ? Math.max(3, partyMaxPlayers || 4)
        : selectedRoomSystem === 'arcade'
          ? partyMaxPlayers || 2
          : 2;
      const nextRoom = await apiFetch(`/rooms/${roomCode}`, {
        method: 'PATCH',
        body: JSON.stringify({
          system: selectedRoomSystem,
          party_max_players: nextPartyMax,
        }),
      });

      applyRoomSystemUpdate(nextRoom, 'Room switched');
      sendSignal({
        type: 'room-system-changed',
        username: username || 'Host',
        room: nextRoom,
      });
    } catch (err) {
      setError(err.message);
      addLog(`Room switch failed: ${err.message}`);
    } finally {
      setSwitchingSystem(false);
    }
  }

  const displayedPlayers = isSoloMode
    ? [
      {
        playerNumber: 1,
        username: username || playerOneName,
        role: 'Solo',
        connected: true,
      },
    ]
    : isMultiPeerParty
    ? partyRoster
    : [
      {
        playerNumber: 1,
        username: playerOneName,
        role: 'Host',
        connected: Boolean(hostDisplayName),
      },
      {
        playerNumber: 2,
        username: playerTwoName,
        role: 'Guest',
        connected: Boolean(guestDisplayName),
      },
    ];
  const healthItems = isAmigaLink
    ? [
      {
        label: 'Signaling',
        ok: signalingOpen,
      },
      {
        label: 'Serial link',
        ok: serialChannelRef.current?.readyState === 'open',
      },
      {
        label: 'Local Amiga',
        ok: hostStarted,
      },
    ]
    : isSoloMode
    ? [
      {
        label: 'Local mode',
        ok: true,
      },
      {
        label: 'Emulator',
        ok: hostStarted,
      },
    ]
    : [
      {
        label: 'Signaling',
        ok: signalingOpen,
      },
      {
        label: isMultiPeerParty ? 'Players' : 'Peer',
        ok: remoteConnected,
      },
      {
        label: isHost ? 'Host stream' : 'Guest link',
        ok: isHost ? hostStarted : guestPrepared,
      },
    ];
  const selectedControlPlayers = useMemo(() => {
    if (!selectedControlProfile?.players) return [];

    return Object.entries(selectedControlProfile.players).map(([playerKey, player]) => {
      const emulatorInput = player?.emulatorInput || {};
      const displayOverlay = player?.displayOverlay || {};
      const directionEntries = CONTROL_DIRECTIONS.map(([action, label]) => ({
        action,
        label,
        key: formatControlValue(emulatorInput[action]),
        detail: displayOverlay[action] || '',
      }));
      const utilityEntries = CONTROL_UTILITY_ACTIONS
        .filter((action) => emulatorInput[action] || displayOverlay[action])
        .map((action) => ({
          action,
          label: formatControlAction(action),
          key: formatControlValue(emulatorInput[action]),
          detail: displayOverlay[action] || '',
        }));
      const overlayEntries = Object.entries(displayOverlay)
        .filter(([action, value]) => value && !CONTROL_DIRECTIONS.some(([direction]) => direction === action) && !CONTROL_UTILITY_ACTIONS.includes(action))
        .map(([action, value]) => [formatControlAction(action), value]);

      return {
        key: playerKey,
        label: playerKey.replace('player', 'Player '),
        directionEntries,
        utilityEntries,
        overlayEntries,
        hasInput: directionEntries.some((entry) => entry.key || entry.detail) || utilityEntries.length || overlayEntries.length,
      };
    });
  }, [selectedControlProfile]);

  useEffect(() => {
    sendSignalRef.current = sendSignal;
  }, [sendSignal]);

  useEffect(() => {
    loadedDiskNameRef.current = loadedDiskName;
    if (!room || !isHost) return;

    apiFetch(`/rooms/${roomCode}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ game_name: loadedDiskName || null }),
    }).catch(() => {});
  }, [isHost, loadedDiskName, room, roomCode]);

  useEffect(() => {
    async function loadRoom() {
      try {
        const data = await apiFetch(`/rooms/${roomCode}`);
        setRoom(data);
        setStatus('Room ready');
      } catch (err) {
        setError(err.message);
      }
    }

    loadRoom();
  }, [roomCode]);

  useEffect(() => {
    if (!room) return undefined;

    let cancelled = false;
    const sendHeartbeat = async () => {
      try {
        await apiFetch(`/rooms/${roomCode}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({
            game_name: isHost ? loadedDiskNameRef.current || null : null,
          }),
        });
      } catch (err) {
        if (!cancelled) {
          addLog(`Room activity update failed: ${err.message}`);
        }
      }
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      apiFetch(`/rooms/${roomCode}/heartbeat`, { method: 'DELETE' }).catch(() => {});
    };
  }, [addLog, isHost, room, roomCode]);

  useEffect(() => {
    if (!isSoloMode && signalingOpen) {
      addLog('Signaling socket open');
    }
  }, [isSoloMode, signalingOpen, addLog]);

  useEffect(() => {
    if (isSoloMode || !signalingOpen || !room) {
      return;
    }

    sendSignal({
      type: 'peer-ready',
      role: isHost ? 'host' : 'guest',
      username,
    });
  }, [isHost, isSoloMode, room, sendSignal, signalingOpen, username]);

  useEffect(() => {
    if (isSoloMode) {
      pcRef.current = null;
      return () => {
        if (mirrorLoopRef.current) {
          cancelAnimationFrame(mirrorLoopRef.current);
        }

        localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
        localMicStreamRef.current = null;
        localMicSenderRef.current = null;
        hostVideoStreamRef.current = null;
        hostAudioStreamRef.current = null;
        dataChannelRef.current?.close();
      };
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const sent = sendSignalRef.current({
          type: 'ice-candidate',
          to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
          candidate: event.candidate,
        });

        addLog(sent ? 'Sent ICE candidate' : 'Queued ICE candidate');
      }
    };

    pc.onconnectionstatechange = () => {
      setStatus(`Connection state: ${pc.connectionState}`);
      addLog(`PC state: ${pc.connectionState}`);

      if (pc.connectionState === 'connected') {
        setRemoteConnected(true);
      }

      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setRemoteConnected(false);
        if (isHostRef.current && !isMultiPeerParty) {
          activeGuestSignalIdRef.current = '';
          activePeerSignalIdRef.current = '';
          pendingIceCandidatesRef.current = [];
          localOfferRef.current = null;
          setGuestDisplayName('');
          setGuestPrepared(false);
          guestPreparedRef.current = false;
          if (pc.connectionState === 'failed') {
            pcRef.current?.close();
            pcRef.current = null;
            setHostStarted(false);
            hostStartedRef.current = false;
            hostStartingRef.current = false;
            setRoomSessionKey((key) => key + 1);
            setStatus('Guest left. Start host session again when the next player joins.');
          }
        }
      }
    };

    pc.ontrack = (event) => {
      if (event.track.kind === 'audio' && isHostRef.current) {
        if (!remoteVoiceStreamRef.current) {
          remoteVoiceStreamRef.current = new MediaStream();
        }

        const voiceStream = remoteVoiceStreamRef.current;
        const hasVoiceTrack = voiceStream.getTracks().some((track) => track.id === event.track.id);

        if (!hasVoiceTrack) {
          voiceStream.addTrack(event.track);
        }

        if (remoteVoiceAudioRef.current && remoteVoiceAudioRef.current.srcObject !== voiceStream) {
          remoteVoiceAudioRef.current.srcObject = voiceStream;
          remoteVoiceAudioRef.current.volume = 1;
          remoteVoiceAudioRef.current.play().catch(() => {
            addLog('Guest mic is connected; press Capture if audio is blocked');
          });
        }

        addLog('Remote microphone track attached');
        return;
      }

      if (!remoteMediaStreamRef.current) {
        remoteMediaStreamRef.current = new MediaStream();
      }

      const remoteStream = remoteMediaStreamRef.current;
      const hasTrack = remoteStream.getTracks().some((track) => track.id === event.track.id);

      if (!hasTrack) {
        remoteStream.addTrack(event.track);
      }

      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }

      addLog(`Remote ${event.track.kind} track attached`);
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (isAmigaLink && channel.label === 'amiga-serial') {
        configureSerialChannel(channel);
        return;
      }

      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Input data channel open');
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data);
    };

    return () => {
      if (mirrorLoopRef.current) {
        cancelAnimationFrame(mirrorLoopRef.current);
      }

      localMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      localMicStreamRef.current = null;
      localMicSenderRef.current = null;
      remoteVoiceAudioRef.current?.pause();
      remoteVoiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteVoiceStreamRef.current = null;
      for (const [guestId] of partyHostPeersRef.current) {
        closePartyPeer(guestId);
      }
      partyHostPeersRef.current.clear();
      pendingPartyGuestsRef.current.clear();
      hostVideoStreamRef.current = null;
      hostAudioStreamRef.current = null;
      dataChannelRef.current?.close();
      serialChannelRef.current?.close();
      serialChannelRef.current = null;
      serialOfferStartedRef.current = false;
      pc.close();
    };
  }, [addLog, configureSerialChannel, isAmigaLink, isMultiPeerParty, isSoloMode, roomSessionKey]);

  useEffect(() => {
    if (!isAmigaLink || !isHost || !signalingOpen || !room || serialOfferStartedRef.current) return;

    const pc = pcRef.current;
    if (!pc) return;

    serialOfferStartedRef.current = true;
    const channel = pc.createDataChannel('amiga-serial');
    configureSerialChannel(channel);

    async function createSerialOffer() {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);
        localOfferRef.current = pc.localDescription;
        const sent = sendSignalRef.current({
          type: 'offer',
          to: activeGuestSignalIdRef.current || undefined,
          offer: localOfferRef.current,
        });
        addLog(sent ? 'Amiga serial offer sent' : 'Amiga serial offer queued');
        setStatus('Waiting for linked Amiga');
      } catch (err) {
        serialOfferStartedRef.current = false;
        setError(err.message);
        addLog(`Amiga serial link error: ${err.message}`);
      }
    }

    createSerialOffer();
  }, [addLog, configureSerialChannel, isAmigaLink, isHost, room, signalingOpen]);

  useEffect(() => {
    if (!canControlLocalEmulator) return undefined;

    function handleHostKeyDown(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host Amiga key ${event.code} down`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'down',
        });

        event.preventDefault();
        return;
      }

      if (isAtari8) {
        if (event.repeat) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host Atari key ${event.code} down`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'atari8_keyboard',
          action: 'down',
          key: event.key,
          code: event.code,
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isCpcParty && activePartyPlayer !== 1) {
          addInputDebug(`ignored host key, party turn is P${activePartyPlayer}`, null, 'party turn');
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} down -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 1,
          key: mappedKey || key,
          action: 'down',
        });

        event.preventDefault();
      }
    }

    function handleHostKeyUp(event) {
      if (!shouldHandleHostKey(event)) return;

      const key = getKeyboardKey(event);
      if (isAmigaFamily) {
        addInputDebug(`host Amiga key ${event.code} up`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amiga_keyboard',
          player: 1,
          code: event.code,
          key: event.key,
          action: 'up',
        });

        event.preventDefault();
        return;
      }

      if (isAtari8) {
        addInputDebug(`host Atari key ${event.code} up`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'atari8_keyboard',
          action: 'up',
          key: event.key,
          code: event.code,
        });

        event.preventDefault();
        return;
      }

      const mappedKey = hostKeyToCpcKeyboardKey(key);

      if (mappedKey || isMenuKey(key)) {
        if (isCpcParty && activePartyPlayer !== 1) {
          event.preventDefault();
          return;
        }

        addInputDebug(`host key ${key} up -> ${mappedKey || key}`, null, 'host keyboard');
        forwardInputToEmulator({
          type: 'amstrad_remote_control',
          player: 1,
          key: mappedKey || key,
          action: 'up',
        });

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleHostKeyDown, true);
    window.addEventListener('keyup', handleHostKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleHostKeyDown, true);
      window.removeEventListener('keyup', handleHostKeyUp, true);
    };
  }, [activePartyPlayer, addInputDebug, canControlLocalEmulator, forwardInputToEmulator, isAmigaFamily, isAtari8, isCpcParty, isHost]);

  useEffect(() => {
    if (isHost !== false || isAmigaLink) return undefined;

    let guestJoystickMask = 0;

    function sendToHost(payload) {
      const channel = dataChannelRef.current;

      if (!channel || channel.readyState !== 'open') {
        return false;
      }

      channel.send(JSON.stringify(payload));
      return true;
    }

    function handleGuestKeyDown(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        if (event.repeat) {
          addInputDebug(`ignored repeat ${key}`, guestJoystickMask, 'guest keyboard');
          event.preventDefault();
          return;
        }

        guestJoystickMask |= joyBit;
        addInputDebug(`guest key ${key} down`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          code: event.code,
          action: 'down',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    function handleGuestKeyUp(event) {
      if (!shouldHandleKey(event)) return;
      if (!inputCaptured) return;

      const key = getKeyboardKey(event);
      const joyBit = keyToJoystickBit(key);

      if (joyBit) {
        guestJoystickMask &= ~joyBit;
        addInputDebug(`guest key ${key} up`, guestJoystickMask, 'guest keyboard');

        sendLocalJoystickMask(guestJoystickMask);

        event.preventDefault();
        return;
      }

      if (isGuestKeyboardKey(key)) {
        const payload = {
          type: 'key',
          player: 2,
          key,
          code: event.code,
          action: 'up',
        };

        addInputDebug(`guest send ${formatInputPayload(payload)}`);
        sendToHost(payload);

        event.preventDefault();
      }
    }

    window.addEventListener('keydown', handleGuestKeyDown);
    window.addEventListener('keyup', handleGuestKeyUp);

    return () => {
      window.removeEventListener('keydown', handleGuestKeyDown);
      window.removeEventListener('keyup', handleGuestKeyUp);
    };
  }, [addInputDebug, isAmigaLink, isHost, inputCaptured, sendLocalJoystickMask]);

  function startMirrorLoop(sourceCanvas) {
    const mirrorCanvas = mirrorCanvasRef.current;

    if (!mirrorCanvas) {
      throw new Error('Mirror canvas not found');
    }

    if (isArcade) {
      mirrorCanvas.width = 768;
      mirrorCanvas.height = 576;
    } else if (isCpcPinball) {
      // CPCBox renders double-height CPC pixels into a 768x272 framebuffer.
      // Restore their display aspect in the room mirror and outgoing stream.
      mirrorCanvas.width = 768;
      mirrorCanvas.height = 544;
    } else {
      mirrorCanvas.width = sourceCanvas.width || 768;
      mirrorCanvas.height = sourceCanvas.height || 544;
    }

    const ctx = mirrorCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get mirror canvas context');
    }

    ctx.imageSmoothingEnabled = false;

    function drawContained(sourceX, sourceY, sourceWidth, sourceHeight) {
      const scale = Math.min(mirrorCanvas.width / sourceWidth, mirrorCanvas.height / sourceHeight);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const targetX = Math.round((mirrorCanvas.width - targetWidth) / 2);
      const targetY = Math.round((mirrorCanvas.height - targetHeight) / 2);

      ctx.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
      ctx.drawImage(
        sourceCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        targetX,
        targetY,
        targetWidth,
        targetHeight,
      );
    }

    const draw = () => {
      try {
        const sourceWidth = sourceCanvas.width || sourceCanvas.clientWidth;
        const sourceHeight = sourceCanvas.height || sourceCanvas.clientHeight;
        if (!sourceWidth || !sourceHeight) {
          mirrorLoopRef.current = requestAnimationFrame(draw);
          return;
        }

        if (isArcade) {
          drawContained(0, 0, sourceWidth, sourceHeight);
        } else {
          ctx.drawImage(sourceCanvas, 0, 0, mirrorCanvas.width, mirrorCanvas.height);
        }
      } catch {
        // ignore transient draw issues
      }

      mirrorLoopRef.current = requestAnimationFrame(draw);
    };

    draw();
    addLog('Mirror canvas loop started');
  }

  function findCanvasInDocument(doc, depth = 0) {
    if (!doc || depth > 3) return null;

    if (isAtariSt) {
      const nativeAtariCanvas = doc.querySelector('#game canvas');
      if (
        nativeAtariCanvas
        && nativeAtariCanvas.width > 0
        && nativeAtariCanvas.height > 0
      ) {
        return nativeAtariCanvas;
      }
    }

    if (isNes) {
      const nesWindow = doc.defaultView || doc.parentWindow;
      const nativeNesCanvas = nesWindow?.EJS_emulator?.canvas || doc.querySelector('#game canvas.ejs_canvas');
      if (
        nativeNesCanvas
        && nativeNesCanvas.width > 0
        && nativeNesCanvas.height > 0
      ) {
        return nativeNesCanvas;
      }
    }

    const frames = Array.from(doc.querySelectorAll('iframe'));
    for (const frame of frames) {
      try {
        const nestedDoc = frame.contentDocument || frame.contentWindow?.document;
        const nestedCanvas = findCanvasInDocument(nestedDoc, depth + 1);
        if (nestedCanvas) return nestedCanvas;
      } catch {
        // Cross-origin frames cannot be captured into our mirror canvas.
      }
    }

    const canvases = Array.from(doc.querySelectorAll('canvas'));
    const canvas = canvases.find((candidate) => (
      candidate.id !== 'placeholder-canvas'
      && (!isAtariSt || candidate.id !== 'atarist-screen')
      && (!isArcade || candidate.id !== 'arcade-screen')
      && candidate.dataset.ignoreCapture !== 'true'
      && candidate.width > 0
      && candidate.height > 0
    ));

    if (canvas) return canvas;

    return null;
  }

  async function waitForEmulatorCanvas(iframe) {
    const startedAt = Date.now();
    const canvasTimeout = isAmigaFamily ? 30000 : 8000;

    while (Date.now() - startedAt < canvasTimeout) {
      const iframeDocument = iframe.contentDocument || iframe.contentWindow?.document;
      const emulatorCanvas = findCanvasInDocument(iframeDocument);

      if (emulatorCanvas) {
        return emulatorCanvas;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    throw new Error('Could not find emulator canvas in iframe');
  }

  function getHostAudioStream(iframe) {
    if (isAmigaAga) return iframe.contentWindow?.getAmigaAgaAudioStream?.() || null;
    if (isAmiga) return iframe.contentWindow?.getAmigaAudioStream?.() || null;
    if (isSegaConsole) return iframe.contentWindow?.getMegaDriveAudioStream?.() || null;
    if (isNes) return iframe.contentWindow?.getNesAudioStream?.() || null;
    if (isSnes) return iframe.contentWindow?.getSnesAudioStream?.() || null;
    if (isPcEngine) return iframe.contentWindow?.getPcEngineAudioStream?.() || null;
    if (isPlayStation) return iframe.contentWindow?.getPlayStationAudioStream?.() || null;
    if (isC64) return iframe.contentWindow?.getC64AudioStream?.() || null;
    if (isAtari8) return null;
    if (isAtariSt) return iframe.contentWindow?.getAtariStAudioStream?.() || null;
    if (isArcade) return iframe.contentWindow?.getArcadeAudioStream?.() || null;
    if (isSpectrum) return iframe.contentWindow?.getSpectrumAudioStream?.() || null;
    return iframe.contentWindow?.getAmstradAudioStream?.() || null;
  }

  async function waitForHostAudioStream(iframe) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 3000) {
      const audioStream = getHostAudioStream(iframe);

      if (audioStream?.getAudioTracks?.().length > 0) {
        return audioStream;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    return getHostAudioStream(iframe);
  }

  function getNextPartyPlayerNumber() {
    const usedPlayers = new Set(
      Array.from(partyHostPeersRef.current.values()).map((peer) => peer.playerNumber),
    );

    for (let playerNumber = 2; playerNumber <= partyMaxPlayers; playerNumber += 1) {
      if (!usedPlayers.has(playerNumber)) return playerNumber;
    }

    return null;
  }

  function refreshPartyRoster() {
    const players = [
      {
        playerNumber: 1,
        username: username || 'Host',
        connected: true,
        role: 'Host',
      },
      ...Array.from(partyHostPeersRef.current.values())
        .map((peer) => ({
          playerNumber: peer.playerNumber,
          username: peer.username || `Player ${peer.playerNumber}`,
          connected: ['connected', 'completed'].includes(peer.pc?.iceConnectionState) || peer.pc?.connectionState === 'connected',
          role: 'Guest',
        }))
        .sort((a, b) => a.playerNumber - b.playerNumber),
    ];

    setPartyRoster(players);
  }

  function closePartyPeer(guestId) {
    const peer = partyHostPeersRef.current.get(guestId);
    if (!peer) return;

    if (peer.joystickMask) {
      if (isCpcParty) {
        releaseCpcPartySharedInput(peer.joystickMask);
      } else {
        forwardInputToEmulator({
          type: 'amstrad_remote_joystick',
          player: peer.playerNumber,
          mask: 0,
        });
      }
    }

    peer.channel?.close();
    peer.pc?.close();
    partyHostPeersRef.current.delete(guestId);
    refreshPartyRoster();
    setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));
  }

  async function createPartyPeerForGuest(guestMessage) {
    const guestId = guestMessage.from;
    if (!guestId || !isMultiPeerParty || !isHost) return;

    const existingPeer = partyHostPeersRef.current.get(guestId);
    if (existingPeer?.offer) {
      sendSignalRef.current({
        type: 'offer',
        to: guestId,
        offer: existingPeer.offer,
      });
      addLog(`Re-sent party offer to P${existingPeer.playerNumber}`);
      return;
    }

    if (!hostVideoStreamRef.current) {
      pendingPartyGuestsRef.current.set(guestId, guestMessage);
      addLog(`Queued party guest ${guestMessage.username || guestId} until stream starts`);
      return;
    }

    const playerNumber = getNextPartyPlayerNumber();
    if (!playerNumber) {
      sendSignalRef.current({
        type: 'party-room-full',
        to: guestId,
      });
      addLog(`Party room full; rejected ${guestMessage.username || guestId}`);
      return;
    }

    const pc = new RTCPeerConnection(buildRtcConfig());
    const peerState = {
      pc,
      channel: null,
      playerNumber,
      joystickMask: 0,
      lastInputAt: 0,
      lastSeq: 0,
      lastSession: '',
      pendingIceCandidates: [],
      offer: null,
      username: guestMessage.username || `Player ${playerNumber}`,
    };

    partyHostPeersRef.current.set(guestId, peerState);
    refreshPartyRoster();

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignalRef.current({
        type: 'ice-candidate',
        to: guestId,
        candidate: event.candidate,
      });
    };

    pc.onconnectionstatechange = () => {
      addLog(`P${playerNumber} connection: ${pc.connectionState}`);
      refreshPartyRoster();
      setRemoteConnected(Array.from(partyHostPeersRef.current.values()).some((item) => item.pc?.connectionState === 'connected'));

      if (['failed', 'closed'].includes(pc.connectionState)) {
        closePartyPeer(guestId);
      }
    };

    hostVideoStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, hostVideoStreamRef.current);
    });

    hostAudioStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, hostAudioStreamRef.current);
    });

    const channel = pc.createDataChannel('inputs');
    peerState.channel = channel;

    channel.onopen = () => {
      peerState.joystickMask = 0;
      peerState.lastInputAt = 0;
      peerState.lastSeq = 0;
      peerState.lastSession = '';
      addLog(`P${playerNumber} input data channel open`);
    };
    channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data, playerNumber, peerState);
    channel.onclose = () => {
      if (peerState.joystickMask) {
        if (isCpcParty) {
          releaseCpcPartySharedInput(peerState.joystickMask);
        } else {
          forwardInputToEmulator({
            type: 'amstrad_remote_joystick',
            player: playerNumber,
            mask: 0,
          });
        }
      }
      peerState.joystickMask = 0;
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);
    peerState.offer = pc.localDescription;

    sendSignalRef.current({
      type: 'party-assigned',
      to: guestId,
      playerNumber,
    });

    sendSignalRef.current({
      type: 'offer',
      to: guestId,
      offer: peerState.offer,
    });

    addLog(`Party guest ${peerState.username} assigned P${playerNumber}`);
    refreshPartyRoster();
    setStatus(`Party host ready: ${partyHostPeersRef.current.size} guest(s) connected`);
  }

  async function connectPendingPartyGuests() {
    if (!isMultiPeerParty || !isHost || !hostVideoStreamRef.current) return;

    const pendingGuests = Array.from(pendingPartyGuestsRef.current.values());
    pendingPartyGuestsRef.current.clear();

    for (const guestMessage of pendingGuests) {
      await createPartyPeerForGuest(guestMessage);
    }
  }

  async function renegotiatePeerConnection(reason = 'voice') {
    const pc = pcRef.current;

    if (!pc || !pc.remoteDescription || pc.signalingState !== 'stable') {
      micRenegotiationNeededRef.current = true;
      addLog(`${reason} will connect when the peer connection is ready`);
      return;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    if (isHostRef.current) {
      localOfferRef.current = pc.localDescription;
    }

    const sent = sendSignalRef.current({
      type: 'offer',
      to: isHostRef.current ? activeGuestSignalIdRef.current || undefined : activePeerSignalIdRef.current || undefined,
      offer: pc.localDescription,
    });

    addLog(sent ? `${reason} offer sent` : `${reason} offer queued`);
  }

  async function refreshMicrophoneDevices() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));

      setMicDevices(audioInputs);
    } catch (err) {
      addLog(`Microphone device list error: ${err.message}`);
    }
  }

  async function openMicrophone(deviceId = '') {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus('Mic unavailable');
      setError('This browser cannot use the microphone here.');
      addLog('Microphone is not available in this browser');
      return;
    }

    let nextStream = null;

    try {
      setMicStatus(deviceId ? 'Switching mic...' : 'Opening mic...');
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const [track] = nextStream.getAudioTracks();

      if (!track) {
        throw new Error('No microphone track was provided by the browser');
      }

      const pc = pcRef.current;

      if (!pc) {
        throw new Error('Peer connection is not ready yet');
      }

      const previousStream = localMicStreamRef.current;
      const existingSender = localMicSenderRef.current;

      if (existingSender) {
        await existingSender.replaceTrack(track);
      } else {
        localMicSenderRef.current = pc.addTrack(track, nextStream);
      }

      previousStream?.getTracks().forEach((previousTrack) => previousTrack.stop());
      localMicStreamRef.current = nextStream;
      setMicEnabled(true);
      setMicMuted(false);
      setMicStatus('Mic on');
      setSelectedMicDeviceId(track.getSettings?.().deviceId || deviceId || '');
      addLog(existingSender ? 'Microphone switched' : 'Microphone enabled');
      await refreshMicrophoneDevices();

      if (!existingSender && pc.remoteDescription && pc.signalingState === 'stable') {
        await renegotiatePeerConnection('Microphone');
      } else if (!existingSender) {
        micRenegotiationNeededRef.current = true;
        addLog('Microphone will connect when the room stream is ready');
      }
    } catch (err) {
      nextStream?.getTracks().forEach((track) => track.stop());
      if (!localMicStreamRef.current) {
        localMicSenderRef.current = null;
        setMicEnabled(false);
        setMicMuted(false);
        setMicStatus('Mic blocked');
      } else {
        setMicStatus(micMuted ? 'Mic muted' : 'Mic on');
      }
      setError(err.message);
      addLog(`Microphone error: ${err.message}`);
    }
  }

  async function toggleMicrophone() {
    if (isCpcParty) return;

    const existingStream = localMicStreamRef.current;

    if (existingStream) {
      const nextMuted = !micMuted;
      existingStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      setMicMuted(nextMuted);
      setMicStatus(nextMuted ? 'Mic muted' : 'Mic on');
      addLog(nextMuted ? 'Microphone muted' : 'Microphone unmuted');
      return;
    }

    await openMicrophone(selectedMicDeviceId);
  }

  async function startHostSession() {
    if (hostStartingRef.current || hostStartedRef.current) {
      return;
    }

    hostStartingRef.current = true;

    try {
      setError('');
      const pc = pcRef.current;
      const iframe = emulatorFrameRef.current;

      if (!iframe) {
        throw new Error('Emulator frame not found');
      }

      setHostStarted(true);
      addLog('Waiting for emulator iframe');

      if (isAmiga || isAmigaLink) {
        iframe.contentWindow?.postMessage({ type: 'amiga_start' }, window.location.origin);
      }
      if (isAmigaAga) {
        iframe.contentWindow?.postMessage({ type: 'amiga_aga_start' }, window.location.origin);
      }
      if (isSegaConsole) {
        iframe.contentWindow?.postMessage({ type: 'megadrive_start' }, window.location.origin);
      }
      if (isNes) {
        iframe.contentWindow?.postMessage({ type: 'nes_start' }, window.location.origin);
      }
      if (isSnes) {
        iframe.contentWindow?.postMessage({ type: 'snes_start' }, window.location.origin);
      }
      if (isPcEngine) {
        iframe.contentWindow?.postMessage({ type: 'pcengine_start' }, window.location.origin);
      }
      if (isPlayStation) {
        iframe.contentWindow?.postMessage({ type: 'playstation_start' }, window.location.origin);
      }
      if (isC64) {
        iframe.contentWindow?.postMessage({ type: 'c64_start', soloMode: isSoloMode }, window.location.origin);
      }
      if (isAtari8) {
        iframe.contentWindow?.postMessage({ type: 'atari8_start' }, window.location.origin);
      }
      if (isAtariSt) {
        iframe.contentWindow?.postMessage({ type: 'atarist_start', soloMode: isSoloMode }, window.location.origin);
      }
      if (isArcade) {
        iframe.contentWindow?.postMessage({ type: 'arcade_start' }, window.location.origin);
      }

      const emulatorCanvas = await waitForEmulatorCanvas(iframe);
      const useDirectCanvasStream = isArcade && typeof emulatorCanvas.captureStream === 'function';

      if (useDirectCanvasStream) {
        addLog('Using native arcade canvas stream');
      } else {
        startMirrorLoop(emulatorCanvas);
      }

      if (isAmigaLink) {
        addLog('Local linked Amiga ready');
        setStatus(serialChannelRef.current?.readyState === 'open' ? 'Amiga serial link connected' : 'Local Amiga ready, waiting for serial link');
        hostStartedRef.current = true;
        return;
      }

      const stream = useDirectCanvasStream
        ? emulatorCanvas.captureStream(60)
        : mirrorCanvasRef.current?.captureStream(60);

      if (!stream) {
        throw new Error('Video stream missing');
      }

      hostVideoStreamRef.current = stream;

      const audioStream = await waitForHostAudioStream(iframe);
      hostAudioStreamRef.current = audioStream || null;

      if (isSoloMode) {
        addLog('Local emulator ready');
        setStatus('Local emulator ready');
        hostStartedRef.current = true;
        return;
      }

      if (!pc) {
        throw new Error('Peer connection is not ready');
      }

      const hasExistingHostVideoSender = !isSoloMode
        && !isMultiPeerParty
        && pc.getSenders?.().some((sender) => sender.track?.kind === 'video');

      if (hasExistingHostVideoSender) {
        await replaceHostMediaStreams(stream, audioStream);
        addLog(`Replaced room stream with ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);
        setStatus('Room stream switched');
        hostStartedRef.current = true;
        return;
      }

      if (isMultiPeerParty) {
        addLog(`Party stream ready with ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);
        setStatus('Party host ready, waiting for guests');
        hostStartedRef.current = true;
        await connectPendingPartyGuests();
        return;
      }

      stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
      if (audioStream) {
        audioStream.getAudioTracks().forEach((track) => pc.addTrack(track, audioStream));
      }
      addLog(`Added ${stream.getVideoTracks().length} video track(s) and ${audioStream?.getAudioTracks().length || 0} audio track(s)`);

      const channel = pc.createDataChannel('inputs');
      dataChannelRef.current = channel;

      channel.onopen = () => {
        lastRemoteInputSessionRef.current = '';
        lastRemoteInputSeqRef.current = 0;
        lastRemoteInputAtRef.current = 0;
        remoteJoystickMaskRef.current = 0;
        addLog('Host input data channel open');
      };
      channel.onmessage = (msg) => handleGuestPayloadOnHostRef.current?.(msg.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);
      localOfferRef.current = pc.localDescription;

      const sent = sendSignal({
        type: 'offer',
        to: activeGuestSignalIdRef.current || undefined,
        offer: localOfferRef.current,
      });

      addLog(sent ? 'Offer sent' : 'Offer queued until signaling opens');
      setStatus('Offer created, waiting for guest');
      hostStartedRef.current = true;
    } catch (err) {
      setError(err.message);
      addLog(`Host session error: ${err.message}`);
      setHostStarted(false);
      hostStartedRef.current = false;
    } finally {
      hostStartingRef.current = false;
    }
  }

  async function connectGuest() {
    if (guestPreparedRef.current) {
      return;
    }

    try {
      const pc = pcRef.current;

      if (!pc.remoteDescription && pc.getTransceivers().length === 0) {
        pc.addTransceiver('video', {
          direction: 'recvonly',
        });
        pc.addTransceiver('audio', {
          direction: 'recvonly',
        });
      }

      guestPreparedRef.current = true;
      setGuestPrepared(true);
      addLog('Guest prepared to receive stream');
      setStatus('Waiting for host offer');
    } catch (err) {
      setError(err.message);
      addLog(`Guest setup error: ${err.message}`);
    }
  }

  useEffect(() => {
    if (!isSoloMode && isHost && signalingOpen && !isAmigaFamily && !isArcade && !isAtariSt) {
      startHostSession();
    }
  }, [isAmigaFamily, isArcade, isAtariSt, isHost, isSoloMode, room, signalingOpen]);

  useEffect(() => {
    if (!isSoloMode && room && !isHost && !isAmigaLink) {
      connectGuest();
    }
  }, [isAmigaLink, isHost, isSoloMode, room]);

  function openDiskPicker() {
    if (!canControlLocalEmulator) return;

    fileInputRef.current?.click();
  }

  function fallbackArcadeRomName(fileName) {
    return fileName
      .replace(/\.zip$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getArcadeRomMetadata(fileName) {
    const romKey = fileName.replace(/\.zip$/i, '').toLowerCase();
    const metadata = mame2003PlusTitles[romKey];
    const parent = metadata?.parent || '';
    const parentTitle = parent ? mame2003PlusTitles[parent]?.title || parent : '';

    return {
      romKey,
      displayName: metadata?.title || fallbackArcadeRomName(fileName),
      parent,
      parentTitle,
      isClone: Boolean(parent),
    };
  }

  async function collectArcadeRomEntries(directoryHandle, prefix = '') {
    const entries = [];

    for await (const [name, handle] of directoryHandle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;

      if (handle.kind === 'file') {
        if (name.toLowerCase().endsWith('.zip')) {
          const metadata = getArcadeRomMetadata(name);
          entries.push({
            name,
            path,
            ...metadata,
            handle,
          });
        }
        continue;
      }

      if (handle.kind === 'directory') {
        try {
          entries.push(...await collectArcadeRomEntries(handle, path));
        } catch {
          // Some folders may be blocked by the browser picker. Keep scanning the rest.
        }
      }
    }

    return entries;
  }

  async function openArcadeRomFolder() {
    if (!canControlLocalEmulator || !isArcade) return;

    if (!window.showDirectoryPicker) {
      setError('Your browser does not support choosing a ROM folder. Chrome or Edge should work.');
      return;
    }

    try {
      setError('');
      setArcadeRomScanning(true);
      const directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
      const entries = await collectArcadeRomEntries(directoryHandle);
      entries.sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { numeric: true, sensitivity: 'base' }));

      setArcadeRomFolderName(directoryHandle.name || 'MAME ROMs');
      setArcadeRomEntries(entries);
      setArcadeRomSearch('');
      setStatus(entries.length ? `Found ${entries.length} MAME ROM zip${entries.length === 1 ? '' : 's'}` : 'No .zip ROMs found in that folder');
      addLog(`Scanned MAME ROM folder: ${directoryHandle.name || 'selected folder'} (${entries.length} zip${entries.length === 1 ? '' : 's'})`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        addLog(`ROM folder error: ${err.message}`);
      }
    } finally {
      setArcadeRomScanning(false);
    }
  }

  async function loadArcadeRomFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Arcade rooms support MAME .zip ROM files');
      addLog(`Rejected file: ${file.name}`);
      return;
    }

    setError('');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const frame = await reloadArcadeFrame();

    if (!frame) {
      throw new Error('Arcade frame not found');
    }

    frame.contentWindow?.postMessage({
      type: 'arcade_autoload',
      fileName: file.name,
      bytes,
    }, window.location.origin);

    if (hostStartedRef.current) {
      setStatus(loadedDiskName ? `Changing MAME ROM: ${file.name}` : `Loading MAME ROM: ${file.name}`);

      frame.contentWindow?.postMessage({ type: 'arcade_start' }, window.location.origin);

      const emulatorCanvas = await waitForEmulatorCanvas(frame);
      const nextVideoStream = emulatorCanvas.captureStream(60);
      const nextAudioStream = await waitForHostAudioStream(frame);
      await replaceHostMediaStreams(nextVideoStream, nextAudioStream);

      setLoadedDiskName(file.name);
      addLog(`${loadedDiskName ? 'Changed' : 'Loaded'} MAME ROM: ${file.name}`);
      setStatus(`${loadedDiskName ? 'Changed' : 'Loaded'} MAME ROM: ${file.name}`);
      return;
    }

    if (!hostStartingRef.current) {
      await startHostSession();
    }

    setLoadedDiskName(file.name);
    addLog(`Loaded MAME ROM: ${file.name}`);
    setStatus(`Loaded MAME ROM: ${file.name}`);
  }

  async function loadArcadeRomEntry(entry) {
    if (!entry?.handle) return;

    try {
      setStatus(`Loading MAME ROM: ${entry.name}`);
      const file = await entry.handle.getFile();
      await loadArcadeRomFile(file);
    } catch (err) {
      setError(err.message);
      addLog(`MAME ROM load error: ${err.message}`);
    }
  }

  function openKickstartPicker() {
    if (!canControlLocalEmulator || !isAmigaFamily) return;

    kickstartInputRef.current?.click();
  }

  function openPlayStationBiosPicker() {
    if (!canControlLocalEmulator || !isPlayStation) return;

    playstationBiosInputRef.current?.click();
  }

  function openAtariTosPicker() {
    if (!canControlLocalEmulator || !isAtariSt) return;
    atariTosInputRef.current?.click();
  }

  function openSwapDiskPicker() {
    if (!canControlLocalEmulator || (!isAmigaFamily && !isC64 && !isAtariSt) || !hostStarted) return;

    if (isC64) {
      if (c64MediaCount < 2) {
        setStatus('Load all C64 disks or tapes together first');
        return;
      }
      forwardInputToEmulator({ type: 'c64_next_media' });
      return;
    }

    swapDiskInputRef.current?.click();
  }

  function selectAgaDisk(index) {
    if (!canControlLocalEmulator || !hostStarted || !isAmigaAga) return;

    forwardInputToEmulator({ type: 'amiga_aga_select_disk', index });
    setStatus(`Inserting AGA disk ${index + 1}`);
  }

  async function resetHostEmulator() {
    if (!canControlLocalEmulator || !hostStarted) return;

    if (isC64) {
      setError('');
      setLoadedDiskName('');
      setC64MediaCount(0);
      setC64MediaIndex(0);
      setC64WarpEnabled(false);
      setC64JoystickPortsSwapped(false);
      setInputCaptured(false);
      setHostStarted(false);
      hostStartedRef.current = false;
      hostStartingRef.current = false;
      await reloadC64Frame();
      const mirrorCanvas = mirrorCanvasRef.current;
      const context = mirrorCanvas?.getContext('2d');
      if (mirrorCanvas && context) {
        context.fillStyle = '#000';
        context.fillRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
      }
      addLog('C64 returned to start state');
      setStatus('C64 ready. Press Start emulator, then load a game');
      return;
    }

    if (isAtariSt) {
      setError('');
      setLoadedDiskName('');
      setAtariStMediaCount(0);
      setAtariStMediaIndex(0);
      setInputCaptured(false);
      setHostStarted(false);
      hostStartedRef.current = false;
      hostStartingRef.current = false;
      await reloadAtariStFrame();
      addLog('Atari ST returned to start state');
      setStatus('Atari ST ready. Load a disk to start');
      return;
    }

    if (isPcEngine) {
      setError('');
      setLoadedDiskName('');
      setInputCaptured(false);
      await reloadPcEngineFrame();
      addLog('PC Engine returned to start state');
      setStatus('PC Engine ready. Load a game');
      return;
    }

    if (isPlayStation) {
      setError('');
      setLoadedDiskName('');
      setInputCaptured(false);
      await reloadPlayStationFrame();
      addLog('PlayStation returned to start state');
      setStatus('PlayStation ready. Load a game');
      return;
    }

    if (isAtariSt) {
      if (atariStMediaCount < 2) {
        setStatus('Load all Atari ST disks together first');
        return;
      }
      forwardInputToEmulator({ type: 'atarist_next_media' });
      return;
    }

    const type = isAmiga || isAmigaLink
      ? 'amiga_reset'
      : isAmigaAga
        ? 'amiga_aga_reset'
      : isSegaConsole ? 'megadrive_reset' : isNes ? 'nes_reset' : isSnes ? 'snes_reset' : isPcEngine ? 'pcengine_reset' : isPlayStation ? 'playstation_reset' : isC64 ? 'c64_reset' : isAtari8 ? 'atari8_reset' : isAtariSt ? 'atarist_reset' : isArcade ? 'arcade_reset' : isSpectrum ? 'spectrum_reset' : 'amstrad_reset';

    forwardInputToEmulator({ type });
    addLog('Reset emulator');
    setStatus('Emulator reset');
  }

  function swapC64JoystickPorts() {
    if (!canControlLocalEmulator || !hostStarted || !isC64) return;

    const nextSwapped = !c64JoystickPortsSwapped;
    setC64JoystickPortsSwapped(nextSwapped);
    forwardInputToEmulator({ type: 'c64_swap_joystick_ports', soloMode: isSoloMode });
    addLog(`C64 joysticks switched: P1 port ${nextSwapped ? 1 : 2}, P2 port ${nextSwapped ? 2 : 1}`);
    setStatus(`P1 port ${nextSwapped ? 1 : 2}, P2 port ${nextSwapped ? 2 : 1}`);
  }

  function toggleC64Warp() {
    if (!canControlLocalEmulator || !hostStarted || !isC64) return;

    const enabled = !c64WarpEnabled;
    setC64WarpEnabled(enabled);
    forwardInputToEmulator({ type: 'c64_set_warp', enabled });
    addLog(`C64 warp ${enabled ? 'enabled' : 'disabled'}`);
    setStatus(enabled ? 'C64 warp enabled' : 'C64 normal speed');
  }

  async function handleDiskSelected(event) {
    try {
      const selectedFiles = Array.from(event.target.files || []);
      const file = selectedFiles[0];

      if (!file) return;

      const isSwapDisk = isAmigaFamily && event.target.dataset.mode === 'swap';
      const allowedExtensions = isAmigaFamily
        ? ['.adf', '.zip']
        : isMasterSystem ? ['.sms'] : isMegaDrive ? ['.bin', '.gen', '.md', '.smd'] : isNes ? ['.nes'] : isSnes ? ['.sfc', '.smc', '.fig', '.swc', '.bsx', '.gd3', '.gd7', '.dx2'] : isPcEngine ? ['.pce', '.sgx', '.zip'] : isPlayStation ? ['.cue', '.bin', '.chd', '.pbp', '.iso', '.zip', '.7z'] : isC64 ? ['.d64', '.t64', '.tap', '.prg', '.crt'] : isAtari8 ? ['.atr', '.xfd', '.atx', '.xex', '.com', '.car', '.rom', '.bin', '.cas', '.zip'] : isAtariSt ? ['.st', '.msa', '.stx', '.ipf'] : isArcade ? ['.zip'] : isSpectrum ? ['.tap', '.tzx', '.z80', '.sna', '.szx', '.zip'] : ['.dsk'];

      const invalidFile = selectedFiles.find((selectedFile) => {
        const selectedLowerName = selectedFile.name.toLowerCase();
        return !allowedExtensions.some((extension) => selectedLowerName.endsWith(extension));
      });

      if (invalidFile) {
        if (isArcade) {
          setError('Arcade rooms support MAME .zip ROM files');
          addLog(`Rejected file: ${invalidFile.name}`);
          event.target.value = '';
          return;
        }
        setError(isAmigaFamily ? 'Amiga rooms currently support .adf and .zip files' : isMasterSystem ? 'Master System rooms support .sms ROM files' : isMegaDrive ? 'Mega Drive rooms support .bin, .gen, .md, and .smd ROM files' : isNes ? 'NES rooms support .nes ROM files' : isSnes ? 'SNES rooms support .sfc, .smc, .fig, .swc, .bsx, .gd3, and .dx2 ROM files' : isPcEngine ? 'PC Engine rooms support .pce, .sgx, and .zip ROM files' : isPlayStation ? 'PlayStation rooms support .cue/.bin, .chd, .pbp, .iso, .zip, and .7z files' : isC64 ? 'C64 rooms support .d64, .t64, .tap, .prg, and .crt files' : isAtari8 ? 'Atari 8-bit rooms support .atr, .xex, .car, .rom, .bin, .cas, and .zip files' : isAtariSt ? 'Atari ST rooms support .st, .msa, .stx, and .ipf disk images' : isSpectrum ? 'Spectrum rooms support .tap, .tzx, .z80, .sna, .szx, and .zip files' : 'Only .dsk files are supported right now');
        addLog(`Rejected file: ${invalidFile.name}`);
        event.target.value = '';
        return;
      }

      if (isArcade) {
        await loadArcadeRomFile(file);
        event.target.value = '';
        return;
      }

      setError('');

      if (isCpcSystem && !isSwapDisk) {
        const nextMatches = findControlProfileMatches(file.name);
        setControlProfileMatches(nextMatches);

        if (shouldAutoSelectControlMatch(nextMatches)) {
          const nextProfile = nextMatches[0].profile;
          setSelectedControlProfile(nextProfile);
          setControlProfileDrawerOpen(true);
          addLog(`Matched Amstrad instructions: ${nextProfile.title}`);
        } else if (nextMatches.length > 0) {
          setSelectedControlProfile(null);
          setControlProfileDrawerOpen(true);
          addLog(`Choose Amstrad instructions: ${nextMatches.map((match) => match.profile.title).join(', ')}`);
        } else {
          setSelectedControlProfile(null);
          setControlProfileDrawerOpen(false);
          addLog(`No Amstrad instructions matched ${file.name}; default controls remain active`);
        }
      }

      if (
        isPlayStation
        && selectedFiles.some((selectedFile) => selectedFile.name.toLowerCase().endsWith('.cue'))
        && !selectedFiles.some((selectedFile) => selectedFile.name.toLowerCase().endsWith('.bin'))
      ) {
        setError('Select the PlayStation .cue file and all of its .bin track files together');
        event.target.value = '';
        return;
      }

      const atari8ZipFile = isAtari8 && file.name.toLowerCase().endsWith('.zip');
      const filesToLoad = (isAmigaAga || isPlayStation || isC64 || isAtariSt) && !isSwapDisk && selectedFiles.length > 1
        ? selectedFiles.slice().sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
        : [file];
      const loadedFiles = atari8ZipFile
        ? [await expandAtari8ZipFile(file)]
        : await Promise.all(filesToLoad.map(async (selectedFile) => ({
          fileName: selectedFile.name,
          bytes: new Uint8Array(await selectedFile.arrayBuffer()),
        })));
      const bytes = loadedFiles[0].bytes;

      const loadMessage = {
        type: isSwapDisk ? 'amiga_swap_disk' : isAmigaAga ? 'amiga_aga_autoload' : isAmiga || isAmigaLink ? 'amiga_autoload' : isSegaConsole ? 'megadrive_autoload' : isNes ? 'nes_autoload' : isSnes ? 'snes_autoload' : isPcEngine ? 'pcengine_autoload' : isPlayStation ? 'playstation_autoload' : isC64 ? 'c64_autoload' : isAtari8 ? 'atari8_autoload' : isAtariSt ? 'atarist_autoload' : isArcade ? 'arcade_autoload' : isSpectrum ? 'spectrum_autoload' : 'amstrad_autoload',
        fileName: loadedFiles[0].fileName,
        bytes: isPlayStation ? undefined : bytes,
        files: isPlayStation ? loadedFiles : undefined,
        disks: isAmigaAga && !isSwapDisk ? loadedFiles : undefined,
        media: isC64 || isAtariSt ? loadedFiles : undefined,
      };

      if (isC64 && loadedDiskName) {
        setStatus('Preparing a clean C64 runtime');
        await reloadC64Frame({ start: true });
      }
      if (isAmigaAga && loadedDiskName) {
        setStatus('Preparing a clean Amiga AGA runtime');
        await reloadAmigaAgaFrame();
      }
      if (isPcEngine && loadedDiskName) {
        setStatus('Preparing a clean PC Engine runtime');
        await reloadPcEngineFrame();
      }
      let reloadedNesFrame = null;

      if (isNes && loadedDiskName) {
        setStatus('Preparing a clean NES runtime');
        reloadedNesFrame = await reloadNesFrame();
      }
      if (isPlayStation && loadedDiskName) {
        setStatus('Preparing a clean PlayStation runtime');
        await reloadPlayStationFrame();
      }
      if (isAtariSt && loadedDiskName) {
        setStatus('Preparing a clean Atari ST runtime');
        setHostStarted(false);
        hostStartedRef.current = false;
        hostStartingRef.current = false;
        await reloadAtariStFrame();
      }
      forwardInputToEmulator(loadMessage);

      if (reloadedNesFrame) {
        const emulatorCanvas = await waitForEmulatorCanvas(reloadedNesFrame);
        startMirrorLoop(emulatorCanvas);
      }

      if (isArcade || isAmigaAga || isAtariSt) {
        if (!hostStartedRef.current && !hostStartingRef.current) {
          await startHostSession();
        }
      }
      if (isAmigaAga && !isSwapDisk) {
        setLoadedAgaDiskCount(loadedFiles.length);
        setCurrentAgaDiskIndex(0);
      }
      if (isC64) {
        setC64MediaCount(loadedFiles.length);
        setC64MediaIndex(0);
      }
      if (isAtariSt) {
        setAtariStMediaCount(loadedFiles.length);
        setAtariStMediaIndex(0);
      }

      const loadedLabel = atari8ZipFile
        ? `${loadedFiles[0].fileName} from ${file.name}`
        : loadedFiles.length > 1
        ? `${loadedFiles[0].fileName} + ${loadedFiles.length - 1} disk${loadedFiles.length === 2 ? '' : 's'}`
        : file.name;
      setLoadedDiskName(loadedLabel);
      addLog(`${isSwapDisk ? 'Swapped disk' : 'Loaded file'}: ${loadedLabel}`);
      setStatus(`${isSwapDisk ? 'Disk swapped' : 'File loaded'}: ${loadedLabel}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`File load error: ${err.message}`);
    }
  }

  async function handleKickstartSelected(event) {
    try {
      const file = event.target.files?.[0];

      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const allowedExtensions = ['.rom', '.bin', '.kick', '.kickstart'];

      if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
        setError('Kickstart must be a .rom or .bin file');
        addLog(`Rejected Kickstart ROM: ${file.name}`);
        event.target.value = '';
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      if (kickstartStorageKey) {
        savedSystemMediaRef.current.set(kickstartStorageKey, { fileName: file.name, bytes });
      }

      if (kickstartStorageKey) {
        try {
          await saveStoredKickstart(kickstartStorageKey, file.name, bytes);
          addLog(`Saved Kickstart ROM for next time: ${file.name}`);
        } catch (err) {
          addLog(`Could not save Kickstart ROM: ${err.message}`);
        }
      }

      forwardInputToEmulator(buildAmigaKickstartPayload(roomSystem, file.name, bytes));

      setKickstartRomName(file.name);
      addLog(`Loaded Kickstart ROM for this session: ${file.name}`);
      setStatus(`Kickstart loaded: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Kickstart load error: ${err.message}`);
    }
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setRoomCodeCopied(true);
      window.setTimeout(() => setRoomCodeCopied(false), 1800);
    } catch {
      setError('Could not copy the room code');
    }
  }

  async function handlePlayStationBiosSelected(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith('.bin') && !lowerName.endsWith('.rom')) {
        setError('PlayStation BIOS must be a .bin or .rom file');
        event.target.value = '';
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      await saveStoredKickstart(PLAYSTATION_BIOS_KEY, file.name, bytes);
      forwardInputToEmulator({
        type: 'playstation_bios',
        fileName: file.name,
        bytes,
      });
      setPlaystationBiosName(`${file.name} (saved locally)`);
      addLog(`Saved PlayStation BIOS locally: ${file.name}`);
      setStatus(`PlayStation BIOS ready: ${file.name}`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`PlayStation BIOS error: ${err.message}`);
    }
  }

  async function handleAtariTosSelected(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      if (!['.img', '.rom', '.bin'].some((extension) => lowerName.endsWith(extension))) {
        setError('Atari TOS must be an .img, .rom, or .bin file');
        event.target.value = '';
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (![192, 256, 512, 1024].includes(bytes.length / 1024)) {
        setError('Atari TOS ROM must be 192 KB, 256 KB, 512 KB, or 1024 KB');
        event.target.value = '';
        return;
      }

      await saveStoredKickstart(ATARI_ST_TOS_KEY, file.name, bytes);
      setAtariTosName(`${file.name} (saved locally)`);
      if (hostStarted) {
        setHostStarted(false);
        hostStartedRef.current = false;
        hostStartingRef.current = false;
        await reloadAtariStFrame();
      }
      forwardInputToEmulator({ type: 'atarist_tos', fileName: file.name, bytes });
      addLog(`Loaded local Atari TOS: ${file.name}`);
      setStatus(`Atari TOS ready: ${file.name}. Load a disk to start`);
      event.target.value = '';
    } catch (err) {
      setError(err.message);
      addLog(`Atari TOS load error: ${err.message}`);
    }
  }

  function chooseControlProfile(profile) {
    setSelectedControlProfile(profile);
    setControlProfileDrawerOpen(true);
    addLog(`Selected Amstrad instructions: ${profile.title}`);
  }

  return (
    <div className="page room-page">
      <div className="page-social-layout room-social-layout">
        <div className="card room-card">
        <div className="room-topbar">
          <div className="room-title">
            <BrandMark compact />
            <div className="room-code-row">
              <h1>{isSoloMode ? '1 Player' : `Room ${roomCode}`}</h1>
              {!isSoloMode ? (
                <button className="secondary" type="button" onClick={copyRoomCode}>
                  {roomCodeCopied ? 'Copied' : 'Copy code'}
                </button>
              ) : null}
            </div>
            <div className="room-identity">
              <span>You are</span>
              <strong>{username}</strong>
              <small>{roleLabel} · {systemLabel}</small>
            </div>
          </div>

          <div className="room-actions">
            <Link className="button-like secondary" to="/lobby">
              Lobby
            </Link>
            <button className="secondary" onClick={() => navigate('/lobby')}>
              Leave
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowDiagnostics((value) => !value)}
            >
              {showDiagnostics ? 'Hide diagnostics' : 'Diagnostics'}
            </button>
          </div>
        </div>

        <div className="room-summary">
          <div className="player-strip" aria-label="Players">
            {displayedPlayers.map((player) => (
              <div
                key={player.playerNumber}
                className={`player-card ${player.connected ? 'connected' : ''} ${player.playerNumber === currentPartyPlayerNumber ? 'you' : ''}`}
              >
                <span>P{player.playerNumber}</span>
                <strong>{player.username}</strong>
                <small>{player.role}</small>
              </div>
            ))}
          </div>

          <div className="health-strip" aria-label="Connection status">
            {healthItems.map((item) => (
              <span key={item.label} className={`health-item ${item.ok ? 'ok' : 'waiting'}`}>
                <span className="health-dot" aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {(loadedDiskName || isAmigaFamily || isPlayStation || isAtariSt) ? (
          <div className="session-strip">
            {loadedDiskName ? <span>{loadedDiskName}</span> : null}
            {isCpcSystem && selectedControlProfile ? (
              <button type="button" className="secondary control-profile-pill" onClick={() => setControlProfileDrawerOpen(true)}>
                Instructions: {selectedControlProfile.title}
              </button>
            ) : null}
            {isCpcSystem && !selectedControlProfile && controlProfileMatches.length > 0 ? (
              <button type="button" className="secondary control-profile-pill" onClick={() => setControlProfileDrawerOpen(true)}>
                Choose instructions ({controlProfileMatches.length})
              </button>
            ) : null}
            {isAmigaFamily ? <span>{kickstartRomName ? `Kickstart: ${kickstartRomName}` : isAmigaAga ? 'ROM: A1200 Kickstart recommended' : 'ROM: AROS'}</span> : null}
            {isPlayStation ? <span>{playstationBiosName ? `BIOS: ${playstationBiosName}` : 'BIOS: HLE fallback / load your own locally'}</span> : null}
            {isAtariSt ? <span>{atariTosName ? `TOS: ${atariTosName}` : 'TOS: EmuTOS 1.4 (built in)'}</span> : null}
            {isAmigaLink ? <span>Serial: {serialActivity.sent} sent / {serialActivity.received} received</span> : null}
          </div>
        ) : null}

        {showDiagnostics ? (
          <div className="session-strip diagnostics-summary">
            <span>{status}</span>
            {!isCpcParty && !isSoloMode ? <span>{micStatus}</span> : null}
            <span>{controlLabel}</span>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <audio ref={remoteVoiceAudioRef} autoPlay playsInline />

        <div className="room-layout">
          <div className={`panel video-panel ${isScreenFullscreen ? 'fullscreen-screen' : ''} ${isScreenFullscreen && isArcade ? 'arcade-fullscreen' : ''} ${isScreenFullscreen && isCpcParty ? 'party-fullscreen' : ''} ${isScreenFullscreen && !isSoloMode ? 'fullscreen-with-chat' : ''}`}>
            <div className="play-header">
              <h2>{isSoloMode || isAmigaLink ? 'Local screen' : isHost ? 'Host screen' : 'Remote screen'}</h2>

              <div className="input-toolbar">
                <div className="assigned-control" aria-label="Assigned control">
                  {assignedControlLabel}
                </div>

                {!isCpcParty && !isSoloMode ? (
                  <div className="mic-controls">
                    <button
                      type="button"
                      className={micEnabled && !micMuted ? 'active' : 'secondary'}
                      onClick={toggleMicrophone}
                    >
                      {micEnabled ? (micMuted ? 'Mic muted' : 'Mic on') : 'Mic off'}
                    </button>

                    <select
                      aria-label="Microphone"
                      value={selectedMicDeviceId}
                      onFocus={refreshMicrophoneDevices}
                      onChange={(event) => {
                        const nextDeviceId = event.target.value;
                        setSelectedMicDeviceId(nextDeviceId);
                        if (micEnabled) {
                          openMicrophone(nextDeviceId);
                        }
                      }}
                    >
                      <option value="">Default mic</option>
                      {micDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <button
                  type="button"
                  className={inputCaptured ? 'danger' : 'secondary'}
                  onClick={inputCaptured ? releaseInputCapture : captureInput}
                >
                  {inputCaptured ? 'Release' : 'Capture'}
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsScreenFullscreen((value) => !value)}
                >
                  {isScreenFullscreen ? 'Back to room' : 'Fullscreen'}
                </button>
              </div>
            </div>

            <div className={`capture-state ${inputCaptured ? 'captured' : ''}`}>
              {inputCaptured ? `${controlLabel} active` : 'Click the screen or press Capture to play'}
            </div>

            {canControlLocalEmulator ? (
              <>
                <iframe
                  key={`${roomSystem}-${emulatorSessionKey}`}
                  ref={emulatorFrameRef}
                  className={isArcade ? 'arcade-emulator-frame' : undefined}
                  title={emulatorTitle}
                  src={emulatorSrc}
                  onLoad={() => setEmulatorFrameLoadCount((count) => count + 1)}
                  style={{
                    position: isArcade ? 'relative' : 'absolute',
                    left: isArcade ? 'auto' : '0',
                    top: isArcade ? 'auto' : '0',
                    display: isArcade ? 'block' : 'inline',
                    width: isArcade ? '640px' : '768px',
                    height: isArcade ? '480px' : '544px',
                    maxWidth: isArcade ? '100%' : undefined,
                    margin: isArcade ? '0 auto' : undefined,
                    border: isArcade ? '1px solid #1f2f4a' : '0',
                    borderRadius: isArcade ? '6px' : '0',
                    background: '#000',
                    opacity: isArcade ? 1 : 0,
                    pointerEvents: isArcade ? 'auto' : 'none',
                  }}
                />

                <canvas
                  ref={mirrorCanvasRef}
                  className="video"
                  onClick={captureInput}
                  onPointerDown={handleAmigaPointerDown}
                  onPointerUp={handleAmigaPointerUp}
                  onPointerMove={handleAmigaPointerMove}
                  onContextMenu={(event) => {
                    if (isMouseComputer) event.preventDefault();
                  }}
                  style={{
                    width: '100%',
                    aspectRatio: '4 / 3',
                    border: '1px solid #1f2f4a',
                    borderRadius: '8px',
                    background: '#000',
                    display: isArcade ? 'none' : 'block',
                  }}
                  width={768}
                  height={544}
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedMedia}
                  multiple={isAmigaAga || isPlayStation || isC64 || isAtariSt}
                  data-mode="load"
                  onChange={handleDiskSelected}
                  style={{ display: 'none' }}
                />

                {isAmigaFamily ? (
                  <input
                    ref={swapDiskInputRef}
                    type="file"
                    accept={acceptedMedia}
                    data-mode="swap"
                    onChange={handleDiskSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isPlayStation ? (
                  <input
                    ref={playstationBiosInputRef}
                    type="file"
                    accept=".bin,.rom"
                    onChange={handlePlayStationBiosSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isAmigaFamily ? (
                  <input
                    ref={kickstartInputRef}
                    type="file"
                    accept=".rom,.bin,.kick,.kickstart"
                    onChange={handleKickstartSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                {isAtariSt ? (
                  <input
                    ref={atariTosInputRef}
                    type="file"
                    accept=".img,.rom,.bin"
                    onChange={handleAtariTosSelected}
                    style={{ display: 'none' }}
                  />
                ) : null}

                <div
                  className="host-control-bar"
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  {isHost && !isSoloMode ? (
                    <div className="room-system-switch">
                      <label>
                        <span>System</span>
                        <select
                          value={selectedRoomSystem}
                          onChange={(event) => setSelectedRoomSystem(event.target.value)}
                          disabled={switchingSystem}
                        >
                          {ROOM_SYSTEM_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={switchRoomSystem}
                        disabled={switchingSystem || selectedRoomSystem === roomSystem}
                      >
                        {switchingSystem ? 'Switching...' : 'Switch system'}
                      </button>
                    </div>
                  ) : null}

                  {!isAtariSt ? (
                    <button type="button" onClick={startHostSession} disabled={hostStarted || (isAmigaAga && !loadedDiskName)}>
                      {isAmigaAga && !loadedDiskName
                        ? 'Load AGA file to start'
                        : isSoloMode
                          ? hostStarted ? 'Emulator running' : 'Start emulator'
                          : isAmigaLink
                            ? hostStarted ? 'Local Amiga running' : 'Start local Amiga'
                            : hostStarted ? 'Host session running' : 'Start host session'}
                    </button>
                  ) : null}

                  <button onClick={openDiskPicker} disabled={!hostStarted && !isArcade && !isAmigaAga && !isAtariSt}>
                    {mediaLabel}
                  </button>

                  {isArcade ? (
                    <button type="button" className="secondary" onClick={openArcadeRomFolder} disabled={arcadeRomScanning}>
                      {arcadeRomScanning ? 'Scanning ROMs...' : arcadeRomFolderName ? 'Change ROM folder' : 'Choose ROM folder'}
                    </button>
                  ) : null}

                  {(isAmiga || isAmigaLink || isC64 || isAtariSt) ? (
                    <button type="button" className="secondary" onClick={openSwapDiskPicker} disabled={!hostStarted}>
                      {isC64
                        ? `Next C64 media${c64MediaCount > 1 ? ` (${c64MediaIndex + 1}/${c64MediaCount})` : ''}`
                        : isAtariSt
                          ? `Next ST disk${atariStMediaCount > 1 ? ` (${atariStMediaIndex + 1}/${atariStMediaCount})` : ''}`
                          : 'Swap disk'}
                    </button>
                  ) : null}

                  {isAmigaAga && loadedAgaDiskCount > 0
                    ? Array.from({ length: loadedAgaDiskCount }, (_, index) => (
                      <button
                        key={`aga-disk-${index + 1}`}
                        type="button"
                        className={currentAgaDiskIndex === index ? 'active' : 'secondary'}
                        onClick={() => selectAgaDisk(index)}
                        disabled={!hostStarted}
                      >
                        Disk {index + 1}
                      </button>
                    ))
                    : null}

                  {isMouseComputer ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(1)} disabled={!hostStarted}>
                      Left click
                    </button>
                  ) : null}

                  {isMouseComputer ? (
                    <button type="button" className="secondary" onClick={() => sendAmigaMouseClick(3)} disabled={!hostStarted}>
                      Right click
                    </button>
                  ) : null}

                  <button type="button" className="secondary" onClick={resetHostEmulator} disabled={!hostStarted}>
                    Reset emulator
                  </button>

                  {isC64 ? (
                    <button type="button" className="secondary" onClick={swapC64JoystickPorts} disabled={!hostStarted}>
                      P1 port {c64JoystickPortsSwapped ? 1 : 2} / P2 port {c64JoystickPortsSwapped ? 2 : 1}
                    </button>
                  ) : null}

                  {isC64 ? (
                    <button type="button" className={c64WarpEnabled ? 'active' : 'secondary'} onClick={toggleC64Warp} disabled={!hostStarted}>
                      {c64WarpEnabled ? 'Normal speed' : 'Warp loading'}
                    </button>
                  ) : null}

                  {isAmigaFamily ? (
                    <button type="button" className="secondary" onClick={openKickstartPicker} disabled={hostStarted && !isAmigaAga}>
                      {kickstartRomName ? 'Change Kickstart ROM' : 'Load Kickstart ROM'}
                    </button>
                  ) : null}

                  {isPlayStation ? (
                    <button type="button" className="secondary" onClick={openPlayStationBiosPicker}>
                      {playstationBiosName ? 'Change local PlayStation BIOS' : 'Load local PlayStation BIOS'}
                    </button>
                  ) : null}

                  {isAtariSt ? (
                    <button type="button" className="secondary" onClick={openAtariTosPicker}>
                      {atariTosName ? 'Change local Atari TOS' : 'Load local Atari TOS'}
                    </button>
                  ) : null}

                </div>

                {isArcade && arcadeRomEntries.length > 0 ? (
                  <div className="arcade-rom-browser">
                    <div className="arcade-rom-browser-head">
                      <div>
                        <strong>{arcadeRomFolderName || 'MAME ROMs'}</strong>
                        <span>
                          {showArcadeCloneRoms
                            ? `${arcadeRomEntries.length} ZIP ROM${arcadeRomEntries.length === 1 ? '' : 's'} found`
                            : `${arcadeParentRomCount} parent game${arcadeParentRomCount === 1 ? '' : 's'} shown${arcadeCloneRomCount ? ` (${arcadeCloneRomCount} clones hidden)` : ''}`}
                        </span>
                      </div>
                      <div className="arcade-rom-browser-actions">
                        <label className="arcade-rom-toggle">
                          <input
                            type="checkbox"
                            checked={showArcadeCloneRoms}
                            onChange={(event) => setShowArcadeCloneRoms(event.target.checked)}
                          />
                          <span>Show clones/children</span>
                        </label>
                        <input
                          type="search"
                          value={arcadeRomSearch}
                          onChange={(event) => setArcadeRomSearch(event.target.value)}
                          placeholder="Search games or zip names"
                        />
                      </div>
                    </div>
                    <div className="arcade-rom-list" aria-label="MAME ROM folder games">
                      {filteredArcadeRomEntries.map((entry) => (
                        <button
                          key={entry.path}
                          type="button"
                          className={`${loadedDiskName === entry.name ? 'active' : 'secondary'}${entry.isClone ? ' clone-rom' : ''}`}
                          onClick={() => loadArcadeRomEntry(entry)}
                        >
                          <span>{entry.displayName}</span>
                          <small>{entry.path}{entry.isClone && entry.parentTitle ? ` - clone of ${entry.parentTitle}` : ''}</small>
                        </button>
                      ))}
                    </div>
                    {filteredArcadeRomEntries.length < arcadeRomEntries.length ? (
                      <p className="muted">Showing {filteredArcadeRomEntries.length} of {arcadeRomEntries.length}. Use search to narrow the list.</p>
                    ) : null}
                  </div>
                ) : null}

                {isCpcParty ? (
                  <div className="party-turn-panel">
                    <div className="party-turn-header">
                      <strong>Party turn</strong>
                      <span>
                        {activePartyPlayerName
                          ? `P${activePartyPlayer}: ${activePartyPlayerName} controls the shared joystick`
                          : `P${activePartyPlayer}: waiting for assigned player`}
                      </span>
                    </div>
                    <div className="party-turn-controls">
                      <button type="button" className="secondary" onClick={nextPartyTurn}>
                        Next player
                      </button>
                      {Array.from({ length: partyMaxPlayers }, (_, index) => index + 1).map((playerNumber) => (
                        <button
                          key={playerNumber}
                          type="button"
                          className={activePartyPlayer === playerNumber ? 'active' : 'secondary'}
                          onClick={() => setPartyTurn(playerNumber)}
                        >
                          <span>P{playerNumber}</span>
                          {partyPlayerNameByNumber.get(playerNumber) ? <small>{partyPlayerNameByNumber.get(playerNumber)}</small> : null}
                        </button>
                      ))}
                    </div>
                    <div className="party-roster" aria-label="Party players">
                      {partyRoster.map((player) => (
                        <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                          <strong>P{player.playerNumber}</strong>
                          <span>{player.username}</span>
                          <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                        </div>
                      ))}
                    </div>
                    <p className="muted">Guests appear here as they join, so the host can pick the right player turn before the game starts.</p>
                  </div>
                ) : null}

                {isArcadeParty || isC64Party ? (
                  <div className="party-turn-panel">
                    <div className="party-turn-header">
                      <strong>{isC64Party ? 'C64 players' : 'Arcade players'}</strong>
                      <span>{isC64Party ? 'Players are assigned as they join.' : 'Players are assigned as they join and play at the same time.'}</span>
                    </div>
                    <div className="party-roster" aria-label={isC64Party ? 'C64 party players' : 'Arcade party players'}>
                      {partyRoster.map((player) => (
                        <div key={player.playerNumber} className={player.connected ? 'connected' : ''}>
                          <strong>P{player.playerNumber}</strong>
                          <span>{player.username}</span>
                          <small>{player.role}{player.connected ? ' connected' : ' joining'}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className="video"
                  onClick={captureInput}
                  onPointerDown={handleAmigaPointerDown}
                  onPointerUp={handleAmigaPointerUp}
                  onPointerMove={handleAmigaPointerMove}
                  onContextMenu={(event) => {
                    if (isMouseComputer) event.preventDefault();
                  }}
                />

                <button onClick={connectGuest} disabled={guestPrepared}>
                  {guestPrepared ? 'Guest connection ready' : 'Prepare guest connection'}
                </button>
              </>
            )}

            {!isSoloMode ? (
              <div className="fullscreen-room-chat">
                <RoomChat
                  messages={chatMessages}
                  onSend={sendChatMessage}
                  connected={signalingOpen}
                />
              </div>
            ) : null}

          </div>
        </div>

        {controlProfileDrawerOpen && isCpcSystem ? (
          <aside className="control-profile-drawer" aria-label="Amstrad instructions">
            <div className="control-profile-header">
              <div>
                <span>Amstrad instructions</span>
                <h2>{selectedControlProfile ? selectedControlProfile.title : 'Choose profile'}</h2>
              </div>
              <button type="button" className="secondary" onClick={() => setControlProfileDrawerOpen(false)}>
                Close
              </button>
            </div>

            {controlProfileMatches.length > 1 ? (
              <div className="control-match-list">
                {controlProfileMatches.map((match) => (
                  <button
                    key={match.profile.gameSlug}
                    type="button"
                    className={selectedControlProfile?.gameSlug === match.profile.gameSlug ? 'active' : 'secondary'}
                    onClick={() => chooseControlProfile(match.profile)}
                  >
                    <span>{match.profile.title}</span>
                    <small>{match.score}% match</small>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedControlProfile ? (
              <>
                <div className="control-profile-meta">
                  <span>{selectedControlProfile.supportsJoystick ? 'Joystick supported' : 'Keyboard'}</span>
                  <span>{selectedControlProfile.redefinableKeys ? 'Redefinable keys' : 'Fixed keys'}</span>
                  {selectedControlProfile.confidence ? <span>{Math.round(selectedControlProfile.confidence * 100)}% confidence</span> : null}
                </div>

                <div className="control-profile-sections">
                  {selectedControlPlayers.map((player) => (
                    <section key={player.key} className="control-profile-section">
                      <div className="control-player-heading">
                        <h3>{player.label}</h3>
                        <span>{player.hasInput ? 'Game profile' : 'No mapping'}</span>
                      </div>

                      {player.hasInput ? (
                        <div className="control-visual-panel">
                          <div className="control-stick" aria-label={`${player.label} joystick directions`}>
                            {player.directionEntries.map((entry) => (
                              <div
                                key={`${player.key}-${entry.action}`}
                                className={`control-stick-zone ${entry.action === 'fire1' ? 'fire' : ''} ${entry.key || entry.detail ? 'mapped' : 'empty'}`}
                              >
                                <span>{entry.label}</span>
                                <strong>{entry.key || '-'}</strong>
                                {entry.detail ? <small>{entry.detail}</small> : null}
                              </div>
                            ))}
                          </div>

                          {player.utilityEntries.length ? (
                            <div className="control-key-row" aria-label={`${player.label} utility keys`}>
                              {player.utilityEntries.map((entry) => (
                                <div key={`${player.key}-${entry.action}`} className="control-keycap">
                                  <span>{entry.label}</span>
                                  <strong>{entry.key || '-'}</strong>
                                  {entry.detail ? <small>{entry.detail}</small> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="muted">No fixed key mapping in this profile.</p>
                      )}

                      {player.overlayEntries.length ? (
                        <div className="control-overlay-list">
                          {player.overlayEntries.map(([action, value]) => (
                            <div key={`${player.key}-overlay-${action}`}>
                              <strong>{action}</strong>
                              <span>{value}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>

                {selectedControlProfile.notes?.length ? (
                  <section className="control-profile-section">
                    <h3>Notes</h3>
                    <ul className="control-notes-list">
                      {selectedControlProfile.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {selectedControlProfile.source ? (
                  <div className="control-profile-source">
                    <span>{selectedControlProfile.source.manualFile}</span>
                    {selectedControlProfile.source.pages?.length ? (
                      <small>Pages {selectedControlProfile.source.pages.join(', ')}</small>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted">Default controls remain active until a profile is selected.</p>
            )}
          </aside>
        ) : null}

        {showDiagnostics ? (
          <>
            <div className="panel input-debug-panel">
              <div className="play-header">
                <h2>Input monitor</h2>
                <div className="assigned-control">
                  {inputDebug.source}
                </div>
              </div>

              <div className="input-debug-grid">
                {joystickMaskToLabels(inputDebug.mask).map(([label, active]) => (
                  <div
                    key={label}
                    className={`input-bit ${active ? 'active' : ''}`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div className="input-debug-meta">
                <span>Mask {inputDebug.mask}</span>
                <span>{dataChannelRef.current?.readyState || 'no channel'}</span>
                <span>{inputCaptured ? 'captured' : 'released'}</span>
              </div>

              <div className="log-list input-debug-list">
                {inputDebug.events.length === 0 ? (
                  <div className="log-entry">No inputs seen yet.</div>
                ) : inputDebug.events.map((event, index) => (
                  <div key={`${event}-${index}`} className="log-entry">
                    {event}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel log-panel">
              <h2>Session log</h2>

              {logs.length === 0 ? <p className="muted">No events yet.</p> : null}

              <div className="log-list">
                {logs.map((log, index) => (
                  <div key={`${log}-${index}`} className="log-entry">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
        </div>
        <div className="room-side-rail">
          <SocialSidebar roomCode={roomCode} allowInvites={!isSoloMode} showOnline={false} />
          {!isSoloMode ? (
            <RoomChat
              messages={chatMessages}
              onSend={sendChatMessage}
              connected={signalingOpen}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
