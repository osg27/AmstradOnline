export function buildRtcConfig() {
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  };
}

export async function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === 'complete') {
    return;
  }

  await new Promise((resolve) => {
    function checkState() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    }

    pc.addEventListener('icegatheringstatechange', checkState);
  });
}
