import React from 'react';

export const PLAYER_AVATARS = {
  'arcade-green': { glyph: '👾', label: 'Arcade Alien', colors: ['#7ad99b', '#183c31'] },
  'space-purple': { glyph: '🚀', label: 'Space Pilot', colors: ['#c49cff', '#33234b'] },
  'racer-red': { glyph: '🏎️', label: 'Retro Racer', colors: ['#ff8b79', '#51241f'] },
  'wizard-blue': { glyph: '🧙', label: 'Pixel Wizard', colors: ['#83c9ff', '#183752'] },
  'robot-gold': { glyph: '🤖', label: 'Gold Robot', colors: ['#f3c66b', '#4b3716'] },
  'ghost-mint': { glyph: '👻', label: 'Mint Ghost', colors: ['#b8ffe5', '#245043'] },
  'ninja-pink': { glyph: '🥷', label: 'Neon Ninja', colors: ['#ff8dc8', '#4a1e37'] },
  'knight-silver': { glyph: '🛡️', label: 'Silver Knight', colors: ['#d4dde2', '#344047'] },
};

export default function PlayerAvatar({ avatarId = 'arcade-green', size = 'medium' }) {
  const avatar = PLAYER_AVATARS[avatarId] || PLAYER_AVATARS['arcade-green'];
  return (
    <span
      className={`player-avatar player-avatar-${size}`}
      style={{ '--avatar-main': avatar.colors[0], '--avatar-shadow': avatar.colors[1] }}
      role="img"
      aria-label={avatar.label}
    >
      <span>{avatar.glyph}</span>
    </span>
  );
}
