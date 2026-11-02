import { apiFetch } from '../../api/client';

export const PARTY_ROOM_SYSTEMS = ['cpc_party', 'c64', 'arcade'];

/**
 * Creates an empty room for a catalogue system and returns the room path, using
 * exactly the request body and URL the old lobby's "Start" button used. The player
 * then loads a game file inside the room.
 *
 * mode: 'solo' | 'hosted' | 'party' | 'link'. Arcade always opens one cabinet.
 */
export async function createSystemRoom({
  system,
  mode,
  partyMaxPlayers = 4,
  arcadeMaxPlayers = 8,
  protectedRoom = false,
  roomPassword = '',
}) {
  const isArcadeCabinet = system?.id === 'arcade';
  const modeConfig = isArcadeCabinet ? system?.modes.solo : system?.modes[mode];
  if (!system || system.locked || !modeConfig?.enabled) {
    throw new Error('That play mode is not ready yet.');
  }

  const roomSystem = modeConfig.system || system.id;
  const isPartyRoom = mode === 'party' && PARTY_ROOM_SYSTEMS.includes(roomSystem);
  const nextPartyMaxPlayers = roomSystem === 'arcade'
    ? Math.min(4, Math.max(3, partyMaxPlayers))
    : partyMaxPlayers;
  const room = await apiFetch('/rooms/create', {
    method: 'POST',
    body: JSON.stringify({
      system: roomSystem,
      hosting_mode: isArcadeCabinet || mode === 'solo' ? 'solo' : 'multiplayer',
      party_max_players: isArcadeCabinet ? arcadeMaxPlayers : isPartyRoom ? nextPartyMaxPlayers : 2,
      arcade_multiplayer: false,
      is_private: protectedRoom,
      password: protectedRoom && roomPassword ? roomPassword : undefined,
    }),
  });

  const query = !isArcadeCabinet && mode === 'solo' ? '?mode=solo' : '';
  return `/room/${room.room_code}${query}`;
}
