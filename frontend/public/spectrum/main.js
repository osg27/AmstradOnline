const root = document.getElementById("speccy");
let speccy = null;
let ready = false;
let pendingFile = null;

function getKeyName(key) {
  if (key === " ") return "Space";
  if (key === "ArrowUp") return "ArrowUp";
  if (key === "ArrowDown") return "ArrowDown";
  if (key === "ArrowLeft") return "ArrowLeft";
  if (key === "ArrowRight") return "ArrowRight";
  if (key === "Enter") return "Enter";
  if (key === "Shift") return "Shift";
  if (key === "Control") return "Control";
  return typeof key === "string" && key.length === 1 ? key.toLowerCase() : key;
}

async function loadSpectrumFile(fileName, bytes) {
  if (!speccy || !ready) {
    pendingFile = { fileName, bytes };
    return;
  }

  const file = new File([bytes], fileName || "game.tap");
  await speccy.openFile(file);
  speccy.focus();
}

function applyInput(key, action) {
  if (!speccy || !ready) return;

  const keyName = getKeyName(key);
  if (!keyName) return;

  if (action === "down") {
    speccy.pressKey(keyName);
  } else if (action === "up") {
    speccy.releaseKey(keyName);
  }
}

function boot() {
  speccy = window.JSSpeccy(root, {
    autoStart: true,
    autoLoadTapes: true,
    tapeTrapsEnabled: true,
    machine: 128,
    sandbox: true,
    uiEnabled: false,
    keyboardEnabled: true,
    zoom: 2,
  });

  speccy.onReady(() => {
    ready = true;
    speccy.focus();

    if (pendingFile) {
      const file = pendingFile;
      pendingFile = null;
      loadSpectrumFile(file.fileName, file.bytes);
    }
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "spectrum_autoload") {
    loadSpectrumFile(data.fileName, data.bytes).catch((error) => {
      console.error("Spectrum load failed", error);
    });
    return;
  }

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    applyInput(data.key, data.action);
  }
});

boot();
