// One bridge, separate verified hardware adapters and restricted game profiles.
export const MAME_PREVIEW_GAMES = {
  pacman: {
    title: 'Pac-Man', id: 12192, filename: 'pacman.zip', maxBytes: 4 * 1024 * 1024,
    coreFile: 'mame-pacman.js', coreFactory: 'OSGMamePacman', loadFunction: '_ra_load_pacman',
    apiPath: '', aspect: '224 / 288', width: 448, sixButtons: false,
  },
  sf2ce: {
    title: 'Street Fighter II: Champion Edition', id: 11772, filename: 'sf2ce.zip', maxBytes: 16 * 1024 * 1024,
    coreFile: 'mame-cps1.js', coreFactory: 'OSGMameCps1', loadFunction: '_ra_load_sf2ce',
    apiPath: 'sf2ce/', aspect: '4 / 3', width: 768, sixButtons: true,
  },
};
