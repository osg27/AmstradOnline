// Detect controller family from gamepad.id for appropriate visual layout

export const CONTROLLER_FAMILIES = {
  XBOX: 'xbox',
  PLAYSTATION: 'playstation',
  ARCADE: 'arcade',
  GENERIC: 'generic',
};

export function detectControllerFamily(gamepadId) {
  if (!gamepadId) return CONTROLLER_FAMILIES.GENERIC;

  const id = gamepadId.toLowerCase();

  // Xbox / XInput detection
  if (
    id.includes('xbox') ||
    id.includes('xinput') ||
    id.includes('x-box') ||
    id.includes('microsoft') ||
    id.includes('xbox 360') ||
    id.includes('xbox one') ||
    id.includes('xbox wireless')
  ) {
    return CONTROLLER_FAMILIES.XBOX;
  }

  // PlayStation detection
  if (
    id.includes('dualsense') ||
    id.includes('dualshock') ||
    id.includes('wireless controller') ||
    id.includes('sony') ||
    id.includes('playstation')
  ) {
    return CONTROLLER_FAMILIES.PLAYSTATION;
  }

  // Arcade / Fight stick detection
  if (
    id.includes('arcade') ||
    id.includes('fightstick') ||
    id.includes('fight stick') ||
    id.includes('fighting') ||
    id.includes('joystick') ||
    id.includes('mayflash') ||
    id.includes('hori') ||
    id.includes('qanba') ||
    id.includes('sanwa')
  ) {
    return CONTROLLER_FAMILIES.ARCADE;
  }

  return CONTROLLER_FAMILIES.GENERIC;
}

export function getFamilyDisplayName(family) {
  switch (family) {
    case CONTROLLER_FAMILIES.XBOX:
      return 'Xbox-style';
    case CONTROLLER_FAMILIES.PLAYSTATION:
      return 'PlayStation-style';
    case CONTROLLER_FAMILIES.ARCADE:
      return 'Arcade-style';
    case CONTROLLER_FAMILIES.GENERIC:
      return 'Generic gamepad';
    default:
      return 'Unknown';
  }
}

// Get physical button label for a detected gamepad input
// Used for friendly display of what physical button was pressed
export function getPhysicalButtonLabel(family, inputType, inputIndex, inputDirection) {
  if (inputType === 'axis') {
    const dirLabel = inputDirection > 0 ? '+' : '−';

    if (family === CONTROLLER_FAMILIES.XBOX || family === CONTROLLER_FAMILIES.GENERIC) {
      // Standard Xbox/generic layout
      if (inputIndex === 0) return `Left Stick ${dirLabel}X`;
      if (inputIndex === 1) return `Left Stick ${dirLabel}Y`;
      if (inputIndex === 2) return `Right Stick ${dirLabel}X`;
      if (inputIndex === 3) return `Right Stick ${dirLabel}Y`;
      return `Axis ${inputIndex} ${dirLabel}`;
    }

    if (family === CONTROLLER_FAMILIES.PLAYSTATION) {
      // PlayStation layout (same as standard)
      if (inputIndex === 0) return `L Stick ${dirLabel}X`;
      if (inputIndex === 1) return `L Stick ${dirLabel}Y`;
      if (inputIndex === 2) return `R Stick ${dirLabel}X`;
      if (inputIndex === 3) return `R Stick ${dirLabel}Y`;
      return `Axis ${inputIndex} ${dirLabel}`;
    }

    if (family === CONTROLLER_FAMILIES.ARCADE) {
      // Arcade/fight stick axes
      if (inputIndex === 0) return `Stick ${dirLabel}X`;
      if (inputIndex === 1) return `Stick ${dirLabel}Y`;
      return `Axis ${inputIndex} ${dirLabel}`;
    }

    return `Axis ${inputIndex} ${dirLabel}`;
  }

  if (inputType === 'button') {
    if (family === CONTROLLER_FAMILIES.XBOX) {
      // Xbox standard layout (matches Gamepad API standard mapping)
      if (inputIndex === 0) return 'A';
      if (inputIndex === 1) return 'B';
      if (inputIndex === 2) return 'X';
      if (inputIndex === 3) return 'Y';
      if (inputIndex === 4) return 'LB';
      if (inputIndex === 5) return 'RB';
      if (inputIndex === 6) return 'LT';
      if (inputIndex === 7) return 'RT';
      if (inputIndex === 8) return 'Back';
      if (inputIndex === 9) return 'Start';
      if (inputIndex === 10) return 'L Stick';
      if (inputIndex === 11) return 'R Stick';
      if (inputIndex === 12) return 'D-pad Up';
      if (inputIndex === 13) return 'D-pad Down';
      if (inputIndex === 14) return 'D-pad Left';
      if (inputIndex === 15) return 'D-pad Right';
      if (inputIndex === 16) return 'Guide';
      return `Button ${inputIndex}`;
    }

    if (family === CONTROLLER_FAMILIES.PLAYSTATION) {
      // PlayStation standard layout
      if (inputIndex === 0) return '✕';
      if (inputIndex === 1) return '●';
      if (inputIndex === 2) return '□';
      if (inputIndex === 3) return '△';
      if (inputIndex === 4) return 'L1';
      if (inputIndex === 5) return 'R1';
      if (inputIndex === 6) return 'L2';
      if (inputIndex === 7) return 'R2';
      if (inputIndex === 8) return 'Create';
      if (inputIndex === 9) return 'Options';
      if (inputIndex === 10) return 'L Stick';
      if (inputIndex === 11) return 'R Stick';
      if (inputIndex === 12) return 'D-pad Up';
      if (inputIndex === 13) return 'D-pad Down';
      if (inputIndex === 14) return 'D-pad Left';
      if (inputIndex === 15) return 'D-pad Right';
      if (inputIndex === 16) return 'PS';
      return `Button ${inputIndex}`;
    }

    if (family === CONTROLLER_FAMILIES.ARCADE) {
      // Arcade/fight stick
      if (inputIndex === 0) return 'Button 1';
      if (inputIndex === 1) return 'Button 2';
      if (inputIndex === 2) return 'Button 3';
      if (inputIndex === 3) return 'Button 4';
      if (inputIndex === 4) return 'Button 5';
      if (inputIndex === 5) return 'Button 6';
      if (inputIndex === 6) return 'Button 7';
      if (inputIndex === 7) return 'Button 8';
      if (inputIndex === 8) return 'Select';
      if (inputIndex === 9) return 'Start';
      return `Button ${inputIndex}`;
    }

    // Generic/unknown
    if (inputIndex === 12) return 'D-pad Up';
    if (inputIndex === 13) return 'D-pad Down';
    if (inputIndex === 14) return 'D-pad Left';
    if (inputIndex === 15) return 'D-pad Right';
    return `Button ${inputIndex}`;
  }

  return 'Unknown input';
}
