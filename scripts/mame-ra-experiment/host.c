/* Isolated Pac-Man-only MAME 2003-Plus host. Never used by normal Arcade rooms. */
#include <emscripten.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include "libretro.h"

extern uint8_t cpunum_read_byte(int cpu, uint32_t address);
extern uint8_t *videoram, *colorram, *spriteram_2;
static bool initialized, loaded;
static unsigned pixel_format, rotation, width, height;
static uint16_t input_mask;
static uint32_t pixels[512 * 512];
static double sample_rate = 48000, fps = 60;

EM_JS(void, report_log, (const char* message), { Module.onLog?.(UTF8ToString(message)); });
EM_JS(void, report_audio, (const int16_t* data, int frames, double rate), {
    Module.onAudio?.(HEAP16.subarray(data >> 1, (data >> 1) + frames * 2), rate);
});

static void log_message(enum retro_log_level level, const char* format, ...) {
    char text[1024]; va_list args; va_start(args, format);
    vsnprintf(text, sizeof(text), format, args); va_end(args);
    report_log(text);
}

static bool environment(unsigned command, void* data) {
    static const char* directory = "/roms";
    static const char* saves = "/saves";
    switch (command) {
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
        case RETRO_ENVIRONMENT_GET_CONTENT_DIRECTORY: *(const char**)data = directory; return true;
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)data = saves; return true;
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((struct retro_log_callback*)data)->log = log_message; return true;
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: pixel_format = *(unsigned*)data; return pixel_format <= 2;
        case RETRO_ENVIRONMENT_SET_ROTATION: rotation = *(unsigned*)data & 3; return true;
        case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data = true; return true;
        case RETRO_ENVIRONMENT_GET_OVERSCAN: *(bool*)data = false; return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data = false; return true;
        case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)data = 0; return true;
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
        case RETRO_ENVIRONMENT_SET_VARIABLES: return true;
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
            struct retro_variable* variable = data;
            if (strstr(variable->key, "skip_disclaimer") || strstr(variable->key, "skip_warnings")) variable->value = "enabled";
            else if (strstr(variable->key, "sample_rate")) variable->value = "48000";
            else if (strstr(variable->key, "frameskip")) variable->value = "0";
            else { variable->value = NULL; return false; }
            return true;
        }
        default: return false;
    }
}

static void video(const void* data, unsigned w, unsigned h, size_t pitch) {
    unsigned x, y;
    if (!data || w > 512 || h > 512) return;
    width = (rotation & 1) ? h : w; height = (rotation & 1) ? w : h;
    for (y = 0; y < h; ++y) for (x = 0; x < w; ++x) {
        unsigned r, g, b, dx = x, dy = y;
        if (pixel_format == RETRO_PIXEL_FORMAT_XRGB8888) {
            uint32_t color = ((const uint32_t*)((const uint8_t*)data + y * pitch))[x];
            r = (color >> 16) & 255; g = (color >> 8) & 255; b = color & 255;
        } else {
            uint16_t color = ((const uint16_t*)((const uint8_t*)data + y * pitch))[x];
            if (pixel_format == RETRO_PIXEL_FORMAT_RGB565) {
                r = ((color >> 11) & 31) * 255 / 31; g = ((color >> 5) & 63) * 255 / 63;
            } else {
                r = ((color >> 10) & 31) * 255 / 31; g = ((color >> 5) & 31) * 255 / 31;
            }
            b = (color & 31) * 255 / 31;
        }
        if (rotation == 1) { dx = y; dy = w - 1 - x; }
        else if (rotation == 2) { dx = w - 1 - x; dy = h - 1 - y; }
        else if (rotation == 3) { dx = h - 1 - y; dy = x; }
        pixels[dy * width + dx] = r | (g << 8) | (b << 16) | 0xff000000;
    }
}
static size_t audio_batch(const int16_t* data, size_t frames) { report_audio(data, frames, sample_rate); return frames; }
static void audio_sample(int16_t left, int16_t right) { int16_t data[2] = {left, right}; audio_batch(data, 1); }
static void input_poll(void) {}
static int16_t input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
    if (port || device != RETRO_DEVICE_JOYPAD) return 0;
    return id == RETRO_DEVICE_ID_JOYPAD_MASK ? input_mask : (id < 16 && (input_mask & (1 << id))) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int probe_load(void) {
    struct retro_game_info game = {0}; struct retro_system_av_info av;
    if (!initialized) {
        retro_set_environment(environment); retro_set_video_refresh(video);
        retro_set_audio_sample(audio_sample); retro_set_audio_sample_batch(audio_batch);
        retro_set_input_poll(input_poll); retro_set_input_state(input_state); retro_init(); initialized = true;
    }
    if (loaded) retro_unload_game();
    loaded = false; input_mask = 0;
    game.path = "/roms/pacman.zip";
    if (!retro_load_game(&game)) return 0;
    loaded = true; retro_get_system_av_info(&av);
    sample_rate = av.timing.sample_rate; fps = av.timing.fps;
    return 1;
}
EMSCRIPTEN_KEEPALIVE void probe_step(unsigned mask) { if (loaded) { input_mask = mask; retro_run(); } }
EMSCRIPTEN_KEEPALIVE void probe_reset(void) { if (loaded) { input_mask = 0; retro_reset(); } }
EMSCRIPTEN_KEEPALIVE uint32_t* probe_pixels(void) { return pixels; }
EMSCRIPTEN_KEEPALIVE unsigned probe_width(void) { return width; }
EMSCRIPTEN_KEEPALIVE unsigned probe_height(void) { return height; }
EMSCRIPTEN_KEEPALIVE double probe_fps(void) { return fps; }
EMSCRIPTEN_KEEPALIVE int probe_cpu_byte(uint32_t address) {
    if (!loaded || !((address >= 0x4000 && address <= 0x47ff) || (address >= 0x4c00 && address <= 0x4fff))) return -1;
    return cpunum_read_byte(0, address);
}
/* FBNeo's verified Pac-Man AllRam offsets. Unmapped/unused fields fail closed. */
EMSCRIPTEN_KEEPALIVE int probe_ra_byte(uint32_t address) {
    if (!loaded) return -1;
    if (address >= 0x400 && address < 0x800) return cpunum_read_byte(0, address + 0x4800);
    if (address >= 0x1000 && address < 0x1010 && spriteram_2) return spriteram_2[address - 0x1000];
    if (address >= 0x1010 && address < 0x1410 && colorram) return colorram[address - 0x1010];
    if (address >= 0x1410 && address < 0x1810 && videoram) return videoram[address - 0x1410];
    return -1;
}
