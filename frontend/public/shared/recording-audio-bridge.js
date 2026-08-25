(function installRecordingAudioBridge() {
  if (window.getRecordingAudioStream || !window.AudioNode?.prototype?.connect) return;

  const nativeConnect = window.AudioNode.prototype.connect;
  const destinations = new Map();

  function destinationFor(context) {
    if (!context || context.state === "closed") return null;
    let destination = destinations.get(context);
    if (!destination) {
      destination = context.createMediaStreamDestination();
      destinations.set(context, destination);
    }
    return destination;
  }

  window.AudioNode.prototype.connect = function recordingAwareConnect(destination, ...args) {
    if (destination === this.context?.destination) {
      const recordingDestination = destinationFor(this.context);
      if (recordingDestination) {
        try {
          nativeConnect.call(this, recordingDestination);
        } catch {
          // Some native nodes reject a second connection; normal playback wins.
        }
      }
    }
    return nativeConnect.call(this, destination, ...args);
  };

  window.getRecordingAudioStream = function getRecordingAudioStream() {
    for (const [context, destination] of destinations) {
      if (context.state === "closed") {
        destinations.delete(context);
        continue;
      }
      context.resume?.().catch(() => {});
      if (destination.stream?.getAudioTracks?.().length) return destination.stream;
    }
    return null;
  };
})();
