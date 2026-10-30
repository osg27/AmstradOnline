#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "rc_client.h"
#include "rc_hash.h"
#include "rc_consoles.h"

static rc_client_t* client;
static char game_hash[33];
static uint32_t expected_console = RC_CONSOLE_MEGA_DRIVE;
static uint32_t memory_reads, memory_failures, frames;

EM_JS(void, snapshot_begin, (uint32_t reads, uint32_t failures, uint32_t ticks), {
    Module.achievementSnapshot = { items: [], reads, failures, frames: ticks };
});
EM_JS(void, snapshot_item, (uint32_t id, const char* title, const char* description, uint32_t points, int state, int unlocked, const char* progress), {
    Module.achievementSnapshot.items.push({id, title: UTF8ToString(title), description: UTF8ToString(description),
        points, state, unlocked: Boolean(unlocked), progress: UTF8ToString(progress)});
});
EM_JS(void, snapshot_end, (), { Module.onSnapshot?.(Module.achievementSnapshot); });

EMSCRIPTEN_KEEPALIVE void ra_snapshot(void) {
    if (!client) return;
    rc_client_achievement_list_t* list = rc_client_create_achievement_list(client,
        RC_CLIENT_ACHIEVEMENT_CATEGORY_CORE, RC_CLIENT_ACHIEVEMENT_LIST_GROUPING_LOCK_STATE);
    snapshot_begin(memory_reads, memory_failures, frames);
    if (list) {
        for (uint32_t b = 0; b < list->num_buckets; ++b) {
            const rc_client_achievement_bucket_t* bucket = &list->buckets[b];
            for (uint32_t i = 0; i < bucket->num_achievements; ++i) {
                const rc_client_achievement_t* a = bucket->achievements[i];
                snapshot_item(a->id, a->title, a->description, a->points, a->state,
                    a->unlocked, a->measured_progress);
            }
        }
        rc_client_destroy_achievement_list(list);
    }
    snapshot_end();
}

EM_JS(void, notify, (const char* kind, int result, const char* message, const char* title, int id, int points), {
    Module.onEvent?.({kind: UTF8ToString(kind), result, message: message ? UTF8ToString(message) : "",
        title: title ? UTF8ToString(title) : "", id, points});
});

EM_JS(int, read_js, (uint32_t address, uint8_t* buffer, uint32_t size), {
    const bytes = Module.readMemory(address, size);
    if (!bytes) return 0;
    HEAPU8.set(bytes, buffer);
    return bytes.length;
});

EM_JS(void, request_js, (const char* url, const char* data, uintptr_t callback, uintptr_t userdata), {
    Module.serverCall(UTF8ToString(url), data ? UTF8ToString(data) : "", callback, userdata);
});

static uint32_t read_memory(uint32_t address, uint8_t* buffer, uint32_t size, rc_client_t* unused) {
    uint32_t read = read_js(address, buffer, size);
    ++memory_reads;
    if (read != size) ++memory_failures;
    return read;
}

static void server_call(const rc_api_request_t* request, rc_client_server_callback_t callback, void* userdata, rc_client_t* unused) {
    request_js(request->url, request->post_data, (uintptr_t)callback, (uintptr_t)userdata);
}

EMSCRIPTEN_KEEPALIVE void ra_reply(uintptr_t callback, uintptr_t userdata, int status, const char* body, int length) {
    rc_api_server_response_t response = { body, (size_t)length, status };
    ((rc_client_server_callback_t)callback)(&response, (void*)userdata);
}

static void event_handler(const rc_client_event_t* event, rc_client_t* unused) {
    if (event->type == RC_CLIENT_EVENT_ACHIEVEMENT_TRIGGERED && event->achievement) {
        const rc_client_achievement_t* a = event->achievement;
        notify("unlock", 0, a->description, a->title, a->id, a->points);
    } else if (event->type == RC_CLIENT_EVENT_SERVER_ERROR) {
        notify("error", event->server_error->result, event->server_error->error_message, "", 0, 0);
    } else if (event->type == RC_CLIENT_EVENT_DISCONNECTED) {
        notify("pending", 0, "An unlock is waiting for the connection to recover. Keep this page open.", "", 0, 0);
    } else if (event->type == RC_CLIENT_EVENT_RECONNECTED) {
        notify("synced", 0, "Pending unlocks have synced.", "", 0, 0);
    }
}

EMSCRIPTEN_KEEPALIVE void ra_init(void) {
    if (client) return;
    client = rc_client_create(read_memory, server_call);
    rc_client_set_hardcore_enabled(client, 0);
    rc_client_set_event_handler(client, event_handler);
}

static void login_done(int result, const char* error, rc_client_t* active, void* unused) {
    const rc_client_user_t* user = rc_client_get_user_info(active);
    notify("login", result, error, user ? user->username : "", 0, 0);
}

EMSCRIPTEN_KEEPALIVE void ra_login(const char* username, const char* password) {
    ra_init();
    rc_client_begin_login_with_password(client, username, password, login_done, NULL);
}

EMSCRIPTEN_KEEPALIVE void ra_login_token(const char* username, const char* token) {
    ra_init();
    rc_client_begin_login_with_token(client, username, token, login_done, NULL);
}

static void game_done(int result, const char* error, rc_client_t* active, void* unused) {
    const rc_client_game_t* game = rc_client_get_game_info(active);
    if (result == 0 && game && game->console_id != expected_console) {
        rc_client_unload_game(active);
        notify("game", -1, "This file matched a different system. Use a supported game file for this room.", "", 0, 0);
        return;
    }
    rc_client_user_game_summary_t summary;
    memset(&summary, 0, sizeof(summary));
    rc_client_get_user_game_summary(active, &summary);
    notify("game", result, error, game ? game->title : "", game ? game->id : 0, summary.num_core_achievements);
}

EMSCRIPTEN_KEEPALIVE int ra_load_system(const uint8_t* rom, int size, uint32_t console_id) {
    if (console_id != RC_CONSOLE_MEGA_DRIVE && console_id != RC_CONSOLE_AMSTRAD_PC) return 0;
    ra_init();
    rc_client_unload_game(client);
    memory_reads = memory_failures = frames = 0;
    expected_console = console_id;
    if (!rc_hash_generate_from_buffer(game_hash, console_id, rom, (size_t)size)) return 0;
    rc_client_begin_load_game(client, game_hash, game_done, NULL);
    return 1;
}

EMSCRIPTEN_KEEPALIVE int ra_load(const uint8_t* rom, int size) {
    return ra_load_system(rom, size, RC_CONSOLE_MEGA_DRIVE);
}

EMSCRIPTEN_KEEPALIVE const char* ra_hash(const uint8_t* rom, int size) {
    if (!rc_hash_generate_from_buffer(game_hash, RC_CONSOLE_MEGA_DRIVE, rom, (size_t)size)) return "";
    return game_hash;
}

EMSCRIPTEN_KEEPALIVE void ra_frame(void) { if (client) { ++frames; rc_client_do_frame(client); } }
EMSCRIPTEN_KEEPALIVE void ra_idle(void) { if (client) rc_client_idle(client); }
EMSCRIPTEN_KEEPALIVE void ra_reset(void) { if (client) rc_client_reset(client); }
EMSCRIPTEN_KEEPALIVE void ra_unload(void) { if (client) rc_client_unload_game(client); }
EMSCRIPTEN_KEEPALIVE void ra_logout(void) { if (client) rc_client_logout(client); }
