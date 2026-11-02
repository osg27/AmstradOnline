// The systems the site can start, grouped into shelves, and the play modes each one
// really supports. Moved from LobbyPage so the Play home, the "Play a game file"
// picker and the game sheet all read the same table.
import amiga500LogoUrl from '../../../assets/amiga500.svg';
import amstradLogoUrl from '../../../assets/Amstrad_logo_1980s.svg.webp';
import arcadeLogoUrl from '../../../assets/MAMELogo.svg';
import atariStLogoUrl from '../../../assets/atari-st.webp';
import c64LogoUrl from '../../../assets/C64_Logo.webp';
import masterSystemLogoUrl from '../../../assets/Sega-master-system-logo.png';
import megaDriveLogoUrl from '../../../assets/MegaDriveJPLogo.svg.webp';
import msxLogoUrl from '../../../assets/msx-logo.webp';
import nesLogoUrl from '../../../assets/59db13187bf21468ce403a95096fbd14.png';
import pcEngineLogoUrl from '../../../assets/PC_engine_logo_red.svg.webp';
import playStationLogoUrl from '../../../assets/PlayStation_logo_and_wordmark.svg';
import snesLogoUrl from '../../../assets/SNES_logo.svg.webp';
import spectrumLogoUrl from '../../../assets/Sinclair_ZX_Spectrum-03.svg.webp';


export const PLAY_MODES = {
  solo: {
    label: '1 Player',
    kicker: 'Local',
    description: 'Play on your own.',
  },
  hosted: {
    label: 'Play Online',
    kicker: 'Friends',
    description: 'Start a room and share the code.',
  },
  party: {
    label: 'Party Mode',
    kicker: 'Turns',
    description: 'Take turns with a group.',
  },
  link: {
    label: 'Link Play',
    kicker: 'Linked',
    description: 'Connect two machines.',
  },
};

export const PLATFORM_SHELVES = [
  {
    id: 'micros',
    label: 'Micros',
    kicker: 'Keyboards, disks, tapes',
    strapline: 'Home computers with all their lovely awkward keys.',
    eras: [
      {
        id: '8bit',
        label: '8-bit',
        strapline: 'The classic home micro shelf.',
        systems: [
          {
            id: 'cpc',
            name: 'Amstrad CPC',
            shortName: 'CPC',
            accent: 'green',
            logo: amstradLogoUrl,
            summary: 'Load a disk and play. Party Mode is also available.',
            formats: '.dsk',
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: true, system: 'cpc_party' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
          {
            id: 'spectrum',
            name: 'ZX Spectrum',
            shortName: 'ZX',
            accent: 'ruby',
            logo: spectrumLogoUrl,
            summary: 'Load a Spectrum game and play.',
            formats: '.tap .tzx .z80 .sna .szx',
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
          {
            id: 'c64',
            name: 'Commodore 64',
            shortName: 'C64',
            accent: 'amber',
            logo: c64LogoUrl,
            summary: 'Classic C64 games with joystick and keyboard support.',
            formats: '.d64 .t64 .tap .prg .crt .zip',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: true },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
          {
            id: 'msx',
            name: 'MSX / MSX2',
            shortName: 'MSX',
            accent: 'blue',
            logo: msxLogoUrl,
            summary: 'MSX and MSX2 cartridge, disk and cassette games through WebMSX.',
            formats: '.rom .mx1 .mx2 .dsk .cas .m3u .zip',
            testing: true,
            adminOnly: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
        ],
      },
      {
        id: '16bit',
        label: '16-bit',
        strapline: 'The bigger home machines.',
        systems: [
          {
            id: 'atarist',
            name: 'Atari ST',
            shortName: 'ST',
            accent: 'ruby',
            logo: atariStLogoUrl,
            summary: 'Atari ST games with keyboard, mouse, joystick, and multi-disk support.',
            formats: '.st .msa .stx .ipf',
            superAdminOnly: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
          {
            id: 'amiga',
            name: 'Commodore Amiga',
            shortName: 'Amiga',
            accent: 'blue',
            logo: amiga500LogoUrl,
            summary: 'Unified A500, A600, A1200, AGA and WHDLoad play through PUAE.',
            formats: '.adf .adz .dms .ipf .hdf .lha .zip',
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: true, system: 'amiga_link', testing: true },
            },
          },
          {
            id: 'x68000',
            name: 'Sharp X68000',
            shortName: 'X68K',
            accent: 'ruby',
            logo: null,
            summary: 'Japanese 16/32-bit computer games through PX68k.',
            formats: '.dim .img .d88 .88d .hdm .2hd .xdf .hdf .m3u',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
        ],
      },
    ],
  },
  {
    id: 'consoles',
    label: 'Consoles',
    kicker: 'Pads, ports, living rooms',
    strapline: 'Console nights, with two-player rooms ready to go.',
    eras: [
      {
        id: '8bit',
        label: '8-bit',
        strapline: 'The first console shelf.',
        systems: [
          {
            id: 'mastersystem',
            name: 'Sega Master System',
            shortName: 'SMS',
            accent: 'violet',
            logo: masterSystemLogoUrl,
            summary: 'Master System games with two-player controls.',
            formats: '.sms .zip .7z',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
          {
            id: 'nes',
            name: 'Nintendo Entertainment System',
            shortName: 'NES',
            accent: 'ruby',
            logo: nesLogoUrl,
            summary: 'NES games with classic pad controls.',
            formats: '.nes',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
        ],
      },
      {
        id: '16bit',
        label: '16-bit',
        strapline: 'Cartridges, pads and fast restarts.',
        systems: [
          {
            id: 'megadrive',
            name: 'Mega Drive',
            shortName: 'MD',
            accent: 'violet',
            logo: megaDriveLogoUrl,
            summary: 'Mega Drive games with two-player controls.',
            formats: '.bin .gen .md .smd',
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
          {
            id: 'snes',
            name: 'SNES',
            shortName: 'SNES',
            accent: 'amber',
            logo: snesLogoUrl,
            summary: 'SNES games with two-player controls.',
            formats: '.sfc .smc',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
          {
            id: 'pcengine',
            name: 'PC Engine / TurboGrafx-16',
            shortName: 'PCE',
            accent: 'gold',
            logo: pcEngineLogoUrl,
            summary: 'PC Engine and TurboGrafx-16 HuCard games.',
            formats: '.pce .sgx .zip',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
        ],
      },
      {
        id: '32bit',
        label: '32-bit',
        strapline: 'Disc-era console rooms.',
        systems: [
          {
            id: 'playstation',
            name: 'Sony PlayStation',
            shortName: 'PS1',
            accent: 'violet',
            logo: playStationLogoUrl,
            summary: 'Original PlayStation games using a locally supplied BIOS.',
            formats: '.cue/.bin .chd .pbp .iso .zip .7z',
            testing: true,
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: false, note: 'Not available yet' },
              link: { enabled: false, note: 'Not available' },
            },
          },
        ],
      },
    ],
  },
  {
    id: 'arcade',
    label: 'Arcade',
    kicker: 'Cabinets, coins, chaos',
    strapline: 'Arcade rooms for one-on-one and party cabinet games.',
    eras: [
      {
        id: 'mame',
        label: 'MAME',
        strapline: 'Cabinet classics ready for online play.',
        systems: [
          {
            id: 'arcade',
            name: 'MAME Arcade',
            shortName: 'MAME',
            accent: 'gold',
            logo: arcadeLogoUrl,
            summary: 'Arcade cabinet games for solo, online, and party play. MAME 2003 romset required.',
            formats: 'MAME 2003 .zip .7z',
            modes: {
              solo: { enabled: true },
              hosted: { enabled: true },
              party: { enabled: true, system: 'arcade' },
              link: { enabled: false, note: 'Not available yet' },
            },
          },
        ],
      },
    ],
  },
];

export function isSystemVisible(system, { isAdmin = false, isSuperAdmin = false } = {}) {
  return (!system.superAdminOnly || isSuperAdmin) && (!system.adminOnly || isAdmin || isSuperAdmin);
}

/** Flat list of catalogue systems the current account may start. */
export function visibleCatalogSystems(roles = {}) {
  return PLATFORM_SHELVES.flatMap((platform) => platform.eras.flatMap((era) => era.systems))
    .filter((system) => isSystemVisible(system, roles) && !system.underConstruction);
}

export function findCatalogSystem(systemId) {
  for (const platform of PLATFORM_SHELVES) {
    for (const era of platform.eras) {
      const match = era.systems.find((system) => system.id === systemId);
      if (match) return match;
    }
  }
  return null;
}
