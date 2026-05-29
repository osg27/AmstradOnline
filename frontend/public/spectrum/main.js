const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

let loadedFileName = "";
let lastKey = "";

function draw() {
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#d7d7d7";
  ctx.fillRect(86, 54, 596, 436);

  ctx.fillStyle = "#111";
  ctx.fillRect(102, 70, 564, 404);

  ctx.fillStyle = "#f7f7f7";
  ctx.font = "28px monospace";
  ctx.fillText("ZX SPECTRUM", 264, 156);

  ctx.font = "18px monospace";
  ctx.fillStyle = "#75d982";
  ctx.fillText("Multiplayer room wiring is ready", 204, 214);

  ctx.fillStyle = "#f3c66b";
  ctx.fillText("Next step: plug in the Spectrum emulator core", 154, 254);

  ctx.fillStyle = "#b9b2a4";
  ctx.fillText(loadedFileName ? `Loaded: ${loadedFileName}` : "Load .tap, .tzx, .z80, or .sna", 170, 314);
  ctx.fillText(lastKey ? `Last key: ${lastKey}` : "Waiting for input", 278, 352);
}

function normaliseKey(key) {
  if (key === " ") return "Space";
  return key;
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "spectrum_autoload") {
    loadedFileName = data.fileName || "Spectrum file";
    draw();
    return;
  }

  if (data.type === "amstrad_remote_input" || data.type === "amstrad_remote_control") {
    lastKey = `${normaliseKey(data.key)} ${data.action}`;
    draw();
  }
});

draw();
