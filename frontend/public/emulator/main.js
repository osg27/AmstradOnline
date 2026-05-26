const textDecoder = new TextDecoder();

function toStr(charArray, ptr, limit = 255) {
  let end = ptr;
  while (charArray[end++] && end - ptr < limit);
  return textDecoder.decode(
    new Uint8Array(charArray.buffer, ptr, end - ptr - 1),
  );
}

async function setProgram(canvas, vertexShaderPath, fragmentShaderPath) {
  const vertexShaderSource = await (await fetch(vertexShaderPath)).text();
  const fragmentShaderSource = await (await fetch(fragmentShaderPath)).text();

  const gl = canvas.getContext("webgl2", {
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    alpha: false,
  });
  if (gl === null) throw new Error("null gl");

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (vertexShader === null) throw new Error("null vertexShader");
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (fragmentShader === null) throw new Error("null fragmentShader");
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);

  const shaderProgram = gl.createProgram();
  if (shaderProgram === null) throw new Error("null shaderProgram");
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  gl.useProgram(shaderProgram);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const vertexPosition = gl.getAttribLocation(shaderProgram, "pos");
  gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vertexPosition);

  const texture = gl.createTexture();
  if (texture === null) throw new Error("null texture");

  const uWidth = gl.getUniformLocation(shaderProgram, "width");
  const uHeight = gl.getUniformLocation(shaderProgram, "height");
  gl.uniform1f(uWidth, canvas.width);
  gl.uniform1f(uHeight, canvas.height);

  return { canvas, gl, texture, shaderProgram };
}

function loadImage(
  gl,
  shaderProgram,
  texture,
  textureCoordinatesName,
  samplerName,
  textureId,
  image,
) {
  gl.activeTexture(textureId);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    image.width,
    image.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image,
  );

  const sampler = gl.getUniformLocation(shaderProgram, samplerName);
  gl.uniform1i(sampler, textureId - gl.TEXTURE0);

  const uTexsize = gl.getUniformLocation(shaderProgram, "texsize");
  gl.uniform2f(uTexsize, image.width, image.height);
}

function keyNameToCode(key) {
  const map = {
    Enter: 13,
    Backspace: 8,
    Tab: 9,
    Escape: 27,
    Shift: 16,
    ShiftLeft: 16,
    ShiftRight: 16,
    Control: 17,
    Alt: 18,
    CapsLock: 20,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };

  return map[key] ?? null;
}

async function main() {
  const memory = new WebAssembly.Memory({ initial: 1000 });
  const canvas = document.getElementsByTagName("canvas")[0];
  canvas.tabIndex = 0;
  canvas.focus();

  const { gl, texture, shaderProgram } = await setProgram(
    canvas,
    "shaders/crt.v.glsl",
    "shaders/crt.f.glsl",
  );

  const temporaryCanvas = document.createElement("canvas");
  temporaryCanvas.width = 768;
  temporaryCanvas.height = 544;
  const temporaryCtx = temporaryCanvas.getContext("2d");
  const imageData = new ImageData(
    temporaryCanvas.width,
    temporaryCanvas.height,
  );

  let heapPos = 1;
  let str = "";
  let frameCounter = 0;
  let suppressPostedInput = false;

  const env = {
    memory,
    display: (pixelBuffer) => {
      const pixelArray = new Uint32Array(memory.buffer, pixelBuffer);
      const { data, width, height } = imageData;
      const canvasPixel = new Uint32Array(data.buffer);

      let j = 0;
      while (j < height) {
        let i = 0;
        while (i < width) {
          canvasPixel[i + j * width] = pixelArray[i + (j >> 1) * width];
          i += 1;
        }
        j += 1;
      }

      temporaryCtx.putImageData(imageData, 0, 0);
      loadImage(
        gl,
        shaderProgram,
        texture,
        "aTextureCoord",
        "uImageSampler",
        gl.TEXTURE1,
        temporaryCanvas,
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    addString: (offset, size) => {
      str =
        str + textDecoder.decode(new Uint8Array(memory.buffer, offset, size));
    },
    printString: () => {
      console.log(str);
      str = "";
    },
    memset: (ptr, value, size) => {
      const mem = new Uint8Array(memory.buffer);
      mem.fill(value, ptr, ptr + size);
      return ptr;
    },
    memcpy: (dest, source, n) => {
      const mem = new Uint8Array(memory.buffer);
      mem.copyWithin(dest, source, source + n);
      return dest;
    },
    memcmp: (s1, s2, n) => {
      const charArray = new Uint8Array(memory.buffer);
      for (let i = 0; i < n; i++) {
        if (charArray[s1 + i] !== charArray[s2 + i]) {
          return charArray[s1 + i] - charArray[s2 + i];
        }
      }
      return 0;
    },
    malloc: (size) => {
      const ptr = heapPos;
      heapPos += size;
      return ptr;
    },
    free: (_ptr) => {},
    __assert_fail_js: (assertion, file, line, fun) => {
      const charArray = new Uint8Array(memory.buffer);
      console.log(
        `${toStr(charArray, file)}(${line}): ${toStr(charArray, assertion)} in ${toStr(charArray, fun)}`,
      );
    },
  };

  const wasm = await WebAssembly.instantiateStreaming(fetch("zpz6128.wasm"), {
    env,
  });
  const {
    new_emulator,
    input_char,
    keydown,
    keyup,
    tick,
    insert_disk,
    enable_digital_joystick,
    disable_joystick,
    set_joystick_mask,
    get_joystick_mask,
  } = wasm.instance.exports;

  console.log("WASM exports loaded", {
    enable_digital_joystick: typeof enable_digital_joystick,
    set_joystick_mask: typeof set_joystick_mask,
    get_joystick_mask: typeof get_joystick_mask,
  });

  const emulator = new_emulator();

  disable_joystick(emulator);
  set_joystick_mask(emulator, 0);

  let selectedGamepadIndex = null;
  let lastJoystickMask = -1;
  const remoteJoystickMasks = {
    1: 0,
    2: 0,
  };

  window.addEventListener("gamepadconnected", (event) => {
    console.log(
      "GAMEPAD CONNECTED",
      event.gamepad.index,
      event.gamepad.id,
      event.gamepad.mapping,
    );
    if (selectedGamepadIndex === null) {
      selectedGamepadIndex = event.gamepad.index;
    }
  });

  window.addEventListener("gamepaddisconnected", (event) => {
    console.log("GAMEPAD DISCONNECTED", event.gamepad.index, event.gamepad.id);
    if (selectedGamepadIndex === event.gamepad.index) {
      selectedGamepadIndex = null;
      set_joystick_mask(emulator, 0);
    }
  });

  function gamepadToJoystickMask(pad) {
    let mask = 0;
    const deadzone = 0.5;

    const left = pad.buttons[14]?.pressed || (pad.axes[0] ?? 0) < -deadzone;
    const right = pad.buttons[15]?.pressed || (pad.axes[0] ?? 0) > deadzone;
    const up = pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -deadzone;
    const down = pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > deadzone;

    const fire =
      pad.buttons[0]?.pressed || // Cross / A
      pad.buttons[1]?.pressed || // Circle / B
      pad.buttons[2]?.pressed || // Square / X
      pad.buttons[3]?.pressed; // Triangle / Y

    if (up) mask |= 1;
    if (down) mask |= 2;
    if (left) mask |= 4;
    if (right) mask |= 8;
    if (fire) mask |= 16;

    return mask;
  }

  function pollGamepadJoystick() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad =
      selectedGamepadIndex !== null ? pads[selectedGamepadIndex] : null;

    if (pad) {
      const mask = gamepadToJoystickMask(pad);

      if (mask !== lastJoystickMask) {
        lastJoystickMask = mask;
        set_joystick_mask(emulator, mask);
        console.log("JOY MASK", mask, pad.id);
      }
    }

    requestAnimationFrame(pollGamepadJoystick);
  }

  requestAnimationFrame(pollGamepadJoystick);

  window.testJoy = (mask) => {
    set_joystick_mask(emulator, mask);
    console.log("joy mask", get_joystick_mask(emulator));
  };

  window.testJoy = (mask) => {
    set_joystick_mask(emulator, mask);
    console.log("joy mask set to", get_joystick_mask(emulator));
  };

  function postInputToParent(key, action) {
    window.parent.postMessage(
      {
        type: "amstrad_input",
        key,
        action,
        frame: frameCounter,
      },
      window.location.origin,
    );
  }

  function applyInput(key, action) {
    if (typeof key !== "string") return false;

    if (action === "down") {
      if (key.length === 1) {
        input_char(key.charCodeAt(0));
        return true;
      }

      const code = keyNameToCode(key);
      if (code !== null) {
        keydown(code);
        return true;
      }
    }

    if (action === "up") {
      if (key.length === 1) {
        return true;
      }

      const code = keyNameToCode(key);
      if (code !== null) {
        keyup(code);
        return true;
      }
    }

    return false;
  }

  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;

    const handled = applyInput(event.key, "down");
    if (!handled) return;

    event.preventDefault();

    if (!suppressPostedInput) {
      postInputToParent(event.key, "down");
    }
  });

  document.addEventListener("keyup", (event) => {
    const handled = applyInput(event.key, "up");
    if (!handled) return;

    event.preventDefault();

    if (!suppressPostedInput) {
      postInputToParent(event.key, "up");
    }
  });

  function typeText(text, delay = 80, startDelay = 1200) {
    [...text].forEach((ch, index) => {
      setTimeout(
        () => {
          input_char(ch.charCodeAt(0));
        },
        startDelay + index * delay,
      );
    });
  }

  function pressEnter(delay = 80, at = 0) {
    setTimeout(() => {
      keydown(13);
      keyup(13);
    }, at + delay);
  }

  function autoBootDisk() {
    typeText("cat");
    pressEnter(80, 1200 + "cat".length * 80);
  }

  function loadDiskBytes(fileName, bytes) {
    const lower = fileName.toLowerCase();

    if (!lower.endsWith(".dsk")) {
      console.warn(`Unsupported autoload type for current build: ${fileName}`);
      return;
    }

    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const charArray = new Uint8Array(memory.buffer);
    const ptr = env.malloc(content.byteLength);
    charArray.set(content, ptr);

    insert_disk(emulator, 0, ptr, content.byteLength);

    setTimeout(() => {
      autoBootDisk();
    }, 800);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data) return;

    if (data.type === "amstrad_autoload") {
      if (!data.fileName || !data.bytes) return;
      loadDiskBytes(data.fileName, new Uint8Array(data.bytes));
      return;
    }

    if (data.type === "amstrad_remote_input") {
      suppressPostedInput = true;
      try {
        applyInput(data.key, data.action);
      } finally {
        suppressPostedInput = false;
      }
      return;
    }

    if (data.type === "amstrad_remote_joystick") {
      const player = data.player === 2 ? 2 : 1;
      remoteJoystickMasks[player] = data.mask | 0;
      set_joystick_mask(emulator, remoteJoystickMasks[player]);
      return;
    }
  });

  const frame_time = 16;
  window.stopped = false;

  function mainLoop() {
    frameCounter += 1;
    tick(emulator, frame_time);
    if (!window.stopped) {
      window.requestAnimationFrame(mainLoop);
    }
  }

  window.requestAnimationFrame(mainLoop);
}

window.onload = main;
