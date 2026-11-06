import { describe, expect, it } from 'vitest';
import profiles from '../../data/amstradControlProfiles.json';
import {
  PAD,
  CPC_MATRIX,
  assignPadsToPlayers,
  buildCpcControlPlan,
  cpcMatrixMessage,
  parseCpcBinding,
  readCpcPadMask,
  resolveCpcKeys,
  summarisePlayer,
} from './cpcGamepadControls';

const profile = (slug) => {
  const found = profiles.find((entry) => entry.gameSlug === slug);
  if (!found) throw new Error(`missing profile ${slug}`);
  return found;
};

function standardPad({ index = 0, buttons = [], axes = [0, 0, 0, 0] } = {}) {
  return {
    index,
    connected: true,
    mapping: 'standard',
    id: `pad-${index}`,
    axes,
    buttons: Array.from({ length: 17 }, (_, button) => ({ pressed: buttons.includes(button), value: buttons.includes(button) ? 1 : 0 })),
  };
}

describe('parseCpcBinding', () => {
  it('understands the key vocabulary used in the manual profiles', () => {
    expect(parseCpcBinding('Q')).toEqual(['Q']);
    expect(parseCpcBinding('SPACE BAR')).toEqual(['SPACE']);
    expect(parseCpcBinding('CURSOR_UP')).toEqual(['CURSOR_UP']);
    expect(parseCpcBinding('SHIFT+Q')).toEqual(['SHIFT', 'Q']);
    expect(parseCpcBinding('COPY KEY')).toEqual(['COPY']);
    expect(parseCpcBinding('f5')).toEqual(['F5']);
    expect(parseCpcBinding('JOYSTICK PORT 2 FIRE')).toEqual(['JOY1_FIRE1']);
    expect(parseCpcBinding('JOY1_FIRE2')).toEqual(['JOY1_FIRE2']);
    expect(parseCpcBinding('Joystick-Left')).toEqual(['JOY1_LEFT']);
    expect(parseCpcBinding('ENTER')).toEqual(['RETURN', 'ENTER']);
  });

  it('rejects keys that are not on a CPC instead of guessing', () => {
    for (const value of ['User definable', 'RUN/STOP', 'CAPS_SHIFT+SYMBOL_SHIFT', 'RIGHT_AMIGA', 'F10', 'QO', '+', '', null]) {
      expect(parseCpcBinding(value)).toBeNull();
    }
  });

  it('every parsed key exists in the CPC matrix', () => {
    for (const entry of profiles) {
      for (const player of Object.values(entry.players || {})) {
        for (const value of Object.values(player?.emulatorInput || {})) {
          for (const key of parseCpcBinding(value) || []) expect(CPC_MATRIX[key]).toBeDefined();
        }
      }
    }
  });
});

describe('buildCpcControlPlan', () => {
  it('keyboard-only game: pad drives the documented keys', () => {
    const entry = profiles.find((item) => !item.supportsJoystick && item.players.player1.emulatorInput?.up === 'Q');
    const plan = buildCpcControlPlan(entry);
    expect(plan.players[0].mode).toBe('keys');
    expect(resolveCpcKeys(PAD.up, plan.players[0])).toEqual(['Q']);
  });

  it('joystick game with documented keys presses both the keys and joystick 1 (Gryzor)', () => {
    const plan = buildCpcControlPlan(profile('gryzor'));
    expect(plan.players[0].mode).toBe('hybrid');
    expect(resolveCpcKeys(PAD.up, plan.players[0]).sort()).toEqual(['JOY1_UP', 'Q']);
    expect(resolveCpcKeys(PAD.left | PAD.a, plan.players[0]).sort()).toEqual(['JOY1_FIRE1', 'JOY1_LEFT', 'O', 'SPACE']);
    expect(resolveCpcKeys(PAD.b, plan.players[0]).sort()).toEqual(['JOY1_FIRE1', 'SPACE']);
    expect(summarisePlayer(plan.players[0])).toBe('Q A O P · Space + Joy 1');
  });

  it('Commando uses the corrected manual keys (0 not O; fire Z, grenade M)', () => {
    const [p1] = buildCpcControlPlan(profile('commando')).players;
    expect(resolveCpcKeys(PAD.right, p1).sort()).toEqual(['0', 'JOY1_RIGHT']);
    expect(resolveCpcKeys(PAD.a, p1).sort()).toEqual(['JOY1_FIRE1', 'Z']);
    expect(resolveCpcKeys(PAD.b, p1)).toEqual(['M']);
  });

  it('joystick game with only Player 1 documented', () => {
    const plan = buildCpcControlPlan(profile('007-the-living-daylights'));
    expect(plan.players[0].mode).toBe('hybrid');
    expect(resolveCpcKeys(PAD.up | PAD.a, plan.players[0]).sort()).toEqual(['JOY1_FIRE1', 'JOY1_UP', 'Q', 'SPACE']);
    // Start falls back to the documented pause key (ESC), not a guessed key.
    expect(resolveCpcKeys(PAD.start, plan.players[0])).toEqual(['ESC']);
    expect(plan.players[1].mode).toBe('shared');
  });

  it('second joystick in the manual with Player 1-only keys (Graham Gooch)', () => {
    const plan = buildCpcControlPlan(profile('graham-gooch-s-test-cricket'));
    expect(plan.players[1].mode).toBe('joystick2');
  });

  it('documented keys that clash between players raise a note', () => {
    const entry = {
      gameSlug: 'clash', title: 'Clash', supportsJoystick: false, notes: [],
      players: {
        player1: { emulatorInput: { up: 'Q', down: 'A', left: 'O', right: 'P', fire1: 'SPACE' } },
        player2: { emulatorInput: { up: 'CURSOR_UP', down: 'CURSOR_DOWN', left: 'COPY', right: 'ENTER', fire1: 'SPACE' } },
      },
    };
    expect(buildCpcControlPlan(entry).notes.join(' ')).toMatch(/share Space/);
  });

  it('two documented keyboard layouts stay independent (3D Boxing)', () => {
    const plan = buildCpcControlPlan(profile('3d-boxing'));
    const [p1, p2] = plan.players;
    expect(p1.mode).toBe('keys');
    expect(p2.mode).toBe('keys');
    expect(resolveCpcKeys(PAD.up | PAD.a, p1).sort()).toEqual(['SPACE', 'W']);
    expect(resolveCpcKeys(PAD.up | PAD.a, p2).sort()).toEqual(['COPY', 'CURSOR_UP']);
    expect(plan.notes.some((note) => note.includes('share'))).toBe(false);
  });

  it('keyboard Player 1 and joystick Player 2 (Bubble Bobble)', () => {
    const plan = buildCpcControlPlan(profile('bubble-bobble'));
    const [p1, p2] = plan.players;
    expect(resolveCpcKeys(PAD.left | PAD.a, p1).sort()).toEqual(['O', 'SPACE']);
    expect(resolveCpcKeys(PAD.left | PAD.a, p2).sort()).toEqual(['JOY1_FIRE1', 'JOY1_LEFT']);
    expect(summarisePlayer(p2)).toMatch(/Joy|–/);
  });

  it('joystick Player 1 and keyboard Player 2 (Match Day)', () => {
    const [p1, p2] = buildCpcControlPlan(profile('match-day')).players;
    expect(resolveCpcKeys(PAD.right, p1)).toEqual(['JOY1_RIGHT']);
    expect(resolveCpcKeys(PAD.right | PAD.a, p2).sort()).toEqual(['P', 'SPACE']);
  });

  it('manual saying each player has a joystick uses CPC joysticks 1 and 2 (Crack Down)', () => {
    const plan = buildCpcControlPlan(profile('crack-down'));
    expect(plan.players[0].mode).toBe('hybrid');
    expect(plan.players[1].mode).toBe('joystick2');
    expect(resolveCpcKeys(PAD.up | PAD.a, plan.players[1]).sort()).toEqual(['JOY2_FIRE1', 'JOY2_UP']);
  });

  it('unknown game falls back to native joysticks 1 and 2, with RETURN as default start', () => {
    const plan = buildCpcControlPlan(null);
    expect(plan.players.map((player) => player.mode)).toEqual(['joystick1', 'joystick2']);
    expect(plan.players[0].origin).toBe('default');
    expect(resolveCpcKeys(PAD.start, plan.players[0])).toEqual(['RETURN']);
  });

  it('dedicated diagonal keys replace the two cardinal keys', () => {
    const entry = {
      gameSlug: 'diag', title: 'Diag', supportsJoystick: false, notes: [],
      players: { player1: { emulatorInput: { up: 'W', down: 'X', left: 'A', right: 'D', upLeft: 'Q', fire1: 'SPACE' } } },
    };
    const [p1] = buildCpcControlPlan(entry).players;
    expect(resolveCpcKeys(PAD.up | PAD.left, p1)).toEqual(['Q']);
    expect(resolveCpcKeys(PAD.up | PAD.right, p1).sort()).toEqual(['D', 'W']);
    // Opposite directions cancel out.
    expect(resolveCpcKeys(PAD.left | PAD.right, p1)).toEqual([]);
  });

  it('manual overrides switch mode and keys', () => {
    const plan = buildCpcControlPlan(profile('007-the-living-daylights'), {
      player1: { mode: 'keys' },
      player2: { mode: 'keys', keys: { up: 'I', down: 'K', left: 'J', right: 'L', a: 'SHIFT+Q' } },
    });
    expect(resolveCpcKeys(PAD.up, plan.players[0])).toEqual(['Q']);
    expect(resolveCpcKeys(PAD.a, plan.players[1]).sort()).toEqual(['Q', 'SHIFT']);
    expect(plan.players[1].origin).toBe('custom');
    expect(plan.notes.some((note) => note.includes('share'))).toBe(true);
  });

  it('off mode sends nothing', () => {
    const plan = buildCpcControlPlan(null, { player2: { mode: 'off' } });
    expect(resolveCpcKeys(PAD.up | PAD.a, plan.players[1])).toEqual([]);
  });

  it('builds an iframe message with matrix cells', () => {
    const plan = buildCpcControlPlan(null);
    expect(cpcMatrixMessage('pad-p2', PAD.up | PAD.a, plan.players[1])).toEqual({
      type: 'amstrad_matrix_state',
      source: 'pad-p2',
      cells: [[6, 1], [6, 16]],
    });
  });

  it('every profile produces a plan without throwing', () => {
    for (const entry of profiles) {
      const plan = buildCpcControlPlan(entry);
      expect(plan.players).toHaveLength(2);
    }
  });
});

describe('gamepad reading', () => {
  it('reads D-pad, analogue stick and buttons on a standard pad', () => {
    expect(readCpcPadMask(standardPad({ buttons: [12, 0] }))).toBe(PAD.up | PAD.a);
    expect(readCpcPadMask(standardPad({ axes: [-0.9, 0.8, 0, 0] }))).toBe(PAD.left | PAD.down);
    expect(readCpcPadMask(standardPad({ axes: [0.2, -0.3, 0, 0] }))).toBe(0);
    expect(readCpcPadMask(standardPad({ buttons: [1, 9, 8] }))).toBe(PAD.b | PAD.start | PAD.select);
  });

  it('reads a DirectInput stick on axis pair 2/3 and a POV hat', () => {
    const pad = standardPad({ axes: [0, 0, 0.9, 0] });
    pad.mapping = '';
    expect(readCpcPadMask(pad)).toBe(PAD.right);
    const hat = standardPad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] });
    hat.mapping = '';
    expect(readCpcPadMask(hat)).toBe(PAD.up);
  });

  it('assigns two pads to two players by index, with swap', () => {
    const pads = [null, standardPad({ index: 3 }), standardPad({ index: 1 })];
    expect(assignPadsToPlayers(pads).map((pad) => pad.index)).toEqual([1, 3]);
    expect(assignPadsToPlayers(pads, true).map((pad) => pad.index)).toEqual([3, 1]);
    const single = assignPadsToPlayers([standardPad({ index: 0 })], true);
    expect(single[0]).toBeNull();
    expect(single[1].index).toBe(0);
  });

  it('simultaneous two-player input resolves to independent cells', () => {
    const plan = buildCpcControlPlan(profile('crack-down'));
    const p1 = cpcMatrixMessage('pad-p1', PAD.right | PAD.a, plan.players[0]).cells;
    const p2 = cpcMatrixMessage('pad-p2', PAD.left | PAD.a, plan.players[1]).cells;
    expect(p1).toEqual([[3, 8], [9, 8], [5, 128], [9, 16]]);
    expect(p2).toEqual([[6, 4], [6, 16]]);
  });
});
