# Site-wide gameplay recording

## Architecture

`GameRecorder` is the shared browser-native recording state machine. It owns countdown and wall-clock timers, MIME selection, `MediaRecorder`, one-second chunks, Blob creation, filenames, download URLs, and cleanup. `useGameRecorder` provides its state to the compact React control.

`emulatorRecordingAdapters.js` is the only system-to-capture mapping. Each adapter supplies a display name, native-oriented frame rate, and the runtime's audio-stream getter. RoomPage copies the same-origin emulator canvas into a dedicated native-size recording canvas and explicitly requests each captured frame. It combines that video with cloned recording-only audio/video tracks; it never requests a microphone, camera, display, or browser-tab stream. Ending a recording stops those clones so WebM timing cannot continue with a frozen final frame while the room's long-lived audio stream remains active.

Most launchers already branch game audio to a `MediaStreamDestination` for multiplayer. Atari 8-bit and Webretro Saturn load `shared/recording-audio-bridge.js` before their emulator code. The bridge preserves the normal speaker connection and adds a recording-only branch whenever a WebAudio node connects to the context destination.

## Runtime inventory and support

All emulator frames are served from this site's `/public` tree and are same-origin with RoomPage.

| Room system | Renderer/canvas | Audio capture | FPS | Implementation status | Manual AV status |
| --- | --- | --- | ---: | --- | --- |
| Amiga / Amiga AGA (PUAE) | PUAE WebAssembly canvas in iframe | `getAmigaAgaAudioStream` | 50 | Implemented | Not yet manually verified |
| Amiga Link (vAmiga) | Nested vAmiga canvas in same-origin iframe | `getAmigaAudioStream` | 50 | Implemented | Not yet manually verified |
| Amstrad CPC / Party | CPCBox canvas | `getAmstradAudioStream` | 50 | Implemented | Not yet manually verified |
| Commodore 64 | EmulatorJS canvas | `getC64AudioStream` | 50 | Implemented | Not yet manually verified |
| ZX Spectrum | JSSpeccy canvas | `getSpectrumAudioStream` | 50 | Implemented | Not yet manually verified |
| Master System / Mega Drive | Genesis Plus GX canvas | `getMegaDriveAudioStream` | 60 | Implemented | Not yet manually verified |
| NES | jsnes canvas | `getNesAudioStream` | 60 | Implemented | Not yet manually verified |
| SNES | EmulatorJS canvas | `getSnesAudioStream` | 60 | Implemented | Not yet manually verified |
| PC Engine | EmulatorJS canvas | `getPcEngineAudioStream` | 60 | Implemented | Not yet manually verified |
| X68000 | EmulatorJS canvas | `getX68000AudioStream` | 60 | Implemented | Not yet manually verified |
| Atari ST | EmulatorJS canvas | `getAtariStAudioStream` | 50 | Implemented | Not yet manually verified |
| Atari 8-bit | Sfotty Pie canvas | shared WebAudio bridge | 60 | Implemented | Not yet manually verified |
| PlayStation | EmulatorJS canvas | `getPlayStationAudioStream` | 60 | Implemented | Not yet manually verified |
| Saturn | EmulatorJS canvas | `getSaturnAudioStream` | 60 | Implemented | Not yet manually verified |
| Saturn Webretro | Webretro/libretro canvas | shared WebAudio bridge | 60 | Implemented | Not yet manually verified |
| MAME Arcade | EmulatorJS canvas | `getArcadeAudioStream` | 60 | Implemented | Not yet manually verified |

The implementation column describes code-path availability, not a compatibility claim. The manual AV column must only be changed after a downloaded clip has been played and checked.

## Settings

- Durations: 15, 30, 60, 120 and 300 seconds, or manual. Default: 30 seconds.
- Countdown: none, 3 or 5 seconds. Default: 3 seconds. Countdown UI is outside the emulator canvas and is not captured.
- Standard: 4 Mbps video and 160 kbps audio.
- High: 8 Mbps video and 192 kbps audio.
- Format preference: VP9/Opus WebM, then VP8/Opus WebM, then browser-default WebM, selected with `MediaRecorder.isTypeSupported()`.
- Optional controller shortcut: assign a connected gamepad button in the recording settings. The browser stores it locally and starts a recording with the currently selected duration, countdown, and quality.

The recorder reuses RoomPage's established game-audio stream. It does not reconnect or alter the emulator's speaker gain when recording starts; a runtime audio getter is used only if that established stream is unavailable.

## Manual verification procedure

For every row in the table:

1. Enable the feature, start a local game, and confirm `Record gameplay` appears.
2. Record a 15-second Standard clip with the 3-second countdown. Confirm gameplay and speakers continue normally during capture.
3. Download and play the WebM in current Chrome or Edge. Confirm native game video, audible game audio, reasonable sync, no pointer, microphone, chat, controls, or countdown overlay.
4. Record a manual High clip, wait at least 20 seconds, stop it, download it, and perform the same checks.
5. Record a 30-second clip and measure that it finalises at approximately 30 seconds despite any brief UI stutter.
6. Start another recording, then change game or leave the room. Confirm recording resources stop and no stale download remains.
7. Mark Video, Audio, 30s Timer and Manual as verified only after all checks pass; add browser, game and notes.

## Configuration and rollback

Enable in the frontend build environment:

```text
VITE_GAME_RECORDING_ENABLED=true
```

Set it to `false` or remove it and rebuild/restart the frontend to remove all recording controls immediately. Emulator behavior is otherwise unchanged.
